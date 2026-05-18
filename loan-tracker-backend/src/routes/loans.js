import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { sendSMS, templates } from "../services/smsService.js";
import {
  sendEmail,
  templates as emailTemplates,
  getCompanySettings,
} from "../services/emailService.js";
import { buildLoanAgreementPdf } from "../utils/pdfDocuments.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";
import ExcelJS from "exceljs";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET ALL LOANS (with payment summary)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { status, client_id, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
        SELECT 
            l.*,
            c.first_name,
            c.last_name,
            c.phone_number,
            c.client_code,
            COALESCE(SUM(t.amount_paid), 0) as total_paid,
            GREATEST(l.total_amount_due - COALESCE(SUM(t.amount_paid), 0), 0) as balance_due
        FROM loans l
        JOIN clients c ON l.client_id = c.id
        LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
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

    queryText += ` 
      GROUP BY l.id, c.first_name, c.last_name, c.phone_number, c.client_code
      ORDER BY l.created_at DESC 
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const countResult = await query("SELECT COUNT(*) FROM loans");
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

    // Get loan with client info
    const loanResult = await query(
      `SELECT 
        l.*,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email,
        c.client_code
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1`,
      [id],
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
      annual_interest_rate, // ✅ Now using annual rate
      loan_duration_months,
      start_date,
      purpose,
      guarantor_name,
      guarantor_phone,
      guarantor_id_number,
      collateral_description,
      late_payment_fee,
      penalty_rate,
      application_source,
      review_notes,
    } = req.body;

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

    const clientCheck = await query("SELECT id FROM clients WHERE id = $1", [
      client_id,
    ]);
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    // ✅ Client credit eligibility: block risky lending
    const clientLoans = await query(
      `SELECT status FROM loans WHERE client_id = $1`,
      [client_id],
    );

    const activeLoans = clientLoans.rows.filter(
      (l) => l.status === "active",
    ).length;
    const defaultedLoans = clientLoans.rows.filter(
      (l) => l.status === "defaulted",
    ).length;

    const overdueCheck = await query(
      `SELECT COUNT(*) AS overdue_count
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.client_id = $1 AND ps.status = 'overdue'`,
      [client_id],
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

    // Loan calculations. interest_rate stores the MONTHLY rate as a
    // percent (existing convention — analytics, the agreement PDF and
    // every display derive annual = interest_rate * 12 from it; do
    // NOT change this to a fraction).
    const principal = parseFloat(principal_amount);
    const annualRate = parseFloat(annual_interest_rate);
    const monthlyRate = annualRate / 12;
    const months = parseInt(loan_duration_months);
    const years = months / 12;
    const totalInterest = principal * (annualRate / 100) * years;
    const totalAmountDue = principal + totalInterest;

    const year = new Date().getFullYear();
    const countResult = await query("SELECT COUNT(*) FROM loans");
    const loanCount = parseInt(countResult.rows[0].count) + 1;
    const loanCode = `LN-${year}-${String(loanCount).padStart(4, "0")}`;

    // Create as a PENDING application: no start/end date, no schedule,
    // no capital movement, no notifications until disbursement.
    const loanResult = await query(
      `INSERT INTO loans (
        loan_code, client_id, principal_amount, interest_rate,
        loan_duration_months, total_amount_due, total_interest,
        status, created_by, purpose,
        guarantor_name, guarantor_phone, guarantor_id_number,
        collateral_description, late_payment_fee, penalty_rate,
        application_date, application_source, review_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14, $15,
                CURRENT_DATE, $16, $17)
      RETURNING *`,
      [
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
        late_payment_fee || 500,
        penalty_rate || 5.0,
        application_source || "walk_in",
        review_notes || null,
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
      const result = await query(
        `UPDATE loans SET
          status = 'under_review', reviewed_by = $1, reviewed_at = NOW(),
          review_notes = COALESCE($2, review_notes), updated_at = NOW()
        WHERE id = $3 AND status = 'pending'
        RETURNING *`,
        [req.user.id, notes || null, id],
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

      const loanCheck = await query("SELECT * FROM loans WHERE id = $1", [
        id,
      ]);
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (!["pending", "under_review"].includes(loan.status)) {
        return res
          .status(400)
          .json({ error: `Cannot approve loan with status: ${loan.status}` });
      }

      const poolCheck = await query(`
        SELECT (initial_capital - total_disbursed + total_collected) AS available
        FROM capital_pool ORDER BY id DESC LIMIT 1
      `);
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
        WHERE id = $3 RETURNING *`,
        [req.user.id, notes || null, id],
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
      const loanCheck = await query("SELECT * FROM loans WHERE id = $1", [
        id,
      ]);
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
        WHERE id = $3 RETURNING *`,
        [req.user.id, reason, id],
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

// Disburse — money goes out: loan becomes active, schedule is
// generated, capital pool is debited, and the loan-approved SMS +
// agreement-PDF email fire HERE (relocated from loan creation).
router.post(
  "/:id/disburse",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        disbursement_method,
        disbursement_reference,
        disbursement_date,
        start_date,
      } = req.body || {};

      const loanCheck = await query("SELECT * FROM loans WHERE id = $1", [
        id,
      ]);
      if (loanCheck.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = loanCheck.rows[0];
      if (loan.status !== "approved") {
        return res.status(400).json({
          error: `Cannot disburse loan with status: ${loan.status}. Loan must be approved first.`,
        });
      }

      const effectiveStart =
        start_date ||
        disbursement_date ||
        new Date().toISOString().split("T")[0];
      const endDate = new Date(effectiveStart);
      endDate.setMonth(
        endDate.getMonth() + parseInt(loan.loan_duration_months, 10),
      );

      const result = await query(
        `UPDATE loans SET
          status = 'active', disbursed_by = $1, disbursed_at = NOW(),
          disbursement_method = $2, disbursement_reference = $3,
          start_date = $4, end_date = $5, updated_at = NOW()
        WHERE id = $6 RETURNING *`,
        [
          req.user.id,
          disbursement_method || "cash",
          disbursement_reference || null,
          effectiveStart,
          endDate.toISOString().split("T")[0],
          id,
        ],
      );
      const active = result.rows[0];

      // Payment schedule (created at disbursement, not application)
      const months = parseInt(loan.loan_duration_months, 10);
      const monthlyPayment = parseFloat(loan.total_amount_due) / months;
      for (let i = 1; i <= months; i++) {
        const dueDate = new Date(effectiveStart);
        dueDate.setMonth(dueDate.getMonth() + i);
        await query(
          `INSERT INTO payment_schedules (
            loan_id, payment_number, due_date, amount_due, status
          ) VALUES ($1, $2, $3, $4, 'pending')`,
          [id, i, dueDate.toISOString().split("T")[0], monthlyPayment.toFixed(2)],
        );
      }

      // Capital pool: principal is now lent out
      const principal = parseFloat(loan.principal_amount);
      await query(
        `UPDATE capital_pool
           SET total_disbursed = total_disbursed + $1, updated_at = NOW()
         WHERE id = (SELECT id FROM capital_pool ORDER BY id DESC LIMIT 1)`,
        [principal],
      );
      await query(
        `INSERT INTO capital_transactions (transaction_type, amount, loan_id, description)
         VALUES ('loan_disbursed', $1, $2, $3)`,
        [principal, id, `Loan ${loan.loan_code} disbursed`],
      );

      // Loan-approved SMS (relocated here from loan creation).
      if (process.env.SMS_AUTO_CONFIRMATIONS === "true") {
        try {
          const c = await query(
            "SELECT phone_number, first_name FROM clients WHERE id = $1",
            [loan.client_id],
          );
          if (c.rows[0]?.phone_number) {
            const smsMessage = templates.loanApproved(
              c.rows[0].first_name,
              principal,
              loan.loan_code,
            );
            sendSMS(c.rows[0].phone_number, smsMessage).then((smsResult) => {
              query(
                `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
                 VALUES ($1, $2, $3, $4, 'loan_approved', $5, $6, $7)`,
                [
                  loan.client_id,
                  id,
                  c.rows[0].phone_number,
                  smsMessage,
                  smsResult.success ? "sent" : "failed",
                  JSON.stringify(smsResult),
                  req.user.id,
                ],
              ).catch((err) => logger.error("SMS log error:", err));
            });
          }
        } catch (err) {
          logger.error("Disbursement SMS error:", err);
        }
      }

      // Loan-approved email + agreement PDF (relocated here).
      if (
        process.env.EMAIL_ENABLED === "true" &&
        process.env.EMAIL_AUTO_CONFIRMATIONS === "true"
      ) {
        (async () => {
          try {
            const c = await query(
              "SELECT email, first_name FROM clients WHERE id = $1",
              [loan.client_id],
            );
            const recipient = c.rows[0];
            if (recipient?.email) {
              const company = await getCompanySettings();
              const template = emailTemplates.loanApproved({
                clientName: recipient.first_name,
                loanCode: loan.loan_code,
                principalAmount: loan.principal_amount,
                totalDue: loan.total_amount_due,
                duration: loan.loan_duration_months,
                company,
              });
              const { buffer, filename } = await buildLoanAgreementPdf(id);
              const emailResult = await sendEmail({
                to: recipient.email,
                subject: template.subject,
                html: template.html,
                attachments: [{ filename, content: buffer }],
              });
              await query(
                `INSERT INTO email_logs (client_id, loan_id, recipient_email, subject, message_type, has_attachment, attachment_name, status, provider_response, sent_by)
                 VALUES ($1, $2, $3, $4, 'loan_agreement', true, $5, $6, $7, $8)`,
                [
                  loan.client_id,
                  id,
                  recipient.email,
                  template.subject,
                  filename,
                  emailResult.success ? "sent" : "failed",
                  JSON.stringify(emailResult),
                  req.user.id,
                ],
              );
            }
          } catch (err) {
            logger.error("Disbursement email error:", err);
          }
        })();
      }

      await logAudit({
        user: req.user,
        action: "loan_disbursed",
        entityType: "loan",
        entityId: id,
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

      res.json({
        success: true,
        message: "Loan disbursed successfully",
        data: active,
      });
    } catch (error) {
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
      WHERE l.status IN ('pending', 'under_review', 'approved', 'rejected')
    `;
    const params = [];
    if (status && status !== "all") {
      params.push(status);
      queryText += ` AND l.status = $${params.length}`;
    }
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
    const result = await query(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status = 'under_review' THEN 1 END) AS under_review,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
        COUNT(CASE WHEN status = 'rejected' AND rejected_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS rejected_30d,
        COUNT(CASE WHEN status = 'active' AND disbursed_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS disbursed_30d,
        AVG(EXTRACT(EPOCH FROM (approved_at - application_date::timestamp)) / 3600)::int AS avg_approval_hours
      FROM loans
      WHERE status IN ('pending', 'under_review', 'approved', 'rejected', 'active')
    `);
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

    const existing = await query("SELECT * FROM loans WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const currentLoan = existing.rows[0];

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
      WHERE id = $4
      RETURNING *`,
      [status || null, purpose || null, notes || null, id],
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
    const existing = await query(
      "SELECT status, loan_code FROM loans WHERE id = $1",
      [id],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const prev = existing.rows[0];

    const result = await query(
      `UPDATE loans SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id],
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

      const completedCheck = await query(
        `SELECT COUNT(*) AS count FROM loans
         WHERE id = ANY($1) AND status = 'completed'`,
        [loan_ids],
      );
      const completedCount = parseInt(completedCheck.rows[0].count, 10);
      if (completedCount > 0) {
        return res.status(400).json({
          error: `Cannot modify ${completedCount} completed loan(s). Please deselect them.`,
        });
      }

      const result = await query(
        `UPDATE loans
         SET status = $1,
             notes = COALESCE($2, notes),
             updated_at = NOW()
         WHERE id = ANY($3) AND status != 'completed'
         RETURNING id, loan_code, status`,
        [status, notes || null, loan_ids],
      );

      // Marking defaulted pushes pending installments to overdue
      // (mirrors the single-loan PUT, including the ::date cast).
      if (status === "defaulted") {
        await query(
          `UPDATE payment_schedules
           SET status = 'overdue',
               days_late = (CURRENT_DATE - due_date::date),
               updated_at = NOW()
           WHERE loan_id = ANY($1) AND status = 'pending'`,
          [loan_ids],
        );
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
      WHERE l.id = ANY($1)
      ORDER BY l.created_at DESC`,
      [loan_ids],
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
