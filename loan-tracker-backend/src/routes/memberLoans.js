// Welfare member loans — the chama's internal lending, funded from and repaid
// into the members' pool (member_pool_transactions). Mounted at
// /api/welfares/:welfareId/loans.
//
// Phase 1 implements loan PRODUCTS (the welfare analogue of loan_packages):
// pre-configured rate / method / fees / penalty terms that range-validate an
// application. Later phases add the application workflow, schedules,
// disbursement, repayment allocation, collateral and guarantors.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { validateAgainstPackage } from "../utils/loanMath.js";
import { createMemberLoanApplication, disburseMemberLoan } from "../services/memberLoanService.js";
import { poolBalance } from "../services/welfarePoolService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Resolve the welfare (tenant-scoped) for every route here.
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (member loans) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

const METHODS = ["flat", "reducing"];

// Shared validation for product create/edit. Returns null when valid, else a
// 400-ready string. `partial` relaxes required-field checks for PUT.
function validateProduct(body, { partial = false } = {}) {
  const b = body || {};
  if (!partial || b.name !== undefined) {
    if (!b.name || !String(b.name).trim()) return "Product name is required";
  }
  if (!partial || b.annual_interest_rate !== undefined) {
    const r = parseFloat(b.annual_interest_rate);
    if (!Number.isFinite(r) || r < 0) return "Annual interest rate must be a non-negative number";
  }
  if (b.interest_method !== undefined && b.interest_method !== null) {
    if (!METHODS.includes(String(b.interest_method).toLowerCase())) return `Interest method must be one of: ${METHODS.join(", ")}`;
  }
  if (b.processing_fee_rate !== undefined && b.processing_fee_rate !== null && b.processing_fee_rate !== "") {
    const f = parseFloat(b.processing_fee_rate);
    if (!Number.isFinite(f) || f < 0 || f > 100) return "Processing fee rate must be between 0 and 100";
  }
  if (b.late_fee !== undefined && b.late_fee !== null && b.late_fee !== "") {
    const f = parseFloat(b.late_fee);
    if (!Number.isFinite(f) || f < 0) return "Late fee must be a non-negative number";
  }
  if (b.penalty_rate !== undefined && b.penalty_rate !== null && b.penalty_rate !== "") {
    const f = parseFloat(b.penalty_rate);
    if (!Number.isFinite(f) || f < 0) return "Penalty rate must be a non-negative number";
  }
  if (!partial || b.min_amount !== undefined || b.max_amount !== undefined) {
    const mn = parseFloat(b.min_amount), mx = parseFloat(b.max_amount);
    if (!Number.isFinite(mn) || mn <= 0) return "min_amount must be > 0";
    if (!Number.isFinite(mx) || mx < mn) return "max_amount must be ≥ min_amount";
  }
  if (!partial || b.min_duration_months !== undefined || b.max_duration_months !== undefined) {
    const mn = parseInt(b.min_duration_months, 10), mx = parseInt(b.max_duration_months, 10);
    if (!Number.isInteger(mn) || mn <= 0) return "min_duration_months must be a positive integer";
    if (!Number.isInteger(mx) || mx < mn) return "max_duration_months must be ≥ min_duration_months";
  }
  return null;
}

const num = (v, d = null) => (v == null || v === "" ? d : parseFloat(v));

