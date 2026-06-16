// Pawn / collateral loans. Mounted at /api/pawn.
//
// A pawn loan is created immediately as 'active' (the lender takes the item
// and hands over cash — no application workflow). It uses a flat fee on the
// principal and a single BULLET schedule due at maturity. Redeeming pays it
// off and returns the item; forfeiting closes it (item kept, optionally sold
// to recover capital).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { nextLoanCode } from "../utils/clientCode.js";
import { recordLoanPayment } from "../services/paymentService.js";
import { buildPawnTicketPdf, NotFoundError } from "../utils/pdfDocuments.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function loadPawnLoan(req, loanId) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(
    `SELECT * FROM loans WHERE id = $1 AND loan_type = 'pawn'${tc.clause}`,
    [loanId, ...tc.params],
  );
  return r.rows[0] || null;
}

// Paid-to-date for a pawn loan (mirrors the redeem calc): completed
// transactions, net of penalty/overpayment portions.
const PAID_SUBQ = `COALESCE((SELECT SUM(amount_paid - COALESCE(penalty_portion,0) - COALESCE(overpayment_portion,0))
       FROM transactions t WHERE t.loan_id = l.id AND t.payment_status='completed'),0)`;

// GET /api/pawn — list this pawnshop's pledges (loan + its collateral + balance).
// ?status=active|completed|defaulted|overdue|forfeited narrows it.
router.get("/", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "l.tenant_id");
    const rows = (await query(
      `SELECT l.id, l.loan_code, l.principal_amount, l.total_amount_due, l.total_interest,
              l.status, l.start_date, l.end_date, l.created_at, l.interest_rate,
              c.first_name, c.last_name, c.phone_number,
              col.description AS item, col.category, col.serial_number, col.condition,
              col.appraised_value, col.ltv_percent, col.storage_location,
              col.status AS collateral_status, col.sale_amount, col.photos,
              ${PAID_SUBQ} AS paid,
              (l.status='active' AND l.end_date < CURRENT_DATE) AS overdue
         FROM loans l
         JOIN clients c ON c.id = l.client_id
         LEFT JOIN LATERAL (
           SELECT * FROM loan_collateral lc WHERE lc.loan_id = l.id ORDER BY id DESC LIMIT 1
         ) col ON true
        WHERE l.loan_type = 'pawn'${tc.clause}
        ORDER BY l.created_at DESC`,
      [...tc.params],
    )).rows.map((r) => ({
      ...r,
      paid: Number(r.paid),
      balance: round2(parseFloat(r.total_amount_due) - parseFloat(r.paid)),
    }));
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("pawn list error:", e);
    res.status(500).json({ error: "Failed to load pledges" });
  }
});

