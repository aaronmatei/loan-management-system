import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { buildLoanAgreementPdf } from "../utils/pdfDocuments.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { nextLoanCode } from "../utils/clientCode.js";
import { getLoanStanding } from "../utils/loanEligibility.js";
import {
  computeLoanTotals,
  validateAgainstPackage,
} from "../utils/loanMath.js";
import { evaluatePackageEligibility } from "../utils/packageEligibility.js";
import { recomputeCreditScoreForLoan } from "../services/creditScoreService.js";
import {
  notifyApplicationSubmitted,
  notifyApplicationApproved,
  notifyApplicationRejected,
  notifyCapitalLow,
} from "../services/notificationService.js";
import notificationDispatcher from "../services/notificationDispatcher.js";
import logger from "../config/logger.js";
import ExcelJS from "exceljs";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET ALL LOANS (with payment summary)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { status, client_id, overdue, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    // Per-loan overdue summary: installments either explicitly 'overdue' or
    // 'pending' but past due_date with a remaining balance. Joined as a
    // subquery so loans without any payment schedule still come through.
    let queryText = `
        SELECT
            l.*,
            c.first_name,
            c.last_name,
            c.phone_number,
            c.client_code,
            pk.name AS package_name,
            COALESCE(SUM(t.amount_paid), 0) as total_paid,
            COALESCE(SUM(t.penalty_portion), 0) as total_fines_paid,
            COALESCE(wv.waived_toward_balance, 0) as total_waived_toward_balance,
            COALESCE(wv.total_waived, 0) as total_waived,
            GREATEST(
              l.total_amount_due
              - (
                  COALESCE(SUM(t.amount_paid), 0)
                  - COALESCE(SUM(t.penalty_portion), 0)
                  - COALESCE(SUM(t.overpayment_portion), 0)
                )
              - COALESCE(wv.waived_toward_balance, 0),
              0
            ) as balance_due,
            COALESCE(od.overdue_count, 0)::int  AS overdue_count,
            COALESCE(od.overdue_amount, 0)      AS overdue_amount,
            COALESCE(od.max_days_late, 0)::int  AS max_days_late
        FROM loans l
        JOIN clients c ON l.client_id = c.id
        LEFT JOIN loan_packages pk ON pk.id = l.package_id
        LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
        LEFT JOIN (
          SELECT
            loan_id,
            COUNT(*) AS overdue_count,
            SUM(amount_due - COALESCE(amount_paid, 0)) AS overdue_amount,
            MAX(CURRENT_DATE - due_date::date) AS max_days_late
          FROM payment_schedules
          WHERE (status = 'overdue'
                 OR (status = 'pending' AND due_date < CURRENT_DATE))
            AND amount_due > COALESCE(amount_paid, 0)
          GROUP BY loan_id
        ) od ON od.loan_id = l.id
        LEFT JOIN (
          SELECT
            loan_id,
            COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
              AS waived_toward_balance,
            COALESCE(SUM(amount), 0) AS total_waived
          FROM loan_waivers
          WHERE status = 'approved'
          GROUP BY loan_id
        ) wv ON wv.loan_id = l.id
        WHERE 1=1
        `;
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND l.status = $${paramCount}`;
      params.push(status);
    }

    if (client_id) {
      paramCount++;
      queryText += ` AND l.client_id = $${paramCount}`;
      params.push(client_id);
    }

    if (overdue === "true") {
      queryText += ` AND COALESCE(od.overdue_count, 0) > 0`;
    } else if (overdue === "false") {
      queryText += ` AND COALESCE(od.overdue_count, 0) = 0`;
    }

    // Tenant scope (no-op for platform admins / pre-migration tokens)
    const lt = tenantClause(req, paramCount, "l.tenant_id");
    if (lt.clause) {
      paramCount++;
      queryText += lt.clause;
    }

    queryText += `
      GROUP BY l.id, c.first_name, c.last_name, c.phone_number, c.client_code,
               pk.name,
               od.overdue_count, od.overdue_amount, od.max_days_late,
               wv.waived_toward_balance, wv.total_waived
      ORDER BY l.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    params.push(...lt.params, limit, offset);

    const result = await query(queryText, params);

    const cT = tenantClause(req, 0);
    const countResult = await query(
      `SELECT COUNT(*) FROM loans WHERE 1=1${cT.clause}`,
      cT.params,
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get loans error:", error);
    res.status(500).json({ error: "Failed to fetch loans" });
  }
});

// ============================================================
// GET SINGLE LOAN WITH PAYMENT SCHEDULE
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Get loan with client info. LEFT JOIN to loan_packages so the
    // loan detail page can show "Package: <name>" — package_id is
    // nullable (custom / off-product loans), in which case the JOIN
    // simply yields NULL columns.
    const loanResult = await query(
      `SELECT
        l.*,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email,
        c.client_code,
        pk.name              AS package_name,
        pk.description       AS package_description,
        pk.interest_method   AS package_interest_method,
        pk.active            AS package_active
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      LEFT JOIN loan_packages pk ON pk.id = l.package_id
      WHERE l.id = $1${tenantClause(req, 1, "l.tenant_id").clause}`,
      [id, ...tenantClause(req, 1, "l.tenant_id").params],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    // Get payment schedule
    const scheduleResult = await query(
      `SELECT * FROM payment_schedules 
       WHERE loan_id = $1 
       ORDER BY payment_number ASC`,
      [id],
    );

    res.json({
      success: true,
      data: {
        ...loanResult.rows[0],
        payment_schedule: scheduleResult.rows,
      },
    });
  } catch (error) {
    logger.error("Get loan error:", error);
    res.status(500).json({ error: "Failed to fetch loan" });
  }
});

