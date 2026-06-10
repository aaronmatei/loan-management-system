// Loan underwriting — the risk worksheet for an application + CRB pulls.
// Mounted at /api/underwriting. Tenant-scoped; reads the existing internal
// credit score, current exposure, KYC and repayment history, and lets an
// officer run a CRB check and record a risk grade + notes before the
// (existing) approve/reject decision.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { pullCreditReport, crbProviderInfo } from "../services/crb/index.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Tenant-owned loan + its client, or null.
async function loadLoan(req, loanId) {
  const tc = tenantClause(req, 1, "l.tenant_id");
  const r = await query(
    `SELECT l.*, c.first_name, c.last_name, c.phone_number, c.id_number,
            c.credit_score, c.kyc_verified, c.client_code
       FROM loans l JOIN clients c ON c.id = l.client_id
      WHERE l.id = $1${tc.clause}`,
    [loanId, ...tc.params],
  );
  return r.rows[0] || null;
}

// GET /api/underwriting/:loanId — assemble the worksheet.
router.get("/:loanId", async (req, res) => {
  try {
    const loan = await loadLoan(req, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Application not found" });

    const exp = await query(
      `SELECT COUNT(*)::int AS active_loans,
              COALESCE(SUM(principal_amount),0)::float AS active_principal
         FROM loans
        WHERE client_id = $1 AND id <> $2 AND status = 'active'`,
      [loan.client_id, loan.id],
    );
    const hist = await query(
      `SELECT
         COUNT(*) FILTER (WHERE ps.status = 'paid')::int AS paid_installments,
         COUNT(*) FILTER (WHERE ps.status = 'overdue')::int AS overdue_installments,
         COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'completed')::int AS loans_completed,
         COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'defaulted')::int AS loans_defaulted
       FROM loans l
       LEFT JOIN payment_schedules ps ON ps.loan_id = l.id
      WHERE l.client_id = $1`,
      [loan.client_id],
    );
    const cc = await query(
      `SELECT * FROM credit_checks WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [loan.client_id],
    );

    res.json({
      success: true,
      data: {
        loan: {
          id: loan.id,
          loan_code: loan.loan_code,
          principal_amount: parseFloat(loan.principal_amount),
          total_amount_due: parseFloat(loan.total_amount_due || 0),
          loan_duration_months: loan.loan_duration_months,
          purpose: loan.purpose,
          status: loan.status,
          risk_grade: loan.risk_grade,
          underwriting_notes: loan.underwriting_notes,
          credit_check_id: loan.credit_check_id,
        },
        client: {
          id: loan.client_id,
          name: `${loan.first_name} ${loan.last_name}`.trim(),
          client_code: loan.client_code,
          id_number: loan.id_number,
          credit_score: loan.credit_score,
          kyc_verified: loan.kyc_verified,
        },
        exposure: exp.rows[0],
        history: hist.rows[0],
        credit_check: cc.rows[0] || null,
        crb: crbProviderInfo(),
      },
    });
  } catch (e) {
    logger.error("underwriting worksheet error:", e);
    res.status(500).json({ error: "Failed to load underwriting worksheet" });
  }
});

// POST /api/underwriting/:loanId/crb-check — run/record a CRB pull.
// Body may carry { manual:true, score, grade, status, reference } when the
// officer keys a bureau result in; otherwise the active provider is called.
router.post(
  "/:loanId/crb-check",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const loan = await loadLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Application not found" });

      const override = req.body && req.body.manual ? req.body : null;
      const report = await pullCreditReport({ client: loan, override });

      const ins = await query(
        `INSERT INTO credit_checks
           (tenant_id, client_id, loan_id, provider, source, reference,
            national_id, score, grade, status, report, checked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          loan.tenant_id,
          loan.client_id,
          loan.id,
          report.provider,
          report.source,
          report.reference,
          loan.id_number,
          report.score,
          report.grade,
          report.status,
          JSON.stringify(report.raw || {}),
          req.user.id,
        ],
      );

      await logAudit({
        user: req.user,
        action: "crb_check",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `CRB check (${report.provider}/${report.source}) for ${loan.loan_code}`,
        req,
      });

      res.json({ success: true, data: ins.rows[0] });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      logger.error("crb-check error:", e);
      res.status(500).json({ error: "CRB check failed" });
    }
  },
);

// POST /api/underwriting/:loanId/assess — record risk grade + notes.
router.post(
  "/:loanId/assess",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const loan = await loadLoan(req, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Application not found" });
      const { risk_grade, notes, credit_check_id } = req.body || {};

      await query(
        `UPDATE loans
            SET risk_grade = $1, underwriting_notes = $2,
                underwritten_by = $3, underwritten_at = NOW(),
                credit_check_id = $4, updated_at = NOW()
          WHERE id = $5`,
        [
          risk_grade || null,
          notes || null,
          req.user.id,
          credit_check_id || null,
          loan.id,
        ],
      );

      await logAudit({
        user: req.user,
        action: "underwriting_saved",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Underwriting saved for ${loan.loan_code} (grade ${risk_grade || "—"})`,
        req,
      });

      res.json({ success: true });
    } catch (e) {
      logger.error("underwriting assess error:", e);
      res.status(500).json({ error: "Failed to save assessment" });
    }
  },
);

export default router;