// GET /api/pawn/summary — dashboard cards for the pawnshop.
router.get("/summary", async (req, res) => {
  try {
    const lt = tenantClause(req, 0, "tenant_id");
    const loans = (await query(
      `SELECT
         COUNT(*) FILTER (WHERE status='active')::int AS active,
         COUNT(*) FILTER (WHERE status='active' AND end_date < CURRENT_DATE)::int AS overdue,
         COUNT(*) FILTER (WHERE status='active' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS due_soon,
         COUNT(*) FILTER (WHERE status='completed' AND updated_at::date = CURRENT_DATE)::int AS redeemed_today,
         COALESCE(SUM(principal_amount) FILTER (WHERE status='active'),0) AS cash_out,
         COALESCE(SUM(total_amount_due) FILTER (WHERE status='active'),0) AS due_from_customers
       FROM loans WHERE loan_type='pawn'${lt.clause}`,
      [...lt.params],
    )).rows[0];

    const ct = tenantClause(req, 0, "tenant_id");
    const col = (await query(
      `SELECT COALESCE(SUM(appraised_value) FILTER (WHERE status='held'),0) AS collateral_value,
              COUNT(*) FILTER (WHERE status IN ('forfeited','sold'))::int AS forfeited
         FROM loan_collateral WHERE 1=1${ct.clause}`,
      [...ct.params],
    )).rows[0];

    const tid = tenantId(req);
    const cap = tid
      ? (await query(`SELECT initial_capital, total_disbursed, total_collected, total_interest_earned FROM capital_pool WHERE tenant_id=$1`, [tid])).rows[0]
      : null;
    const available = cap
      ? round2(parseFloat(cap.initial_capital) + parseFloat(cap.total_collected) - parseFloat(cap.total_disbursed))
      : 0;

    res.json({
      success: true,
      data: {
        active_pledges: loans.active,
        overdue: loans.overdue,
        due_soon: loans.due_soon,
        redeemed_today: loans.redeemed_today,
        cash_out: Number(loans.cash_out),
        due_from_customers: Number(loans.due_from_customers),
        collateral_value: Number(col.collateral_value),
        forfeited: col.forfeited,
        capital_available: available,
        interest_earned: cap ? Number(cap.total_interest_earned) : 0,
      },
    });
  } catch (e) {
    logger.error("pawn summary error:", e);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

// GET /api/pawn/applications — customer-submitted pawn requests for this shop.
// ?status=pending (default all) narrows the queue.
router.get("/applications", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "a.tenant_id");
    const params = [...tc.params];
    let statusClause = "";
    if (req.query.status) {
      params.push(req.query.status);
      statusClause = ` AND a.status = $${params.length}`;
    }
    const r = await query(
      `SELECT a.*, c.first_name, c.last_name, c.phone_number, c.client_code
         FROM pawn_applications a
         JOIN clients c ON c.id = a.client_id
        WHERE 1=1${tc.clause}${statusClause}
        ORDER BY (a.status='pending') DESC, a.created_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("pawn applications list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// POST /api/pawn/applications/:id/review — approve (with an offer) or reject.
router.post("/applications/:id/review", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const a = (await query(`SELECT * FROM pawn_applications WHERE id = $1${tc.clause}`, [req.params.id, ...tc.params])).rows[0];
    if (!a) return res.status(404).json({ error: "Request not found" });
    if (a.status !== "pending") return res.status(400).json({ error: `Request is already ${a.status}` });

    const decision = req.body?.decision;
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }
    const offered = req.body?.offered_amount != null && req.body.offered_amount !== "" ? parseFloat(req.body.offered_amount) : null;
    const r = await query(
      `UPDATE pawn_applications
          SET status=$2, offered_amount=$3, review_notes=$4, reviewed_by=$5, reviewed_at=NOW(), updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [a.id, decision, decision === "approved" ? offered : null, req.body?.notes || null, req.user.id],
    );
    await logAudit({
      user: req.user, action: `pawn_application_${decision}`, entityType: "pawn_application",
      entityId: a.id, description: `Pawn request #${a.id} ${decision}${offered ? ` (offer ${offered})` : ""}`, req,
    });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("pawn application review error:", e);
    res.status(500).json({ error: "Failed to review request" });
  }
});

// GET /api/pawn/:loanId — pawn loan + its collateral.
router.get("/:loanId", async (req, res) => {
  try {
    const loan = await loadPawnLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Pawn loan not found" });
    const col = await query(
      `SELECT * FROM loan_collateral WHERE loan_id = $1 ORDER BY id DESC LIMIT 1`,
      [loan.id],
    );
    res.json({ success: true, data: { loan, collateral: col.rows[0] || null } });
  } catch (e) {
    logger.error("pawn get error:", e);
    res.status(500).json({ error: "Failed to load pawn loan" });
  }
});