// ============================================================
// CREATE LOAN (with automatic payment schedule)
// ============================================================
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const {
      client_id,
      principal_amount,
      annual_interest_rate: bodyAnnualRate,
      loan_duration_months,
      start_date,
      purpose,
      guarantor_name,
      guarantor_phone,
      guarantor_id_number,
      collateral_description,
      late_payment_fee,
      penalty_rate,
      processing_fee_rate: bodyProcessingFeeRate,
      application_date: bodyApplicationDate,
      application_source,
      review_notes,
      package_id: bodyPackageId,
      interest_method: bodyInterestMethod,
    } = req.body;

    // Package-or-free-form. If a package is supplied, its mechanics
    // (rate, fee, method) take precedence over whatever the form
    // submitted — admins picked the package, so the form fields are
    // pre-filled but ultimately just preview. Range-validate amount +
    // duration against the package; rejection here is a 400, not a
    // schema error, so the UI can call out the offending field.
    let pkg = null;
    if (bodyPackageId) {
      const pkgT = tenantClause(req, 1);
      const pr = await query(
        `SELECT * FROM loan_packages WHERE id = $1${pkgT.clause}`,
        [bodyPackageId, ...pkgT.params],
      );
      if (pr.rows.length === 0 || !pr.rows[0].active) {
        return res
          .status(400)
          .json({ error: "Selected package is invalid or archived" });
      }
      pkg = pr.rows[0];
    }

    // Effective inputs: package overrides body for the locked fields;
    // free-form takes the body values.
    const annual_interest_rate = pkg
      ? parseFloat(pkg.annual_interest_rate)
      : bodyAnnualRate;
    const interestMethod = (
      pkg ? pkg.interest_method : bodyInterestMethod || "flat"
    )
      .toString()
      .toLowerCase();
    if (!["flat", "reducing"].includes(interestMethod)) {
      return res
        .status(400)
        .json({ error: "interest_method must be 'flat' or 'reducing'" });
    }

    // Validation. start_date is NOT required at application time —
    // it's set when the loan is disbursed.
    if (
      !client_id ||
      !principal_amount ||
      !annual_interest_rate ||
      !loan_duration_months
    ) {
      return res.status(400).json({
        error:
          "Client, amount, interest rate, and duration are required",
      });
    }

    if (pkg) {
      const rangeErr = validateAgainstPackage(
        pkg,
        principal_amount,
        loan_duration_months,
      );
      if (rangeErr) {
        return res.status(400).json({ error: rangeErr, blocker: "package_range" });
      }

      // Purpose gate — when the package pins a list of allowed
      // purposes, reject anything outside it. Empty list = any
      // purpose, matching the legacy behavior.
      const allowedPurposes = pkg.allowed_purposes || [];
      if (
        allowedPurposes.length > 0 &&
        purpose &&
        !allowedPurposes.includes(purpose)
      ) {
        return res.status(400).json({
          error: `"${pkg.name}" only supports these purposes: ${allowedPurposes.join(", ")}`,
          blocker: "package_purpose",
        });
      }

      // Eligibility gates (credit score / client_type / branch).
      // Reuse the row already fetched for the credit-eligibility
      // block above by querying its full shape — we only need three
      // columns. NULL credit_score is intentional: unrated clients
      // fail any min_credit_score check.
      const cli = await query(
        `SELECT credit_score, client_type, branch_id FROM clients WHERE id = $1`,
        [client_id],
      );
      const verdict = evaluatePackageEligibility(pkg, cli.rows[0] || {});
      if (!verdict.eligible) {
        return res.status(400).json({
          error: `Client not eligible for "${pkg.name}": ${verdict.reasons.join("; ")}`,
          blocker: "package_eligibility",
          reasons: verdict.reasons,
        });
      }
    }

    // Client must belong to the acting tenant (platform admin bypasses).
    const ccT = tenantClause(req, 1);
    const clientCheck = await query(
      `SELECT id FROM clients WHERE id = $1${ccT.clause}`,
      [client_id, ...ccT.params],
    );
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    // ✅ Client credit eligibility: block risky lending
    const clT = tenantClause(req, 1);
    const clientLoans = await query(
      `SELECT status FROM loans WHERE client_id = $1${clT.clause}`,
      [client_id, ...clT.params],
    );

    const activeLoans = clientLoans.rows.filter(
      (l) => l.status === "active",
    ).length;
    const defaultedLoans = clientLoans.rows.filter(
      (l) => l.status === "defaulted",
    ).length;

    const odT = tenantClause(req, 1, "l.tenant_id");
    const overdueCheck = await query(
      `SELECT COUNT(*) AS overdue_count
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.client_id = $1 AND ps.status = 'overdue'${odT.clause}`,
      [client_id, ...odT.params],
    );
    const overdueCount = parseInt(overdueCheck.rows[0].overdue_count, 10);

    if (defaultedLoans > 0) {
      return res.status(400).json({
        error: "Client has defaulted loans. Cannot issue new loan.",
        blocker: "defaulted_loans",
      });
    }

    if (overdueCount > 0) {
      return res.status(400).json({
        error: `Client has ${overdueCount} overdue payment(s). Must clear before new loan.`,
        blocker: "overdue_payments",
      });
    }

    if (activeLoans >= 3) {
      return res.status(400).json({
        error: "Client has reached maximum of 3 active loans.",
        blocker: "max_active_loans",
      });
    }

    // NOTE: capital-availability is NOT checked here — it is checked
    // at /approve, because the pool can change between application
    // and approval. Schedule, capital movement and notifications all
    // happen at /disburse, not at application.

    // Loan calculations via shared loanMath helper. interest_rate
    // column stores the MONTHLY rate as a percent (existing convention
    // — analytics, the agreement PDF, and every display derive annual
    // = interest_rate * 12 from it; do NOT change this to a fraction).
    // The interest method drives the math: 'flat' is the legacy
    // straight-line spread; 'reducing' is amortized (EMI) so interest
    // falls as the balance shrinks.
    const principal = parseFloat(principal_amount);
    const annualRate = parseFloat(annual_interest_rate);
    const monthlyRate = annualRate / 12;
    const months = parseInt(loan_duration_months);
    const { totalInterest, totalAmountDue } = computeLoanTotals({
      principal,
      annualRatePct: annualRate,
      months,
      method: interestMethod,
    });

    // Writes bind to the acting tenant (loans.tenant_id is NOT NULL).
    const wTid = req.user?.tenant_id;
    if (!wTid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    // Application date first — needed for the loan_code MMYYYY part
    // below so a back-dated application reads with its real date in
    // the code (e.g. 042022 for an April 2022 origination captured
    // today). Defaults to today; admins may back-date but a future
    // date is rejected.
    let appDate = null;
    if (bodyApplicationDate) {
      const d = new Date(bodyApplicationDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid application_date" });
      }
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (d > todayEnd) {
        return res
          .status(400)
          .json({ error: "Application date cannot be in the future" });
      }
      appDate = bodyApplicationDate;
    }

    // Canonical loan_code via shared helper:
    //   LN-<PREFIX>-<MMYYYY>-<NNNNN>
    // MM + YYYY come from application_date (today if none supplied),
    // sequence is MAX(suffix)+1 — safe against historic deletions and
    // works across the legacy YYYY-only format too.
    const loanCode = await nextLoanCode(query, wTid, appDate || new Date());

    // Processing fee snapshot: a % of the principal, deducted from what the
    // borrower receives (net disbursed). The form may override the tenant's
    // configured rate per loan; if not, fall back to the tenant policy.
    let processingFeeRate;
    if (
      bodyProcessingFeeRate !== undefined &&
      bodyProcessingFeeRate !== null &&
      bodyProcessingFeeRate !== ""
    ) {
      const parsed = parseFloat(bodyProcessingFeeRate);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return res
          .status(400)
          .json({ error: "Processing fee rate must be between 0 and 100" });
      }
      processingFeeRate = parsed;
    } else {
      const feeRow = await query(
        `SELECT COALESCE(processing_fee_rate, 0) AS rate FROM tenants WHERE id = $1`,
        [wTid],
      );
      processingFeeRate = parseFloat(feeRow.rows[0]?.rate || 0);
    }
    const processingFee =
      Math.round(principal * processingFeeRate) / 100; // principal * rate/100
    const netDisbursed = Math.round((principal - processingFee) * 100) / 100;

    // (appDate already computed above so it could flow into the
    // MMYYYY portion of the loan_code.)

    // Create as a PENDING application: no start/end date, no schedule,
    // no capital movement, no notifications until disbursement.
    const loanResult = await query(
      `INSERT INTO loans (
        tenant_id, loan_code, client_id, principal_amount, interest_rate,
        loan_duration_months, total_amount_due, total_interest,
        status, created_by, purpose,
        guarantor_name, guarantor_phone, guarantor_id_number,
        collateral_description, late_payment_fee, penalty_rate,
        processing_fee_rate, processing_fee, net_disbursed_amount,
        application_date, application_source, review_notes,
        package_id, interest_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, COALESCE($22::date, CURRENT_DATE), $20, $21, $23, $24)
      RETURNING *`,
      [
        wTid,
        loanCode,
        client_id,
        principal,
        monthlyRate,
        months,
        totalAmountDue,
        totalInterest,
        req.user.id,
        purpose || null,
        guarantor_name || null,
        guarantor_phone || null,
        guarantor_id_number || null,
        collateral_description || null,
        // `??` not `||` — when the admin toggles "Late Fee" OFF the
        // form sends 0, which is a legitimate value meaning "no fee".
        // `||` was treating 0 as falsy and silently restoring the 500
        // default, so every "fee disabled" loan was actually charging
        // 500. Same shape for penalty_rate.
        late_payment_fee ?? 500,
        penalty_rate ?? 5.0,
        processingFeeRate,
        processingFee,
        netDisbursed,
        application_source || "walk_in",
        review_notes || null,
        appDate,
        pkg ? pkg.id : null,
        interestMethod,
      ],
    );

    const loan = loanResult.rows[0];

    await logAudit({
      user: req.user,
      action: "application_submitted",
      entityType: "loan",
      entityId: loan.id,
      entityCode: loan.loan_code,
      description: `Loan application submitted: KES ${principal.toLocaleString()} for ${months} months`,
      newValues: {
        principal_amount: principal,
        interest_rate: annualRate,
        duration: months,
      },
      req,
    });

    try {
      const ci = await query("SELECT * FROM clients WHERE id = $1", [
        client_id,
      ]);
      if (ci.rows[0]) {
        // Staff bell (in-app notification)
        await notifyApplicationSubmitted(loan, ci.rows[0]);
        // Customer ack — SMS + Email via the central dispatcher so it
        // lands in sms_logs / email_logs alongside every other lifecycle
        // event (tenant prefs gate each channel).
        notificationDispatcher
          .notify("application_submitted", {
            tenantId: loan.tenant_id,
            customer: { ...ci.rows[0], client_id: ci.rows[0].id },
            data: {
              loan_id: loan.id,
              loan_code: loan.loan_code,
              amount: loan.principal_amount,
              duration_months: loan.loan_duration_months,
            },
          })
          .catch((err) =>
            logger.error("notify(application_submitted) error:", err),
          );
      }
    } catch (err) {
      logger.error("notifyApplicationSubmitted error:", err);
    }

    logger.info(
      `✓ Loan application submitted: ${loanCode}, KES ${principal}`,
    );

    res.status(201).json({
      success: true,
      message: "Loan application submitted for review",
      data: {
        ...loan,
        annual_interest_rate: annualRate,
        monthly_interest_rate: monthlyRate,
      },
    });
  } catch (error) {
    logger.error("Submit loan application error:", error);
    res.status(500).json({ error: "Failed to submit application" });
  }
});

// ============================================================
// BULK APPLICATION ACTIONS (from the Applications page)
//   review   → move pending loans to under_review
//   approve  → move pending/under_review to approved (eligibility + capital)
//   reject   → move pending/under_review to rejected (requires reason)
// Defined BEFORE the /:id/* routes so Express matches "/bulk/review"
// before "/:id/review" (which would otherwise treat "bulk" as the :id).
// ============================================================
async function loadOwnedLoans(req, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(
    `SELECT * FROM loans WHERE id = ANY($1)${tc.clause}`,
    [ids, ...tc.params],
  );
  return r.rows;
}

// Single-query client lookup for the bulk endpoints — avoids the
// per-loan N+1 the single-endpoint pattern would imply if copied as-is.
async function loadClientsById(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const r = await query(
    `SELECT id, first_name, last_name, phone_number, email
       FROM clients WHERE id = ANY($1)`,
    [ids],
  );
  return new Map(r.rows.map((c) => [c.id, c]));
}