// GET /loans/products — list (incl. archived) with usage count.
router.get("/products", async (req, res) => {
  try {
    const r = await query(
      `SELECT p.*, (SELECT COUNT(*) FROM member_loans l WHERE l.product_id = p.id) AS loan_count
         FROM member_loan_products p
        WHERE p.welfare_id = $1
        ORDER BY p.active DESC, p.name ASC`,
      [req.welfare.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loan products list error:", e);
    res.status(500).json({ error: "Failed to load loan products" });
  }
});

// POST /loans/products — create.
router.post("/products", authorize("admin", "manager"), async (req, res) => {
  try {
    const err = validateProduct(req.body);
    if (err) return res.status(400).json({ error: err });
    const name = String(req.body.name).trim();
    const dup = await query(`SELECT id FROM member_loan_products WHERE welfare_id=$1 AND lower(name)=lower($2) AND active`, [req.welfare.id, name]);
    if (dup.rows.length) return res.status(409).json({ error: "A product with this name already exists" });

    const r = await query(
      `INSERT INTO member_loan_products
         (tenant_id, welfare_id, name, description, annual_interest_rate, interest_method,
          processing_fee_rate, min_amount, max_amount, min_duration_months, max_duration_months,
          late_fee, penalty_rate, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.welfare.tenant_id, req.welfare.id, name, req.body.description?.trim() || null,
        parseFloat(req.body.annual_interest_rate), (req.body.interest_method || "flat").toLowerCase(),
        num(req.body.processing_fee_rate, 0), parseFloat(req.body.min_amount), parseFloat(req.body.max_amount),
        parseInt(req.body.min_duration_months, 10), parseInt(req.body.max_duration_months, 10),
        num(req.body.late_fee, 0), num(req.body.penalty_rate, 0), req.user.id,
      ],
    );
    await logAudit({ user: req.user, action: "created", entityType: "member_loan_product", entityId: r.rows[0].id, entityCode: name, description: `Created member loan product: ${name}`, newValues: r.rows[0], req });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan product create error:", e);
    res.status(500).json({ error: "Failed to create loan product" });
  }
});

// PUT /loans/products/:id — edit.
router.put("/products/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const cur = (await query(`SELECT * FROM member_loan_products WHERE id=$1 AND welfare_id=$2`, [req.params.id, req.welfare.id])).rows[0];
    if (!cur) return res.status(404).json({ error: "Product not found" });
    // Validate the merged result so cross-field checks (min/max) see both sides.
    const provided = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v !== undefined && v !== ""));
    const err = validateProduct({ ...cur, ...provided });
    if (err) return res.status(400).json({ error: err });

    const name = req.body.name === undefined ? cur.name : String(req.body.name).trim();
    if (name.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = await query(`SELECT id FROM member_loan_products WHERE welfare_id=$1 AND lower(name)=lower($2) AND id<>$3 AND active`, [req.welfare.id, name, cur.id]);
      if (dup.rows.length) return res.status(409).json({ error: "A product with this name already exists" });
    }
    if (req.body.active === false && cur.active) return res.status(400).json({ error: "Use DELETE to archive a product" });

    const r = await query(
      `UPDATE member_loan_products SET
         name=$1, description=$2,
         annual_interest_rate=COALESCE($3, annual_interest_rate),
         interest_method=COALESCE($4, interest_method),
         processing_fee_rate=COALESCE($5, processing_fee_rate),
         min_amount=COALESCE($6, min_amount), max_amount=COALESCE($7, max_amount),
         min_duration_months=COALESCE($8, min_duration_months), max_duration_months=COALESCE($9, max_duration_months),
         late_fee=COALESCE($10, late_fee), penalty_rate=COALESCE($11, penalty_rate),
         active=COALESCE($12, active), updated_at=NOW()
       WHERE id=$13 AND welfare_id=$14 RETURNING *`,
      [
        name, req.body.description === undefined ? cur.description : req.body.description?.trim() || null,
        num(req.body.annual_interest_rate), req.body.interest_method ? String(req.body.interest_method).toLowerCase() : null,
        num(req.body.processing_fee_rate), num(req.body.min_amount), num(req.body.max_amount),
        req.body.min_duration_months == null || req.body.min_duration_months === "" ? null : parseInt(req.body.min_duration_months, 10),
        req.body.max_duration_months == null || req.body.max_duration_months === "" ? null : parseInt(req.body.max_duration_months, 10),
        num(req.body.late_fee), num(req.body.penalty_rate), req.body.active ?? null, cur.id, req.welfare.id,
      ],
    );
    await logAudit({ user: req.user, action: "updated", entityType: "member_loan_product", entityId: cur.id, entityCode: r.rows[0].name, description: `Updated member loan product: ${r.rows[0].name}`, oldValues: cur, newValues: r.rows[0], req });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan product update error:", e);
    res.status(500).json({ error: "Failed to update loan product" });
  }
});

// DELETE /loans/products/:id — soft-archive (loans still resolve via FK).
router.delete("/products/:id", authorize("admin"), async (req, res) => {
  try {
    const cur = (await query(`SELECT * FROM member_loan_products WHERE id=$1 AND welfare_id=$2`, [req.params.id, req.welfare.id])).rows[0];
    if (!cur) return res.status(404).json({ error: "Product not found" });
    const r = await query(`UPDATE member_loan_products SET active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING *`, [cur.id]);
    await logAudit({ user: req.user, action: "deleted", entityType: "member_loan_product", entityId: cur.id, entityCode: cur.name, description: `Archived member loan product: ${cur.name}`, req });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan product archive error:", e);
    res.status(500).json({ error: "Failed to archive loan product" });
  }
});

// ─────────────────────────────────────────────────────────────
// Loan applications + lifecycle. Status machine:
//   pending → under_review → approved → active → completed
//   (pending|under_review) → rejected ;  active → defaulted
// Funds move only at /disburse. Repayment allocation arrives in phase 3.
// ─────────────────────────────────────────────────────────────

const loadLoan = (welfareId, loanId) =>
  query(`SELECT * FROM member_loans WHERE id=$1 AND welfare_id=$2`, [loanId, welfareId]).then((r) => r.rows[0] || null);

// GET /loans — list (optional ?status= and ?member_id=).
router.get("/", async (req, res) => {
  try {
    const params = [req.welfare.id];
    let where = "l.welfare_id = $1";
    if (req.query.status) { params.push(req.query.status); where += ` AND l.status = $${params.length}`; }
    if (req.query.member_id) { params.push(req.query.member_id); where += ` AND l.member_id = $${params.length}`; }
    const r = await query(
      `SELECT l.*, m.first_name, m.last_name, m.member_no,
              GREATEST(l.total_amount_due - l.amount_paid, 0) AS balance
         FROM member_loans l JOIN members m ON m.id = l.member_id
        WHERE ${where}
        ORDER BY l.created_at DESC, l.id DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loans list error:", e);
    res.status(500).json({ error: "Failed to load loans" });
  }
});

// GET /loans/:loanId — loan + schedule + pool ledger.
router.get("/:loanId", async (req, res) => {
  try {
    const loan = await loadLoan(req.welfare.id, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const member = (await query(`SELECT id, first_name, last_name, member_no, phone_number FROM members WHERE id=$1`, [loan.member_id])).rows[0];
    const schedule = (await query(`SELECT * FROM member_loan_schedules WHERE member_loan_id=$1 ORDER BY payment_number`, [loan.id])).rows;
    const ledger = (await query(
      `SELECT id, type, amount, direction, balance_after, txn_date, description, created_at
         FROM member_pool_transactions WHERE member_loan_id=$1 ORDER BY id`, [loan.id],
    )).rows;
    res.json({ success: true, data: { loan: { ...loan, balance: Math.max(Number(loan.total_amount_due) - Number(loan.amount_paid), 0) }, member, schedule, ledger } });
  } catch (e) {
    logger.error("member loan detail error:", e);
    res.status(500).json({ error: "Failed to load loan" });
  }
});

// POST /loans — create an application (status 'pending').
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const b = req.body || {};
    const member = (await query(`SELECT * FROM members WHERE id=$1 AND welfare_id=$2`, [b.member_id, req.welfare.id])).rows[0];
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (member.status !== "active") return res.status(400).json({ error: "Member is not active" });
    const principal = parseFloat(b.principal);
    if (!(principal > 0)) return res.status(400).json({ error: "Principal must be positive" });
    const months = parseInt(b.duration_months, 10) || 0;
    if (months < 1) return res.status(400).json({ error: "Duration must be at least 1 month" });

    let product = null, rate, method, feeRate, lateFee, penaltyRate;
    if (b.product_id) {
      product = (await query(`SELECT * FROM member_loan_products WHERE id=$1 AND welfare_id=$2 AND active`, [b.product_id, req.welfare.id])).rows[0];
      if (!product) return res.status(400).json({ error: "Loan product not found" });
      const err = validateAgainstPackage(product, principal, months);
      if (err) return res.status(400).json({ error: err });
      rate = parseFloat(product.annual_interest_rate);
      method = product.interest_method;
      feeRate = parseFloat(product.processing_fee_rate);
      lateFee = parseFloat(product.late_fee);
      penaltyRate = parseFloat(product.penalty_rate);
    } else {
      rate = b.interest_rate != null && b.interest_rate !== "" ? parseFloat(b.interest_rate) : 0;
      if (!(rate >= 0)) return res.status(400).json({ error: "Interest rate can't be negative" });
      method = (b.interest_method || "flat").toLowerCase();
      if (!["flat", "reducing"].includes(method)) return res.status(400).json({ error: "Invalid interest method" });
      feeRate = b.processing_fee_rate ? parseFloat(b.processing_fee_rate) : 0;
      lateFee = b.late_fee ? parseFloat(b.late_fee) : 0;
      penaltyRate = b.penalty_rate ? parseFloat(b.penalty_rate) : 0;
    }

    const loan = await createMemberLoanApplication({
      welfare: req.welfare, member, product, principal, rate, months, method,
      processingFeeRate: feeRate, lateFee, penaltyRate, purpose: b.purpose, notes: b.notes, userId: req.user.id,
    });
    await logAudit({ user: req.user, action: "member_loan_applied", entityType: "member_loan", entityId: loan.id, entityCode: loan.loan_code, description: `Loan application ${loan.loan_code}: KES ${principal} for ${member.first_name} ${member.last_name}`, req });
    res.status(201).json({ success: true, data: loan });
  } catch (e) {
    logger.error("member loan application error:", e);
    res.status(500).json({ error: "Failed to create loan application" });
  }
});

// Simple status transitions. `from` lists the statuses the action is valid from.
function transition({ action, from, set, role = ["admin", "manager"] }) {
  return [authorize(...role), async (req, res) => {
    try {
      const loan = await loadLoan(req.welfare.id, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Loan not found" });
      if (!from.includes(loan.status)) return res.status(400).json({ error: `Can't ${action} a ${loan.status} loan` });
      const patch = set(req);
      const cols = Object.keys(patch);
      const r = await query(
        `UPDATE member_loans SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(", ")}, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [loan.id, ...cols.map((c) => patch[c])],
      );
      await logAudit({ user: req.user, action: `member_loan_${action}`, entityType: "member_loan", entityId: loan.id, entityCode: loan.loan_code, description: `Loan ${loan.loan_code} ${action}`, req });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error(`member loan ${action} error:`, e);
      res.status(500).json({ error: `Failed to ${action} loan` });
    }
  }];
}

router.post("/:loanId/review", ...transition({ action: "review", from: ["pending"], role: ["admin", "manager", "loan_officer"], set: (req) => ({ status: "under_review", reviewed_by: req.user.id, reviewed_at: new Date() }) }));
router.post("/:loanId/reject", ...transition({ action: "reject", from: ["pending", "under_review"], set: (req) => ({ status: "rejected", rejected_by: req.user.id, rejected_at: new Date(), rejection_reason: req.body?.reason || req.body?.notes || null }) }));
router.post("/:loanId/default", ...transition({ action: "default", from: ["active"], set: () => ({ status: "defaulted" }) }));

// Approve stamps approved_by/at, so it's spelled out rather than using the
// generic transition helper.
router.post("/:loanId/approve", authorize("admin", "manager"), async (req, res) => {
  try {
    const loan = await loadLoan(req.welfare.id, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (!["pending", "under_review"].includes(loan.status)) return res.status(400).json({ error: `Can't approve a ${loan.status} loan` });
    const r = await query(`UPDATE member_loans SET status='approved', approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [loan.id, req.user.id]);
    await logAudit({ user: req.user, action: "member_loan_approved", entityType: "member_loan", entityId: loan.id, entityCode: loan.loan_code, description: `Loan ${loan.loan_code} approved`, req });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan approve error:", e);
    res.status(500).json({ error: "Failed to approve loan" });
  }
});

// POST /loans/:loanId/disburse — build schedule, debit pool, set active.
router.post("/:loanId/disburse", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const loan = await loadLoan(req.welfare.id, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.status !== "approved") return res.status(400).json({ error: `Can only disburse an approved loan (this one is ${loan.status})` });
    const { loan: active, poolTxn } = await disburseMemberLoan({
      welfare: req.welfare, loan, startDate: req.body?.start_date, disbursementDate: req.body?.disbursement_date, userId: req.user.id,
    });
    await logAudit({ user: req.user, action: "member_loan_disbursed", entityType: "member_loan", entityId: loan.id, entityCode: loan.loan_code, description: `Loan ${loan.loan_code} disbursed: KES ${active.principal}`, req });
    res.json({ success: true, data: active, pool_balance: Number(poolTxn.balance_after) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member loan disburse error:", e);
    res.status(500).json({ error: "Failed to disburse loan" });
  }
});

export default router;