// GET /api/pawn/:loanId/ticket — the printable pawn claim ticket (PDF).
router.get("/:loanId/ticket", async (req, res) => {
  try {
    const { buffer, filename } = await buildPawnTicketPdf(
      req.params.loanId,
      tenantId(req),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    if (e instanceof NotFoundError) return res.status(404).json({ error: e.message });
    logger.error("pawn ticket error:", e);
    res.status(500).json({ error: "Failed to generate pawn ticket" });
  }
});

// POST /api/pawn — create a pawn loan (item + valuation + bullet loan + disburse).
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const tid = req.user.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const {
      client_id,
      package_id,
      appraised_value,
      ltv_percent,
      duration_months,
      principal_amount,
      monthly_fee_percent, // custom (no package): the pawn fee % per month
      item_category,
      item_description,
      serial_number,
      item_condition,
      storage_location,
      photos,
      application_id, // optional: converting a customer pawn request
    } = req.body || {};

    if (!client_id || !appraised_value || !item_description) {
      return res.status(400).json({
        error: "Client, appraised value and item description are required",
      });
    }

    // A package is optional — a pawn can be created custom (free-form), just
    // like a normal loan. With a package, its rate + bounds apply; without one,
    // the caller supplies the monthly fee directly.
    let pkg = null;
    if (package_id) {
      const pkgRes = await query(
        `SELECT * FROM loan_packages WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [package_id, tid],
      );
      pkg = pkgRes.rows[0];
      if (!pkg) return res.status(404).json({ error: "Package not found" });
      if (pkg.loan_type !== "pawn") {
        return res.status(400).json({ error: "Selected package is not a pawn package" });
      }
    }

    const client = await query(
      `SELECT id FROM clients WHERE id = $1 AND tenant_id = $2`,
      [client_id, tid],
    );
    if (!client.rows.length) return res.status(404).json({ error: "Client not found" });

    const value = parseFloat(appraised_value);
    if (!(value > 0)) return res.status(400).json({ error: "Appraised value must be positive" });
    const ltv =
      ltv_percent != null && ltv_percent !== "" ? parseFloat(ltv_percent) : 50;
    const maxLoan = round2(value * (ltv / 100));
    let principal =
      principal_amount != null && principal_amount !== ""
        ? parseFloat(principal_amount)
        : maxLoan;
    if (!(principal > 0)) return res.status(400).json({ error: "Loan amount must be positive" });
    if (principal > maxLoan) {
      return res.status(400).json({
        error: `Loan can't exceed ${ltv}% of appraised value (max KES ${maxLoan.toLocaleString()})`,
      });
    }
    if (pkg && pkg.min_amount && principal < parseFloat(pkg.min_amount)) {
      return res.status(400).json({ error: `Below package minimum (KES ${pkg.min_amount})` });
    }
    if (pkg && pkg.max_amount && principal > parseFloat(pkg.max_amount)) {
      return res.status(400).json({ error: `Above package maximum (KES ${pkg.max_amount})` });
    }

    const months = duration_months
      ? parseInt(duration_months, 10)
      : pkg
        ? pkg.min_duration_months || pkg.max_duration_months || 1
        : 1;
    // Pawn fee is flat on principal, charged per month. With a package the rate
    // comes from its annual_interest_rate (÷12); custom takes monthly_fee_percent.
    const monthlyFeePct = pkg
      ? parseFloat(pkg.annual_interest_rate) / 12
      : monthly_fee_percent != null && monthly_fee_percent !== ""
        ? parseFloat(monthly_fee_percent)
        : NaN;
    if (!(monthlyFeePct >= 0)) {
      return res.status(400).json({ error: "A monthly fee % is required for a custom pawn" });
    }
    const fee = round2(principal * (monthlyFeePct / 100) * months);
    const totalDue = round2(principal + fee);

    const start = new Date();
    const maturity = new Date(start);
    maturity.setMonth(maturity.getMonth() + months);
    const startISO = start.toISOString().split("T")[0];
    const matISO = maturity.toISOString().split("T")[0];
    const loanCode = await nextLoanCode(query, tid, start);

    const loanRes = await query(
      `INSERT INTO loans (
         tenant_id, loan_code, client_id, principal_amount, interest_rate,
         loan_duration_months, total_amount_due, total_interest, status, created_by,
         purpose, package_id, interest_method, loan_type,
         start_date, end_date, disbursed_by, disbursed_at,
         application_date, application_source, net_disbursed_amount
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,'active',$9,
         'Pawn loan',$10,'flat','pawn',
         $11::date,$12::date,$9,NOW(),
         $11::date,'pawn',$4
       ) RETURNING *`,
      [tid, loanCode, client_id, principal, monthlyFeePct, months, totalDue, fee, req.user.id, pkg ? pkg.id : null, startISO, matISO],
    );
    const loan = loanRes.rows[0];

    // Single bullet schedule due at maturity (principal + flat fee).
    await query(
      `INSERT INTO payment_schedules
         (loan_id, tenant_id, payment_number, due_date, amount_due,
          interest_portion, principal_portion, balance_after, amount_paid, status)
       VALUES ($1,$2,1,$3::date,$4,$5,$6,0,0,'pending')`,
      [loan.id, tid, matISO, totalDue, fee, principal],
    );

    // Capital pool — principal goes out.
    await query(
      `UPDATE capital_pool SET total_disbursed = total_disbursed + $1, updated_at = NOW() WHERE tenant_id = $2`,
      [principal, tid],
    );
    await query(
      `INSERT INTO capital_transactions (tenant_id, transaction_type, amount, loan_id, description)
       VALUES ($1,'loan_disbursed',$2,$3,$4)`,
      [tid, principal, loan.id, `Pawn ${loanCode} disbursed`],
    );

    const col = await query(
      `INSERT INTO loan_collateral
         (tenant_id, loan_id, category, description, serial_number, condition,
          appraised_value, ltv_percent, storage_location, photos, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'held',$11)
       RETURNING *`,
      [
        tid, loan.id, item_category || null, item_description, serial_number || null,
        item_condition || null, value, ltv, storage_location || null,
        photos ? JSON.stringify(photos) : null, req.user.id,
      ],
    );

    await logAudit({
      user: req.user,
      action: "pawn_created",
      entityType: "loan",
      entityId: loan.id,
      entityCode: loanCode,
      description: `Pawn ${loanCode}: KES ${principal} on "${item_description}" (value KES ${value}, LTV ${ltv}%)`,
      req,
    });

    // If this pawn was created from a customer request, mark it converted.
    if (application_id) {
      await query(
        `UPDATE pawn_applications SET status='converted', loan_id=$2, updated_at=NOW()
          WHERE id=$1 AND tenant_id=$3 AND status IN ('pending','approved')`,
        [application_id, loan.id, tid],
      );
    }

    res.status(201).json({ success: true, data: { loan, collateral: col.rows[0] } });
  } catch (e) {
    logger.error("pawn create error:", e);
    res.status(500).json({ error: "Failed to create pawn loan" });
  }
});