router.post(
  "/bulk/review",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { loan_ids } = req.body || {};
      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      const tc = tenantClause(req, 2, "tenant_id");
      const r = await query(
        `UPDATE loans SET status = 'under_review',
                          reviewed_by = $1, reviewed_at = NOW(),
                          updated_at = NOW()
          WHERE id = ANY($2) AND status = 'pending'${tc.clause}
         RETURNING *`,
        [req.user.id, loan_ids, ...tc.params],
      );
      // Pre-load clients once for the customer-side dispatcher fan-out.
      const clientIds = [...new Set(r.rows.map((l) => l.client_id))];
      const clientById = await loadClientsById(clientIds);
      for (const loan of r.rows) {
        await logAudit({
          user: req.user,
          action: "application_under_review",
          entityType: "loan",
          entityId: loan.id,
          entityCode: loan.loan_code,
          description: `Moved ${loan.loan_code} to under review (bulk)`,
          req,
        });
        const c = clientById.get(loan.client_id);
        if (c) {
          notificationDispatcher
            .notify("application_under_review", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: { loan_id: loan.id, loan_code: loan.loan_code },
            })
            .catch((err) => logger.error("bulk review notify error:", err));
        }
      }
      res.json({
        success: true,
        processed: r.rows.length,
        skipped: loan_ids.length - r.rows.length,
      });
    } catch (error) {
      logger.error("Bulk review error:", error);
      res.status(500).json({ error: "Failed to mark loans under review" });
    }
  },
);

router.post(
  "/bulk/approve",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { loan_ids } = req.body || {};
      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      const loans = await loadOwnedLoans(req, loan_ids);
      const processed = [];
      const skipped = [];

      // Pre-load clients once for the in-app + customer dispatcher
      // notifications that fire after each successful approval.
      const clientById = await loadClientsById([
        ...new Set((loans || []).map((l) => l.client_id)),
      ]);

      // Snapshot the pool once and burn it down as we approve — multiple
      // approvals all draw from the same available figure (capital only
      // moves at disbursement, but it's still the right gate).
      const tid = req.user.tenant_id;
      let available = Infinity;
      if (tid) {
        const pr = await query(
          `SELECT (initial_capital - total_disbursed + total_collected + total_interest_earned) AS a
             FROM capital_pool WHERE tenant_id = $1`,
          [tid],
        );
        if (pr.rows[0]) available = parseFloat(pr.rows[0].a);
      }

      for (const loan of loans) {
        if (!["pending", "under_review"].includes(loan.status)) {
          skipped.push({ id: loan.id, loan_code: loan.loan_code, reason: `status ${loan.status}` });
          continue;
        }
        const standing = await getLoanStanding(loan.client_id, loan.tenant_id, {
          excludeLoanId: loan.id,
        });
        if (standing.defaulted > 0) {
          skipped.push({ id: loan.id, loan_code: loan.loan_code, reason: "client has a defaulted loan" });
          continue;
        }
        if (standing.active >= 3) {
          skipped.push({ id: loan.id, loan_code: loan.loan_code, reason: "client at 3-active cap" });
          continue;
        }
        const principal = parseFloat(loan.principal_amount);
        if (principal > available) {
          skipped.push({ id: loan.id, loan_code: loan.loan_code, reason: "insufficient capital" });
          continue;
        }

        const upd = await query(
          `UPDATE loans SET status = 'approved',
                            approved_by = $1, approved_at = NOW(),
                            updated_at = NOW()
            WHERE id = $2 RETURNING id, loan_code`,
          [req.user.id, loan.id],
        );
        if (!upd.rows[0]) continue;
        processed.push(upd.rows[0]);
        await logAudit({
          user: req.user,
          action: "application_approved",
          entityType: "loan",
          entityId: loan.id,
          entityCode: loan.loan_code,
          description: `Approved ${loan.loan_code} (bulk)`,
          req,
        });
        // In-app for the loan officer who created the application.
        if (loan.created_by) {
          await notifyApplicationApproved(loan, loan.created_by);
        }
        // Customer SMS + Email via the dispatcher.
        const c = clientById.get(loan.client_id);
        if (c) {
          notificationDispatcher
            .notify("application_approved", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: {
                loan_id: loan.id,
                loan_code: loan.loan_code,
                amount: loan.principal_amount,
                duration_months: loan.loan_duration_months,
                interest_rate: loan.interest_rate,
              },
            })
            .catch((err) => logger.error("bulk approve notify error:", err));
        }
      }
      res.json({
        success: true,
        processed: processed.length,
        skipped: skipped.length + (loan_ids.length - loans.length),
        details: skipped,
      });
    } catch (error) {
      logger.error("Bulk approve error:", error);
      res.status(500).json({ error: "Failed to approve loans" });
    }
  },
);

router.post(
  "/bulk/reject",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { loan_ids, reason } = req.body || {};
      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: "A rejection reason is required" });
      }
      const tc = tenantClause(req, 3, "tenant_id");
      const cleanReason = String(reason).trim();
      const r = await query(
        `UPDATE loans SET status = 'rejected',
                          rejected_by = $1, rejected_at = NOW(),
                          rejection_reason = $2,
                          updated_at = NOW()
          WHERE id = ANY($3)
            AND status IN ('pending','under_review')${tc.clause}
         RETURNING *`,
        [req.user.id, cleanReason, loan_ids, ...tc.params],
      );
      const clientById = await loadClientsById([
        ...new Set(r.rows.map((l) => l.client_id)),
      ]);
      for (const loan of r.rows) {
        await logAudit({
          user: req.user,
          action: "application_rejected",
          entityType: "loan",
          entityId: loan.id,
          entityCode: loan.loan_code,
          description: `Rejected ${loan.loan_code} (bulk): ${cleanReason}`,
          newValues: { reason: cleanReason },
          req,
        });
        if (loan.created_by) {
          await notifyApplicationRejected(loan, loan.created_by, cleanReason);
        }
        const c = clientById.get(loan.client_id);
        if (c) {
          notificationDispatcher
            .notify("application_rejected", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: {
                loan_id: loan.id,
                loan_code: loan.loan_code,
                reason: cleanReason,
              },
            })
            .catch((err) => logger.error("bulk reject notify error:", err));
        }
      }
      res.json({
        success: true,
        processed: r.rows.length,
        skipped: loan_ids.length - r.rows.length,
      });
    } catch (error) {
      logger.error("Bulk reject error:", error);
      res.status(500).json({ error: "Failed to reject loans" });
    }
  },
);

// ============================================================
// APPLICATION WORKFLOW: review → approve/reject → disburse
// ============================================================

// Mark as under review
router.post(
  "/:id/review",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body || {};
      const rvT = tenantClause(req, 3);
      const result = await query(
        `UPDATE loans SET
          status = 'under_review', reviewed_by = $1, reviewed_at = NOW(),
          review_notes = COALESCE($2, review_notes), updated_at = NOW()
        WHERE id = $3 AND status = 'pending'${rvT.clause}
        RETURNING *`,
        [req.user.id, notes || null, id, ...rvT.params],
      );
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Loan not found or not in pending status" });
      }
      await logAudit({
        user: req.user,
        action: "application_review_started",
        entityType: "loan",
        entityId: id,
        entityCode: result.rows[0].loan_code,
        description: "Started reviewing loan application",
        req,
      });

      // Customer SMS + Email via central dispatcher.
      try {
        const loan = result.rows[0];
        const meta = await query(
          `SELECT c.phone_number, c.first_name, c.last_name, c.email
             FROM clients c WHERE c.id = $1`,
          [loan.client_id],
        );
        const c = meta.rows[0];
        if (c) {
          notificationDispatcher
            .notify("application_under_review", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: { loan_id: loan.id, loan_code: loan.loan_code },
            })
            .catch((err) => logger.error("notify error:", err));
        }
      } catch (err) {
        logger.error("Review notification error:", err);
      }

      res.json({
        success: true,
        message: "Loan marked as under review",
        data: result.rows[0],
      });
    } catch (error) {
      logger.error("Review loan error:", error);
      res.status(500).json({ error: "Failed to mark as under review" });
    }
  },
);

