// Salary / check-off advances. Dual-mounted on /api/loans so the paths read
// /api/loans/:loanId/salary-details.
//
// A salary advance is an ordinary installment loan (created/approved/disbursed
// through the standard /api/loans flow, loan_type='salary' from its package)
// repaid by employer check-off. This module records the employment details, runs
// an affordability check (instalment vs a capped share of net pay), and tracks
// the check-off instruction (pending → active → stopped/completed).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { buildCheckOffLetterPdf, NotFoundError } from "../utils/pdfDocuments.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function loadSalaryLoan(req, loanId) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(
    `SELECT * FROM loans WHERE id = $1 AND loan_type = 'salary'${tc.clause}`,
    [loanId, ...tc.params],
  );
  return r.rows[0] || null;
}

async function loadDetails(loanId) {
  const r = await query(
    `SELECT * FROM loan_salary_details WHERE loan_id = $1`,
    [loanId],
  );
  return r.rows[0] || null;
}

// Instalment vs the affordable ceiling (a capped share of net pay). Returns
// null when there's nothing to assess yet.
function assessAffordability(loan, details) {
  if (!details) return null;
  const months = parseInt(loan.loan_duration_months, 10) || 1;
  const installment = round2(parseFloat(loan.total_amount_due || 0) / months);
  const netPay = parseFloat(details.net_monthly_pay || 0);
  const capPct = parseFloat(details.max_deduction_percent || 50);
  const cap = round2(netPay * (capPct / 100));
  const deductionPct = netPay > 0 ? round2((installment / netPay) * 100) : null;
  return {
    installment,
    net_monthly_pay: netPay,
    max_deduction_percent: capPct,
    affordable_ceiling: cap,
    deduction_percent: deductionPct,
    affordable: installment <= cap,
  };
}

// GET /api/loans/:loanId/salary-details
router.get("/:loanId/salary-details", async (req, res) => {
  try {
    const loan = await loadSalaryLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Salary advance not found" });
    const details = await loadDetails(loan.id);
    res.json({
      success: true,
      data: { loan, details, affordability: assessAffordability(loan, details) },
    });
  } catch (e) {
    logger.error("salary-details get error:", e);
    res.status(500).json({ error: "Failed to load salary details" });
  }
});

// POST /api/loans/:loanId/salary-details — create or update (one per loan).
router.post(
  "/:loanId/salary-details",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const loan = await loadSalaryLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Salary advance not found" });

      const {
        employer_name,
        employer_contact,
        staff_number,
        net_monthly_pay,
        payday_day,
        max_deduction_percent,
        notes,
      } = req.body || {};

      if (!employer_name || !String(employer_name).trim()) {
        return res.status(400).json({ error: "Employer name is required" });
      }
      const netPay = parseFloat(net_monthly_pay);
      if (!(netPay > 0)) {
        return res.status(400).json({ error: "Net monthly pay must be positive" });
      }
      let payday = payday_day != null && payday_day !== "" ? parseInt(payday_day, 10) : null;
      if (payday != null && (payday < 1 || payday > 31)) {
        return res.status(400).json({ error: "Payday must be a day of the month (1-31)" });
      }
      const capPct =
        max_deduction_percent != null && max_deduction_percent !== ""
          ? parseFloat(max_deduction_percent)
          : 50;
      if (!(capPct > 0 && capPct <= 100)) {
        return res.status(400).json({ error: "Max deduction percent must be between 1 and 100" });
      }

      const row = await query(
        `INSERT INTO loan_salary_details
           (tenant_id, loan_id, employer_name, employer_contact, staff_number,
            net_monthly_pay, payday_day, max_deduction_percent, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (loan_id) DO UPDATE SET
            employer_name = EXCLUDED.employer_name,
            employer_contact = EXCLUDED.employer_contact,
            staff_number = EXCLUDED.staff_number,
            net_monthly_pay = EXCLUDED.net_monthly_pay,
            payday_day = EXCLUDED.payday_day,
            max_deduction_percent = EXCLUDED.max_deduction_percent,
            notes = EXCLUDED.notes, updated_at = NOW()
         RETURNING *`,
        [
          loan.tenant_id,
          loan.id,
          String(employer_name).trim(),
          employer_contact || null,
          staff_number || null,
          netPay,
          payday,
          capPct,
          notes || null,
          req.user.id,
        ],
      );

      await logAudit({
        user: req.user,
        action: "salary_details_recorded",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Salary check-off for ${loan.loan_code}: ${String(employer_name).trim()} (net KES ${netPay})`,
        req,
      });

      const details = row.rows[0];
      res.status(201).json({
        success: true,
        data: details,
        affordability: assessAffordability(loan, details),
      });
    } catch (e) {
      logger.error("salary-details upsert error:", e);
      res.status(500).json({ error: "Failed to save salary details" });
    }
  },
);

// POST /api/loans/:loanId/salary-details/activate — the check-off instruction
// is in force with the employer.
router.post(
  "/:loanId/salary-details/activate",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const loan = await loadSalaryLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Salary advance not found" });
      const details = await loadDetails(loan.id);
      if (!details) return res.status(404).json({ error: "No salary details on file" });
      if (details.check_off_status === "active") {
        return res.status(400).json({ error: "Check-off already active" });
      }
      const row = await query(
        `UPDATE loan_salary_details
            SET check_off_status='active', activated_at=NOW(), stopped_at=NULL, updated_at=NOW()
          WHERE loan_id=$1 RETURNING *`,
        [loan.id],
      );
      await logAudit({
        user: req.user,
        action: "salary_checkoff_activated",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Check-off activated for ${loan.loan_code} (${details.employer_name})`,
        req,
      });
      res.json({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error("salary-details activate error:", e);
      res.status(500).json({ error: "Failed to activate check-off" });
    }
  },
);

// POST /api/loans/:loanId/salary-details/stop — the check-off instruction is
// withdrawn (borrower left employment, dispute, etc.).
router.post(
  "/:loanId/salary-details/stop",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const loan = await loadSalaryLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Salary advance not found" });
      const details = await loadDetails(loan.id);
      if (!details) return res.status(404).json({ error: "No salary details on file" });
      if (details.check_off_status === "stopped") {
        return res.status(400).json({ error: "Check-off already stopped" });
      }
      const row = await query(
        `UPDATE loan_salary_details
            SET check_off_status='stopped', stopped_at=NOW(), updated_at=NOW(),
                notes = COALESCE($2, notes)
          WHERE loan_id=$1 RETURNING *`,
        [loan.id, req.body?.notes || null],
      );
      await logAudit({
        user: req.user,
        action: "salary_checkoff_stopped",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Check-off stopped for ${loan.loan_code} (${details.employer_name})`,
        req,
      });
      res.json({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error("salary-details stop error:", e);
      res.status(500).json({ error: "Failed to stop check-off" });
    }
  },
);

// GET /api/loans/:loanId/salary-details/check-off-letter — authorization letter
// to the employer (PDF).
router.get("/:loanId/salary-details/check-off-letter", async (req, res) => {
  try {
    const { buffer, filename } = await buildCheckOffLetterPdf(
      req.params.loanId,
      tenantId(req),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    if (e instanceof NotFoundError) return res.status(404).json({ error: e.message });
    logger.error("check-off letter error:", e);
    res.status(500).json({ error: "Failed to generate check-off letter" });
  }
});

export default router;