// POST /api/pawn/:loanId/redeem — pay off and return the item.
router.post("/:loanId/redeem", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const loan = await loadPawnLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Pawn loan not found" });
    if (loan.status !== "active") {
      return res.status(400).json({ error: "Only active pawn loans can be redeemed" });
    }

    const paid = await query(
      `SELECT COALESCE(SUM(amount_paid - COALESCE(penalty_portion,0) - COALESCE(overpayment_portion,0)),0) AS paid
         FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loan.id],
    );
    const outstanding = round2(parseFloat(loan.total_amount_due) - parseFloat(paid.rows[0].paid));
    const amount =
      req.body.amount != null && req.body.amount !== ""
        ? parseFloat(req.body.amount)
        : outstanding;

    const result = await recordLoanPayment({
      loanId: loan.id,
      amountPaid: amount,
      paymentDate: req.body.payment_date || new Date().toISOString().split("T")[0],
      paymentMethod: req.body.payment_method || "Cash",
      notes: "Pawn redemption",
      actor: req.user,
      tenantId: tenantId(req),
      auditReq: req,
    });

    const after = await query(`SELECT status FROM loans WHERE id = $1`, [loan.id]);
    const redeemed = after.rows[0].status === "completed";
    if (redeemed) {
      await query(
        `UPDATE loan_collateral SET status='returned', returned_at=NOW(), updated_at=NOW()
          WHERE loan_id = $1 AND status = 'held'`,
        [loan.id],
      );
    }
    res.json({ success: true, redeemed, data: result.data });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("pawn redeem error:", e);
    res.status(500).json({ error: "Failed to redeem pawn loan" });
  }
});

// POST /api/pawn/:loanId/forfeit — borrower didn't redeem; item is kept
// (optionally sold to recover capital).
router.post("/:loanId/forfeit", authorize("admin", "manager"), async (req, res) => {
  try {
    const loan = await loadPawnLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Pawn loan not found" });
    if (loan.status !== "active") {
      return res.status(400).json({ error: "Only active pawn loans can be forfeited" });
    }

    await query(`UPDATE loans SET status='defaulted', updated_at=NOW() WHERE id=$1`, [loan.id]);

    const saleAmount =
      req.body.sale_amount != null && req.body.sale_amount !== ""
        ? parseFloat(req.body.sale_amount)
        : null;

    if (saleAmount && saleAmount > 0) {
      await query(
        `UPDATE loan_collateral
            SET status='sold', sale_amount=$1, sale_date=CURRENT_DATE,
                forfeited_at=NOW(), updated_at=NOW()
          WHERE loan_id=$2`,
        [saleAmount, loan.id],
      );
      // Recovery of capital from the sale.
      await query(
        `UPDATE capital_pool SET total_collected = total_collected + $1, updated_at=NOW() WHERE tenant_id=$2`,
        [saleAmount, loan.tenant_id],
      );
      await query(
        `INSERT INTO capital_transactions (tenant_id, transaction_type, amount, loan_id, description)
         VALUES ($1,'payment_received',$2,$3,$4)`,
        [loan.tenant_id, saleAmount, loan.id, `Pawn ${loan.loan_code} item sold`],
      );
    } else {
      await query(
        `UPDATE loan_collateral SET status='forfeited', forfeited_at=NOW(), updated_at=NOW() WHERE loan_id=$1`,
        [loan.id],
      );
    }

    await logAudit({
      user: req.user,
      action: "pawn_forfeited",
      entityType: "loan",
      entityId: loan.id,
      entityCode: loan.loan_code,
      description: `Pawn ${loan.loan_code} forfeited${saleAmount ? ` — item sold for KES ${saleAmount}` : ""}`,
      req,
    });

    res.json({ success: true, sold: !!saleAmount });
  } catch (e) {
    logger.error("pawn forfeit error:", e);
    res.status(500).json({ error: "Failed to forfeit pawn loan" });
  }
});

export default router;