// Approve (capital availability is checked HERE, not at application)
router.post(
  "/:id/approve",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body || {};

      const apT = tenantClause(req, 1);
      const loanCheck = await query(
        `SELECT * FROM loans WHERE id = $1${apT.clause}`,
        [id, ...apT.params],
      );
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (!["pending", "under_review"].includes(loan.status)) {
        return res
          .status(400)
          .json({ error: `Cannot approve loan with status: ${loan.status}` });
      }

      // Re-check borrowing eligibility — the client may have defaulted (or hit
      // the active-loan cap) since this application was submitted.
      const apStanding = await getLoanStanding(loan.client_id, loan.tenant_id, {
        excludeLoanId: loan.id,
      });
      if (apStanding.defaulted > 0) {
        return res.status(400).json({
          error: "Client has a defaulted loan. Resolve it before approving a new one.",
          blocker: "defaulted_loans",
        });
      }
      if (apStanding.active >= 3) {
        return res.status(400).json({
          error: "Client already has 3 active loans — the maximum allowed.",
          blocker: "max_active_loans",
        });
      }

      // Per-tenant capital pool (NOT the global "latest" row).
      const poolCheck = await query(
        `SELECT (initial_capital - total_disbursed + total_collected + total_interest_earned) AS available
         FROM capital_pool WHERE tenant_id = $1`,
        [loan.tenant_id],
      );
      if (poolCheck.rows.length > 0) {
        const available = parseFloat(poolCheck.rows[0].available);
        if (parseFloat(loan.principal_amount) > available) {
          return res.status(400).json({
            error: `Insufficient capital. Available: KES ${available.toLocaleString()}, Required: KES ${parseFloat(
              loan.principal_amount,
            ).toLocaleString()}`,
          });
        }
      }

      const result = await query(
        `UPDATE loans SET
          status = 'approved', approved_by = $1, approved_at = NOW(),
          review_notes = COALESCE($2, review_notes), updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [req.user.id, notes || null, id, loan.tenant_id],
      );
      await logAudit({
        user: req.user,
        action: "application_approved",
        entityType: "loan",
        entityId: id,
        entityCode: loan.loan_code,
        description: `Approved loan application: KES ${parseFloat(
          loan.principal_amount,
        ).toLocaleString()}`,
        req,
      });
      if (loan.created_by) {
        await notifyApplicationApproved(result.rows[0], loan.created_by);
      }

      // Customer SMS + Email via central dispatcher (migration 013
      // tenant prefs gate each channel).
      try {
        const meta = await query(
          `SELECT c.phone_number, c.first_name, c.last_name, c.email
             FROM clients c WHERE c.id = $1`,
          [loan.client_id],
        );
        const c = meta.rows[0];
        if (c) {
          notificationDispatcher
            .notify("application_approved", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: {
                loan_id: loan.id,
                loan_code: loan.loan_code,
                amount: loan.principal_amount,
                duration_months: loan.loan_duration_months,
                interest_rate: loan.interest_rate,
              },
            })
            .catch((err) => logger.error("notify error:", err));
        }
      } catch (err) {
        logger.error("Approve notification error:", err);
      }

      res.json({
        success: true,
        message: "Loan approved! Ready for disbursement.",
        data: result.rows[0],
      });
    } catch (error) {
      logger.error("Approve loan error:", error);
      res.status(500).json({ error: "Failed to approve loan" });
    }
  },
);

// Reject (reason required)
router.post(
  "/:id/reject",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      if (!reason || reason.trim().length === 0) {
        return res
          .status(400)
          .json({ error: "Rejection reason is required" });
      }
      const rjT = tenantClause(req, 1);
      const loanCheck = await query(
        `SELECT * FROM loans WHERE id = $1${rjT.clause}`,
        [id, ...rjT.params],
      );
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (!["pending", "under_review"].includes(loan.status)) {
        return res
          .status(400)
          .json({ error: `Cannot reject loan with status: ${loan.status}` });
      }
      const result = await query(
        `UPDATE loans SET
          status = 'rejected', rejected_by = $1, rejected_at = NOW(),
          rejection_reason = $2, updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [req.user.id, reason, id, loan.tenant_id],
      );
      await logAudit({
        user: req.user,
        action: "application_rejected",
        entityType: "loan",
        entityId: id,
        entityCode: loan.loan_code,
        description: `Rejected loan application: ${reason}`,
        newValues: { rejection_reason: reason },
        req,
      });
      if (loan.created_by) {
        await notifyApplicationRejected(
          result.rows[0],
          loan.created_by,
          reason,
        );
      }

      // Customer SMS + Email via central dispatcher.
      try {
        const meta = await query(
          `SELECT c.phone_number, c.first_name, c.last_name, c.email
             FROM clients c WHERE c.id = $1`,
          [loan.client_id],
        );
        const c = meta.rows[0];
        if (c) {
          notificationDispatcher
            .notify("application_rejected", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: {
                loan_id: loan.id,
                loan_code: loan.loan_code,
                reason,
              },
            })
            .catch((err) => logger.error("notify error:", err));
        }
      } catch (err) {
        logger.error("Reject notification error:", err);
      }

      res.json({
        success: true,
        message: "Loan application rejected",
        data: result.rows[0],
      });
    } catch (error) {
      logger.error("Reject loan error:", error);
      res.status(500).json({ error: "Failed to reject loan" });
    }
  },
);

// Counter-offer — reduce the principal to what the client qualifies for and
// send it back for the client to accept/reject (status → 'counter_offered').
router.post(
  "/:id/counter-offer",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { offered_amount, note } = req.body || {};

      const amount = parseFloat(offered_amount);
      if (!offered_amount || isNaN(amount) || amount <= 0) {
        return res
          .status(400)
          .json({ error: "A positive offered_amount is required" });
      }

      const coT = tenantClause(req, 1);
      const loanCheck = await query(
        `SELECT * FROM loans WHERE id = $1${coT.clause}`,
        [id, ...coT.params],
      );
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (!["pending", "under_review"].includes(loan.status)) {
        return res.status(400).json({
          error: `Cannot counter-offer a loan with status: ${loan.status}`,
        });
      }
      // A counter-offer must REDUCE the principal.
      if (amount >= parseFloat(loan.principal_amount)) {
        return res.status(400).json({
          error: `Offered amount must be less than the requested KES ${parseFloat(
            loan.principal_amount,
          ).toLocaleString()}`,
        });
      }

      const result = await query(
        `UPDATE loans SET
           status = 'counter_offered',
           requested_amount = principal_amount,
           offered_amount = $1,
           counter_offer_note = $2,
           counter_offered_by = $3,
           counter_offered_at = NOW(),
           reviewed_by = COALESCE(reviewed_by, $3),
           reviewed_at = COALESCE(reviewed_at, NOW()),
           updated_at = NOW()
         WHERE id = $4 AND tenant_id = $5 RETURNING *`,
        [amount, note || null, req.user.id, id, loan.tenant_id],
      );

      await logAudit({
        user: req.user,
        action: "counter_offered",
        entityType: "loan",
        entityId: id,
        entityCode: loan.loan_code,
        description: `Counter-offered KES ${amount.toLocaleString()} (requested KES ${parseFloat(
          loan.principal_amount,
        ).toLocaleString()})`,
        newValues: { offered_amount: amount, note: note || null },
        req,
      });

      // Customer SMS + Email via the central dispatcher so it lands in
      // sms_logs / email_logs and respects the tenant's per-event toggle.
      try {
        const meta = await query(
          `SELECT phone_number, first_name, last_name, email FROM clients WHERE id = $1`,
          [loan.client_id],
        );
        const c = meta.rows[0];
        if (c) {
          notificationDispatcher
            .notify("counter_offered", {
              tenantId: loan.tenant_id,
              customer: { ...c, client_id: loan.client_id },
              data: {
                loan_id: loan.id,
                loan_code: loan.loan_code,
                offered_amount: amount,
                requested_amount: loan.principal_amount,
                note: note || null,
              },
            })
            .catch((e) =>
              logger.error("notify(counter_offered) error:", e),
            );
        }
      } catch (err) {
        logger.error("Counter-offer notification error:", err);
      }

      res.json({
        success: true,
        message: "Counter-offer sent to client",
        data: result.rows[0],
      });
    } catch (error) {
      logger.error("Counter-offer error:", error);
      res.status(500).json({ error: "Failed to send counter-offer" });
    }
  },
);

// Shared disbursement core. Caller guarantees loan.status === 'approved'
// and that standing + capital gates have already passed. Returns the
// updated active loan row, or throws a tagged Error with .clientMessage
// for callers to surface.
async function performDisburse(req, loan, opts) {
  const {
    disbursement_method,
    disbursement_reference,
    disbursement_date,
    start_date,
  } = opts || {};

  const months = parseInt(loan.loan_duration_months, 10);
  const disbDate =
    disbursement_date || new Date().toISOString().split("T")[0];

  let effectiveStart;
  if (start_date) {
    const sd = new Date(start_date);
    if (Number.isNaN(sd.getTime())) {
      const e = new Error("Invalid start_date");
      e.clientMessage = "Invalid start_date";
      throw e;
    }
    if (new Date(start_date) < new Date(disbDate)) {
      const e = new Error("start before disb");
      e.clientMessage = "Start date cannot be before the disbursement date.";
      throw e;
    }
    effectiveStart = new Date(start_date).toISOString().split("T")[0];
  } else {
    const startObj = new Date(disbDate);
    startObj.setMonth(startObj.getMonth() + 1);
    effectiveStart = startObj.toISOString().split("T")[0];
  }

  const endObj = new Date(effectiveStart);
  endObj.setMonth(endObj.getMonth() + months - 1);

  const result = await query(
    `UPDATE loans SET
      status = 'active', disbursed_by = $1, disbursed_at = $2::timestamp,
      disbursement_method = $3, disbursement_reference = $4,
      start_date = $5, end_date = $6, updated_at = NOW()
    WHERE id = $7 AND tenant_id = $8 RETURNING *`,
    [
      req.user.id,
      disbDate,
      disbursement_method || "cash",
      disbursement_reference || null,
      effectiveStart,
      endObj.toISOString().split("T")[0],
      loan.id,
      loan.tenant_id,
    ],
  );
  const active = result.rows[0];

  // Payment schedule anchored on effectiveStart. Per-installment
  // amounts come from computeLoanTotals so the 'reducing' (EMI) path
  // gets a properly-amortized schedule — flat keeps the legacy even
  // split. The last row is pinned to the residual balance so cents
  // never drift across rounding.
  const monthlyRatePct = parseFloat(loan.interest_rate) || 0;
  const { schedule } = computeLoanTotals({
    principal: parseFloat(loan.principal_amount),
    annualRatePct: monthlyRatePct * 12,
    months,
    method: loan.interest_method || "flat",
  });
  const scheduleAnchor = new Date(effectiveStart);
  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(scheduleAnchor);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const row = schedule[i - 1];
    await query(
      `INSERT INTO payment_schedules (
        tenant_id, loan_id, payment_number, due_date, amount_due, status
      ) VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [
        loan.tenant_id,
        loan.id,
        i,
        dueDate.toISOString().split("T")[0],
        row.amountDue.toFixed(2),
      ],
    );
  }

  // Capital pool — debit principal, credit processing fee as income.
  const principal = parseFloat(loan.principal_amount);
  const processingFee = parseFloat(loan.processing_fee || 0);
  await query(
    `UPDATE capital_pool
       SET total_disbursed = total_disbursed + $1,
           total_interest_earned = total_interest_earned + $2,
           updated_at = NOW()
     WHERE tenant_id = $3`,
    [principal, processingFee, loan.tenant_id],
  );
  await query(
    `INSERT INTO capital_transactions (tenant_id, transaction_type, amount, loan_id, description)
     VALUES ($1, 'loan_disbursed', $2, $3, $4)`,
    [
      loan.tenant_id,
      principal,
      loan.id,
      processingFee > 0
        ? `Loan ${loan.loan_code} disbursed (KES ${processingFee.toLocaleString()} processing fee retained as income)`
        : `Loan ${loan.loan_code} disbursed`,
    ],
  );

  // Capital-low bell — fire and forget.
  (async () => {
    try {
      const cp = await query(
        `SELECT initial_capital,
                (initial_capital - total_disbursed + total_collected + total_interest_earned) AS available
         FROM capital_pool WHERE tenant_id = $1`,
        [loan.tenant_id],
      );
      if (cp.rows[0]) {
        await notifyCapitalLow(
          loan.tenant_id,
          cp.rows[0].available,
          cp.rows[0].initial_capital,
        );
      }
    } catch (err) {
      logger.error("notifyCapitalLow (disburse) error:", err);
    }
  })();

  // Customer SMS + Email — fire and forget so the response isn't held
  // up while the agreement PDF renders.
  (async () => {
    try {
      const c = await query(
        "SELECT phone_number, first_name, last_name, email FROM clients WHERE id = $1",
        [loan.client_id],
      );
      const cust = c.rows[0];
      if (!cust) return;
      let attachments;
      if (cust.email) {
        try {
          const { buffer, filename } = await buildLoanAgreementPdf(loan.id);
          attachments = [{ filename, content: buffer }];
        } catch (pdfErr) {
          logger.error("Loan-agreement PDF build error:", pdfErr);
        }
      }
      await notificationDispatcher.notify("loan_disbursed", {
        tenantId: loan.tenant_id,
        customer: { ...cust, client_id: loan.client_id },
        data: {
          loan_id: loan.id,
          loan_code: loan.loan_code,
          amount: principal,
          total_amount_due: loan.total_amount_due,
          duration_months: loan.loan_duration_months,
        },
        attachments,
      });
    } catch (err) {
      logger.error("Disbursement notification error:", err);
    }
  })();

  await logAudit({
    user: req.user,
    action: "loan_disbursed",
    entityType: "loan",
    entityId: loan.id,
    entityCode: loan.loan_code,
    description: `Disbursed loan: KES ${principal.toLocaleString()} via ${
      disbursement_method || "cash"
    }`,
    newValues: { disbursement_method, disbursement_reference },
    req,
  });
  logger.info(
    `✓ Loan ${loan.loan_code} disbursed: KES ${principal.toLocaleString()}`,
  );
  return active;
}

// Mass disburse — per-loan options come in via `items`: each row has
// its own id, method, reference, disbursement_date, start_date. Per-loan
// status, standing, and capital gates are re-checked. Capital is burned
// down across the batch so two big loans can't both pass the gate when
// the pool only covers one.
//
// Declared BEFORE "/:id/disburse" so Express routes "/bulk/disburse"
// here instead of treating "bulk" as the :id (same pattern as the other
// bulk endpoints near the top of this file).
router.post(
  "/bulk/disburse",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { items } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      const ids = items.map((i) => i?.id).filter(Boolean);
      if (ids.length === 0) {
        return res.status(400).json({ error: "No loan ids provided" });
      }
      const loans = await loadOwnedLoans(req, ids);
      const byId = new Map((loans || []).map((l) => [l.id, l]));

      const tid = req.user.tenant_id;
      let available = Infinity;
      if (tid) {
        const pr = await query(
          `SELECT (initial_capital - total_disbursed + total_collected + total_interest_earned) AS a
             FROM capital_pool WHERE tenant_id = $1`,
          [tid],
        );
        if (pr.rows[0]) available = parseFloat(pr.rows[0].a);
      }

      const processed = [];
      const skipped = [];

      for (const item of items) {
        const loan = byId.get(item?.id);
        if (!loan) {
          skipped.push({ id: item?.id, reason: "not found" });
          continue;
        }
        if (loan.status !== "approved") {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: `status ${loan.status}`,
          });
          continue;
        }
        const standing = await getLoanStanding(loan.client_id, loan.tenant_id, {
          excludeLoanId: loan.id,
        });
        if (standing.defaulted > 0) {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: "client has a defaulted loan",
          });
          continue;
        }
        if (standing.active >= 3) {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: "client at 3-active cap",
          });
          continue;
        }
        const principal = parseFloat(loan.principal_amount);
        if (principal > available) {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: "insufficient capital",
          });
          continue;
        }
        try {
          const active = await performDisburse(req, loan, item);
          processed.push({ id: active.id, loan_code: active.loan_code });
          available -= principal;
        } catch (err) {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: err?.clientMessage || err?.message || "failed",
          });
        }
      }

      res.json({
        success: true,
        processed: processed.length,
        skipped: skipped.length,
        details: skipped,
      });
    } catch (error) {
      logger.error("Bulk disburse error:", error);
      res.status(500).json({ error: "Failed to disburse loans" });
    }
  },
);

// Disburse — money goes out: loan becomes active, schedule is
// generated, capital pool is debited, and the loan-disbursed SMS +
// agreement-PDF email fire HERE.
router.post(
  "/:id/disburse",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const dbT = tenantClause(req, 1);
      const loanCheck = await query(
        `SELECT * FROM loans WHERE id = $1${dbT.clause}`,
        [id, ...dbT.params],
      );
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (loan.status !== "approved") {
        return res.status(400).json({
          error: `Cannot disburse loan with status: ${loan.status}. Loan must be approved first.`,
        });
      }

      const dbStanding = await getLoanStanding(loan.client_id, loan.tenant_id, {
        excludeLoanId: loan.id,
      });
      if (dbStanding.defaulted > 0) {
        return res.status(400).json({
          error: "Client has a defaulted loan. Resolve it before disbursing a new one.",
          blocker: "defaulted_loans",
        });
      }
      if (dbStanding.active >= 3) {
        return res.status(400).json({
          error: "Client already has 3 active loans — the maximum allowed.",
          blocker: "max_active_loans",
        });
      }

      const active = await performDisburse(req, loan, req.body || {});
      res.json({
        success: true,
        message: "Loan disbursed successfully",
        data: active,
      });
    } catch (error) {
      if (error?.clientMessage) {
        return res.status(400).json({ error: error.clientMessage });
      }
      logger.error("Disburse loan error:", error);
      res.status(500).json({ error: "Failed to disburse loan" });
    }
  },
);

// Application queue
router.get("/applications/queue", async (req, res) => {
  try {
    const { status } = req.query;
    let queryText = `
      SELECT l.*,
        c.first_name, c.last_name, c.phone_number, c.client_code, c.county,
        creator.first_name AS created_by_name,
        reviewer.first_name AS reviewed_by_name,
        approver.first_name AS approved_by_name
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      LEFT JOIN users creator ON l.created_by = creator.id
      LEFT JOIN users reviewer ON l.reviewed_by = reviewer.id
      LEFT JOIN users approver ON l.approved_by = approver.id
      WHERE l.status IN ('pending', 'under_review', 'counter_offered', 'approved', 'rejected')
    `;
    const params = [];
    if (status && status !== "all") {
      params.push(status);
      queryText += ` AND l.status = $${params.length}`;
    }
    const aqT = tenantClause(req, params.length, "l.tenant_id");
    queryText += aqT.clause;
    params.push(...aqT.params);
    queryText += ` ORDER BY l.application_date DESC, l.created_at DESC`;
    const result = await query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get applications queue error:", error);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// Application stats
router.get("/applications/stats", async (req, res) => {
  try {
    const asT = tenantClause(req, 0);
    const result = await query(
      `SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status = 'under_review' THEN 1 END) AS under_review,
        COUNT(CASE WHEN status = 'counter_offered' THEN 1 END) AS counter_offered,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
        COUNT(CASE WHEN status = 'rejected' AND rejected_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS rejected_30d,
        COUNT(CASE WHEN status = 'active' AND disbursed_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS disbursed_30d,
        AVG(EXTRACT(EPOCH FROM (approved_at - application_date::timestamp)) / 3600)::int AS avg_approval_hours
      FROM loans
      WHERE status IN ('pending', 'under_review', 'counter_offered', 'approved', 'rejected', 'active')${asT.clause}`,
      asT.params,
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error("Application stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});
// ============================================================
// UPDATE LOAN (status / notes / purpose — with restrictions)
// ============================================================
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, purpose } = req.body;

    const exT = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM loans WHERE id = $1${exT.clause}`,
      [id, ...exT.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const currentLoan = existing.rows[0];
    const cLtid = currentLoan.tenant_id;

    // Cannot modify completed loans (status can only stay 'completed')
    if (
      currentLoan.status === "completed" &&
      status &&
      status !== "completed"
    ) {
      return res.status(400).json({ error: "Cannot modify completed loans" });
    }

    const validStatuses = ["active", "completed", "defaulted", "suspended"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const paymentsCheck = await query(
      `SELECT COUNT(*) as count FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
      [id],
    );
    const hasPayments = parseInt(paymentsCheck.rows[0].count, 10) > 0;

    // Cannot mark as completed while a balance remains
    if (status === "completed" && hasPayments) {
      const paidResult = await query(
        `SELECT COALESCE(SUM(amount_paid), 0) as total_paid
         FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
        [id],
      );
      const totalPaid = parseFloat(paidResult.rows[0].total_paid);
      const totalDue = parseFloat(currentLoan.total_amount_due);

      if (totalPaid < totalDue) {
        return res.status(400).json({
          error: `Cannot mark as completed. Balance of KES ${(
            totalDue - totalPaid
          ).toLocaleString()} still pending.`,
        });
      }
    }

    const result = await query(
      `UPDATE loans SET
        status = COALESCE($1, status),
        purpose = COALESCE($2, purpose),
        notes = COALESCE($3, notes),
        updated_at = NOW()
      WHERE id = $4 AND tenant_id = $5
      RETURNING *`,
      [status || null, purpose || null, notes || null, id, cLtid],
    );

    // Marking defaulted: push pending installments to overdue
    if (status === "defaulted") {
      await query(
        `UPDATE payment_schedules
         SET status = 'overdue',
             days_late = (CURRENT_DATE - due_date::date),
             updated_at = NOW()
         WHERE loan_id = $1 AND status = 'pending'`,
        [id],
      );
    }

    const statusChanged = status && status !== currentLoan.status;
    await logAudit({
      user: req.user,
      action: statusChanged ? "status_changed" : "updated",
      entityType: "loan",
      entityId: id,
      entityCode: currentLoan.loan_code,
      description: statusChanged
        ? `Changed loan ${currentLoan.loan_code} status from "${currentLoan.status}" to "${status}"`
        : `Updated loan ${currentLoan.loan_code}`,
      oldValues: {
        status: currentLoan.status,
        purpose: currentLoan.purpose,
        notes: currentLoan.notes,
      },
      newValues: { status, purpose, notes },
      req,
    });

    logger.info(
      `✓ Loan updated: ${currentLoan.loan_code} - Status: ${
        status || currentLoan.status
      }`,
    );

    res.json({
      success: true,
      message: "Loan updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update loan error:", error);
    res.status(500).json({ error: "Failed to update loan" });
  }
});

// ============================================================
// EDIT LOAN — full-field edit (admin + manager).
//
// All fields are editable, including the money fields on a
// disbursed loan. When principal / interest_rate / duration /
// processing_fee_rate change on an already-disbursed loan we
// recompute totals, regenerate payment_schedules, and reconcile
// the capital_pool. Pre-disbursement edits are just field updates
// (no schedule exists yet, no capital movement yet).
// ============================================================
router.put("/:id/edit", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      principal_amount,
      annual_interest_rate,
      loan_duration_months,
      processing_fee_rate,
      application_date,
      disbursement_date,
      start_date,
      purpose,
      guarantor_name,
      guarantor_phone,
      guarantor_id_number,
      collateral_description,
      late_payment_fee,
      penalty_rate,
      notes,
    } = req.body || {};

    const eT = tenantClause(req, 1);
    const exRes = await query(
      `SELECT * FROM loans WHERE id = $1${eT.clause}`,
      [id, ...eT.params],
    );
    if (exRes.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const existing = exRes.rows[0];
    const tid = existing.tenant_id;

    // Coerce inputs; fall back to existing values when a field is
    // missing from the payload (partial edits are allowed).
    const newPrincipal = parseFloat(
      principal_amount ?? existing.principal_amount,
    );
    // The form sends annual_interest_rate; interest_rate column stores MONTHLY.
    const annualRate =
      annual_interest_rate != null
        ? parseFloat(annual_interest_rate)
        : parseFloat(existing.interest_rate) * 12;
    const newMonthlyRate = annualRate / 12;
    const newMonths = parseInt(
      loan_duration_months ?? existing.loan_duration_months,
      10,
    );
    const newProcFeeRate = parseFloat(
      processing_fee_rate ?? existing.processing_fee_rate ?? 0,
    );
    if (
      !Number.isFinite(newPrincipal) ||
      newPrincipal <= 0 ||
      !Number.isFinite(annualRate) ||
      annualRate < 0 ||
      !Number.isFinite(newMonths) ||
      newMonths <= 0 ||
      !Number.isFinite(newProcFeeRate) ||
      newProcFeeRate < 0 ||
      newProcFeeRate > 100
    ) {
      return res.status(400).json({ error: "Invalid numeric fields" });
    }

    const newYears = newMonths / 12;
    const newTotalInterest = newPrincipal * (annualRate / 100) * newYears;
    const newTotalDue = newPrincipal + newTotalInterest;
    const newProcessingFee =
      Math.round(newPrincipal * newProcFeeRate) / 100;
    const newNetDisbursed =
      Math.round((newPrincipal - newProcessingFee) * 100) / 100;

    const moneyChanged =
      parseFloat(existing.principal_amount) !== newPrincipal ||
      parseFloat(existing.interest_rate) !== newMonthlyRate ||
      parseInt(existing.loan_duration_months, 10) !== newMonths ||
      parseFloat(existing.processing_fee_rate || 0) !== newProcFeeRate;

    const isDisbursed = ["active", "completed", "defaulted", "suspended"].includes(
      existing.status,
    );

    // Helper: YYYY-MM-DD comparison (UTC midnight) so timezone noise
    // doesn't tip a valid date over the boundary.
    const ymd = (v) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString().split("T")[0];
    };

    // Date chain: application_date ≤ disbursed_at ≤ start_date.
    // Any field omitted from the payload falls back to the existing
    // row's value. Schedule regenerates anchored on the resolved
    // start_date when it (or money fields) changes.
    let appDate = ymd(existing.application_date);
    if (application_date) {
      const d = new Date(application_date);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid application_date" });
      }
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (d > todayEnd) {
        return res
          .status(400)
          .json({ error: "Application date cannot be in the future" });
      }
      appDate = ymd(application_date);
    }

    let disbDate = ymd(existing.disbursed_at);
    if (disbursement_date !== undefined && disbursement_date !== null) {
      if (disbursement_date === "") {
        disbDate = null;
      } else {
        if (!ymd(disbursement_date)) {
          return res.status(400).json({ error: "Invalid disbursement_date" });
        }
        disbDate = ymd(disbursement_date);
      }
    }

    let startDateOut = ymd(existing.start_date);
    if (start_date !== undefined && start_date !== null) {
      if (start_date === "") {
        startDateOut = null;
      } else {
        if (!ymd(start_date)) {
          return res.status(400).json({ error: "Invalid start_date" });
        }
        startDateOut = ymd(start_date);
      }
    }

    // Cross-field date chain validation (only enforce when both ends exist).
    if (appDate && disbDate && appDate > disbDate) {
      return res.status(400).json({
        error:
          "Application date cannot be after the disbursement date.",
      });
    }
    if (disbDate && startDateOut && disbDate > startDateOut) {
      return res.status(400).json({
        error:
          "Start date cannot be before the disbursement date.",
      });
    }
    if (appDate && startDateOut && !disbDate && appDate > startDateOut) {
      // Pre-disbursement loan that has a start_date set — keep chain consistent.
      return res.status(400).json({
        error: "Start date cannot be before the application date.",
      });
    }

    const lateFee =
      late_payment_fee != null
        ? parseFloat(late_payment_fee) || 0
        : parseFloat(existing.late_payment_fee || 0);
    const lateFeeWasActive = parseFloat(existing.late_payment_fee || 0) > 0;
    const lateFeeTurnedOff = lateFeeWasActive && lateFee === 0;
    const penaltyRate =
      penalty_rate != null
        ? parseFloat(penalty_rate) || 0
        : parseFloat(existing.penalty_rate || 0);

    // If disbursement_date was changed but start_date wasn't, default
    // start_date to disbursement + 1 month (the standard convention).
    if (
      disbDate &&
      !startDateOut &&
      disbursement_date !== undefined &&
      start_date === undefined
    ) {
      const d = new Date(disbDate);
      d.setMonth(d.getMonth() + 1);
      startDateOut = d.toISOString().split("T")[0];
    }
    // Also: if disbursement_date moved AND existing start_date was the
    // old "disbursed_at + 1 month" default, slide start_date along.
    if (
      disbDate &&
      disbursement_date !== undefined &&
      start_date === undefined &&
      existing.disbursed_at &&
      existing.start_date
    ) {
      const oldDisb = new Date(existing.disbursed_at);
      oldDisb.setMonth(oldDisb.getMonth() + 1);
      const oldDisbPlusOne = oldDisb.toISOString().split("T")[0];
      if (ymd(existing.start_date) === oldDisbPlusOne) {
        const d = new Date(disbDate);
        d.setMonth(d.getMonth() + 1);
        startDateOut = d.toISOString().split("T")[0];
      }
    }

    // end_date = start_date + (N − 1) months when start_date is known,
    // else preserve existing.
    let newEndDate = existing.end_date;
    if (startDateOut) {
      const eo = new Date(startDateOut);
      eo.setMonth(eo.getMonth() + newMonths - 1);
      newEndDate = eo.toISOString().split("T")[0];
    }

    const upd = await query(
      `UPDATE loans SET
         principal_amount         = $1,
         interest_rate            = $2,
         loan_duration_months     = $3,
         total_interest           = $4,
         total_amount_due         = $5,
         processing_fee_rate      = $6,
         processing_fee           = $7,
         net_disbursed_amount     = $8,
         start_date               = $9,
         end_date                 = $10,
         disbursed_at             = COALESCE($11::timestamp, disbursed_at),
         application_date         = $12,
         purpose                  = $13,
         guarantor_name           = $14,
         guarantor_phone          = $15,
         guarantor_id_number      = $16,
         collateral_description   = $17,
         late_payment_fee         = $18,
         penalty_rate             = $19,
         notes                    = COALESCE($20, notes),
         updated_at               = NOW()
       WHERE id = $21 AND tenant_id = $22
       RETURNING *`,
      [
        newPrincipal,
        newMonthlyRate,
        newMonths,
        newTotalInterest,
        newTotalDue,
        newProcFeeRate,
        newProcessingFee,
        newNetDisbursed,
        startDateOut,
        newEndDate,
        disbDate, // null preserves existing via COALESCE
        appDate,
        purpose ?? existing.purpose,
        guarantor_name ?? existing.guarantor_name,
        guarantor_phone ?? existing.guarantor_phone,
        guarantor_id_number ?? existing.guarantor_id_number,
        collateral_description ?? existing.collateral_description,
        lateFee,
        penaltyRate,
        notes ?? null,
        id,
        tid,
      ],
    );
    const updated = upd.rows[0];

    // Toggle went OFF → wipe accrued late-fee snapshot on all this
    // loan's schedule rows so the Payment Schedule no longer surfaces
    // any late fees on this loan. penalty_paid stays — that's the
    // historical record of money actually received, not an accrual.
    if (lateFeeTurnedOff) {
      await query(
        `UPDATE payment_schedules
            SET late_fee_charged = 0, updated_at = NOW()
          WHERE loan_id = $1`,
        [id],
      );
    }

    // Regenerate schedule + reconcile capital_pool when money fields
    // OR date fields change on a disbursed loan. Existing transactions
    // are preserved; the next payment-record call will reconcile
    // against the new total_due via the standard formula. Schedule
    // anchors on the resolved start_date (installment 1 = start_date,
    // installment N = start_date + (N − 1) months).
    const datesChanged =
      (disbursement_date !== undefined &&
        ymd(existing.disbursed_at) !== disbDate) ||
      (start_date !== undefined &&
        ymd(existing.start_date) !== startDateOut);
    if (isDisbursed && (moneyChanged || datesChanged)) {
      await query(`DELETE FROM payment_schedules WHERE loan_id = $1`, [id]);
      const scheduleAnchor = new Date(
        updated.start_date || updated.disbursed_at,
      );
      const monthlyPay = newTotalDue / newMonths;
      // How much of the new total has already been credited as
      // principal+interest (penalty/overpayment excluded) — needed so
      // already-paid installments come back marked paid.
      const paidRes = await query(
        `SELECT COALESCE(
            SUM(amount_paid
                - COALESCE(penalty_portion, 0)
                - COALESCE(overpayment_portion, 0)),
            0) AS total_paid
           FROM transactions
          WHERE loan_id = $1 AND payment_status = 'completed'`,
        [id],
      );
      let remainingPaid = parseFloat(paidRes.rows[0].total_paid || 0);
      for (let i = 1; i <= newMonths; i++) {
        const dueDate = new Date(scheduleAnchor);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        const installmentAmount = Math.round(monthlyPay * 100) / 100;
        let amountPaid = 0;
        let status = "pending";
        if (remainingPaid >= installmentAmount) {
          amountPaid = installmentAmount;
          status = "paid";
          remainingPaid -= installmentAmount;
        } else if (remainingPaid > 0) {
          amountPaid = Math.round(remainingPaid * 100) / 100;
          remainingPaid = 0;
        }
        if (status !== "paid" && dueDate < new Date()) status = "overdue";
        await query(
          `INSERT INTO payment_schedules
             (tenant_id, loan_id, payment_number, due_date, amount_due,
              amount_paid, status, actual_payment_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tid,
            id,
            i,
            dueDate.toISOString().split("T")[0],
            installmentAmount,
            amountPaid,
            status,
            status === "paid"
              ? dueDate.toISOString().split("T")[0]
              : null,
          ],
        );
      }

      // Capital pool reconciliation: roll back old disbursement +
      // processing-fee contribution, apply new values. Only matters
      // when money fields actually changed — date-only edits don't
      // shift the principal out or the fee earned.
      if (moneyChanged) {
        const oldPrincipal = parseFloat(existing.principal_amount);
        const oldProcFee = parseFloat(existing.processing_fee || 0);
        await query(
          `UPDATE capital_pool
              SET total_disbursed       = total_disbursed       - $1 + $2,
                  total_interest_earned = total_interest_earned - $3 + $4,
                  updated_at = NOW()
            WHERE tenant_id = $5`,
          [oldPrincipal, newPrincipal, oldProcFee, newProcessingFee, tid],
        );
      }
    }

    await logAudit({
      user: req.user,
      action: "loan_edited",
      entityType: "loan",
      entityId: id,
      entityCode: existing.loan_code,
      description: moneyChanged
        ? `Edited loan ${existing.loan_code} (money fields changed${
            isDisbursed ? " — schedule regenerated" : ""
          })`
        : `Edited loan ${existing.loan_code}`,
      oldValues: {
        principal_amount: existing.principal_amount,
        interest_rate: existing.interest_rate,
        loan_duration_months: existing.loan_duration_months,
        processing_fee_rate: existing.processing_fee_rate,
        late_payment_fee: existing.late_payment_fee,
        penalty_rate: existing.penalty_rate,
        purpose: existing.purpose,
      },
      newValues: {
        principal_amount: newPrincipal,
        interest_rate: newMonthlyRate,
        loan_duration_months: newMonths,
        processing_fee_rate: newProcFeeRate,
        late_payment_fee: lateFee,
        penalty_rate: penaltyRate,
        purpose: updated.purpose,
      },
      req,
    });

    res.json({
      success: true,
      message: moneyChanged && isDisbursed
        ? "Loan updated and schedule regenerated"
        : "Loan updated",
      data: updated,
    });
  } catch (error) {
    logger.error("Edit loan error:", error);
    res.status(500).json({ error: "Failed to edit loan" });
  }
});

// ============================================================
// DELETE LOAN — pre-disbursement only (admin).
// Permanently removes a loan that has not been disbursed. Disbursed
// loans (active/completed/defaulted/suspended) are off-limits via
// the UI — preserving the audit trail and capital-pool history.
// ============================================================
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const dT = tenantClause(req, 1);
    const exRes = await query(
      `SELECT * FROM loans WHERE id = $1${dT.clause}`,
      [id, ...dT.params],
    );
    if (exRes.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const loan = exRes.rows[0];

    const preDisbursementStatuses = [
      "pending",
      "under_review",
      "approved",
      "counter_offered",
      "rejected",
    ];
    if (!preDisbursementStatuses.includes(loan.status)) {
      return res.status(400).json({
        error: `Cannot delete a ${loan.status} loan. Only pre-disbursement loans can be deleted.`,
      });
    }

    // Belt-and-braces sanity check: should never happen for a
    // pre-disbursement loan, but if money already moved, refuse.
    const txnCheck = await query(
      `SELECT COUNT(*)::int AS c FROM transactions WHERE loan_id = $1`,
      [id],
    );
    if (parseInt(txnCheck.rows[0].c, 10) > 0) {
      return res.status(400).json({
        error: "Cannot delete a loan with transactions on record",
      });
    }

    // FK-respecting cleanup. payment_schedules shouldn't exist for
    // pre-disbursement loans but we sweep them anyway.
    await query(`DELETE FROM payment_schedules WHERE loan_id = $1`, [id]);
    await query(`DELETE FROM sms_logs           WHERE loan_id = $1`, [id]);
    await query(`DELETE FROM email_logs         WHERE loan_id = $1`, [id]);
    await query(
      `DELETE FROM audit_logs
        WHERE entity_type = 'loan' AND entity_id = $1`,
      [id],
    );
    await query(
      `DELETE FROM notifications
        WHERE loan_id = $1
           OR metadata->>'loan_id' = $1::text`,
      [id],
    );
    await query(`DELETE FROM loans WHERE id = $1 AND tenant_id = $2`, [
      id,
      loan.tenant_id,
    ]);

    await logAudit({
      user: req.user,
      action: "loan_deleted",
      entityType: "loan",
      entityId: id,
      entityCode: loan.loan_code,
      description: `Deleted ${loan.status} loan ${loan.loan_code}`,
      oldValues: {
        loan_code: loan.loan_code,
        status: loan.status,
        principal_amount: loan.principal_amount,
      },
      req,
    });

    res.json({ success: true, message: "Loan deleted" });
  } catch (error) {
    logger.error("Delete loan error:", error);
    res.status(500).json({ error: "Failed to delete loan" });
  }
});

// ============================================================
// UPDATE LOAN STATUS
// ============================================================
router.put("/:id/status", authorize("admin", "manager"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["active", "completed", "defaulted", "suspended"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Capture the prior status/code before updating so the audit trail
    // records the old -> new transition (this route did not previously
    // fetch the loan first).
    const psT = tenantClause(req, 1);
    const existing = await query(
      `SELECT status, loan_code, tenant_id FROM loans WHERE id = $1${psT.clause}`,
      [id, ...psT.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const prev = existing.rows[0];

    const result = await query(
      `UPDATE loans SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, id, prev.tenant_id],
    );

    await logAudit({
      user: req.user,
      action: "status_changed",
      entityType: "loan",
      entityId: id,
      entityCode: prev.loan_code,
      description: `Changed loan ${prev.loan_code} status from "${prev.status}" to "${status}"`,
      oldValues: { status: prev.status },
      newValues: { status },
      req,
    });

    // A defaulted (or un-defaulted) loan changes the client's credit
    // standing — recompute their cached score. Best-effort.
    if (prev.status !== status) {
      await recomputeCreditScoreForLoan(id);
    }

    res.json({
      success: true,
      message: "Loan status updated",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update loan error:", error);
    res.status(500).json({ error: "Failed to update loan" });
  }
});

// ============================================================
// BULK: update status for many loans
// ============================================================
router.post(
  "/bulk/status",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { loan_ids, status, notes } = req.body;

      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      if (!["active", "defaulted", "suspended"].includes(status)) {
        return res.status(400).json({
          error: "Invalid status. Use: active, defaulted, or suspended",
        });
      }

      const ccT = tenantClause(req, 1);
      const completedCheck = await query(
        `SELECT COUNT(*) AS count FROM loans
         WHERE id = ANY($1) AND status = 'completed'${ccT.clause}`,
        [loan_ids, ...ccT.params],
      );
      const completedCount = parseInt(completedCheck.rows[0].count, 10);
      if (completedCount > 0) {
        return res.status(400).json({
          error: `Cannot modify ${completedCount} completed loan(s). Please deselect them.`,
        });
      }

      const uT = tenantClause(req, 3);
      const result = await query(
        `UPDATE loans
         SET status = $1,
             notes = COALESCE($2, notes),
             updated_at = NOW()
         WHERE id = ANY($3) AND status != 'completed'${uT.clause}
         RETURNING id, loan_code, status`,
        [status, notes || null, loan_ids, ...uT.params],
      );

      // Marking defaulted pushes pending installments to overdue
      // (mirrors the single-loan PUT, including the ::date cast).
      if (status === "defaulted") {
        const psdT = tenantClause(req, 1);
        await query(
          `UPDATE payment_schedules
           SET status = 'overdue',
               days_late = (CURRENT_DATE - due_date::date),
               updated_at = NOW()
           WHERE loan_id = ANY($1) AND status = 'pending'${psdT.clause}`,
          [loan_ids, ...psdT.params],
        );
      }

      // Recompute cached credit scores for every affected loan's
      // client — best-effort, never blocks. Sequential is fine here
      // (bulk lists rarely exceed a few dozen).
      for (const row of result.rows) {
        await recomputeCreditScoreForLoan(row.id);
      }

      await logAudit({
        user: req.user,
        action: "bulk_status_changed",
        entityType: "loan",
        description: `Bulk updated ${result.rows.length} loans to status: ${status}`,
        newValues: {
          status,
          notes: notes || null,
          loan_ids,
          count: result.rows.length,
        },
        req,
      });

      logger.info(
        `✓ Bulk loan status: ${result.rows.length} → ${status} by ${req.user.email}`,
      );

      res.json({
        success: true,
        message: `Updated ${result.rows.length} loans to ${status}`,
        updated_count: result.rows.length,
      });
    } catch (error) {
      logger.error("Bulk status update error:", error);
      res.status(500).json({ error: "Failed to update loans" });
    }
  },
);

// ============================================================
// BULK: export selected loans to Excel
// ============================================================
// Bulk-mark loans as defaulted (used by the Overdue page). Only ACTIVE loans
// are defaulted; completed / already-defaulted ones are skipped. Each defaulted
// loan's pending installments are flagged overdue, and each is audit-logged.
router.post(
  "/bulk/default",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const { loan_ids } = req.body;
      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      const tc = tenantClause(req, 1, "tenant_id");
      const upd = await query(
        `UPDATE loans
            SET status = 'defaulted', updated_at = NOW()
          WHERE id = ANY($1) AND status = 'active'${tc.clause}
        RETURNING id, loan_code`,
        [loan_ids, ...tc.params],
      );
      const defaultedIds = upd.rows.map((r) => r.id);
      if (defaultedIds.length) {
        await query(
          `UPDATE payment_schedules
              SET status = 'overdue',
                  days_late = GREATEST(CURRENT_DATE - due_date::date, 0),
                  updated_at = NOW()
            WHERE loan_id = ANY($1) AND status = 'pending'`,
          [defaultedIds],
        );
        for (const r of upd.rows) {
          await logAudit({
            user: req.user,
            action: "status_changed",
            entityType: "loan",
            entityId: r.id,
            entityCode: r.loan_code,
            description: `Marked loan ${r.loan_code} as defaulted (overdue page)`,
            newValues: { status: "defaulted" },
            req,
          });
          // Recompute the client's cached credit score — a default
          // is the biggest single negative the formula reacts to.
          await recomputeCreditScoreForLoan(r.id);
        }
      }
      res.json({
        success: true,
        defaulted: defaultedIds.length,
        skipped: loan_ids.length - defaultedIds.length,
      });
    } catch (error) {
      logger.error("Bulk default error:", error);
      res.status(500).json({ error: "Failed to mark loans as defaulted" });
    }
  },
);

router.post("/bulk/export", async (req, res) => {
  try {
    const { loan_ids } = req.body;

    if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
      return res.status(400).json({ error: "No loans selected" });
    }

    const result = await query(
      `SELECT
        l.*,
        c.first_name, c.last_name, c.phone_number, c.client_code,
        (SELECT COALESCE(SUM(t.amount_paid), 0)
           FROM transactions t
           WHERE t.loan_id = l.id
             AND t.payment_status = 'completed') AS total_paid
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = ANY($1)${tenantClause(req, 1, "l.tenant_id").clause}
      ORDER BY l.created_at DESC`,
      [loan_ids, ...tenantClause(req, 1, "l.tenant_id").params],
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Selected Loans");

    sheet.columns = [
      { header: "Loan Code", key: "loan_code", width: 15 },
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "Client Name", key: "client_name", width: 25 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Principal", key: "principal_amount", width: 12 },
      { header: "Total Due", key: "total_amount_due", width: 12 },
      { header: "Paid", key: "total_paid", width: 12 },
      { header: "Balance", key: "balance", width: 12 },
      { header: "Status", key: "status", width: 12 },
      { header: "Start Date", key: "start_date", width: 12 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };

    result.rows.forEach((loan) => {
      sheet.addRow({
        ...loan,
        client_name: `${loan.first_name} ${loan.last_name}`,
        balance: (
          parseFloat(loan.total_amount_due) - parseFloat(loan.total_paid)
        ).toFixed(2),
        start_date: new Date(loan.start_date).toLocaleDateString(),
      });
    });

    const filename = `selected_loans_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Bulk export error:", error);
    res.status(500).json({ error: "Failed to export" });
  }
});

export default router;
