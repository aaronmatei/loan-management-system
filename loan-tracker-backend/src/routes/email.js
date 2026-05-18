import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import {
  sendEmail,
  templates,
  testConnection,
  getCompanySettings,
} from "../services/emailService.js";
import {
  buildClientStatementPdf,
  buildLoanAgreementPdf,
  NotFoundError,
} from "../utils/pdfDocuments.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Log an email to the database
const logEmail = async (data) => {
  try {
    await query(
      `
      INSERT INTO email_logs (
        client_id, loan_id, recipient_email, subject, message_type,
        has_attachment, attachment_name, status, provider_response, sent_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        data.client_id || null,
        data.loan_id || null,
        data.recipient_email,
        data.subject,
        data.message_type || "custom",
        data.has_attachment || false,
        data.attachment_name || null,
        data.status || "sent",
        JSON.stringify(data.provider_response || {}),
        data.sent_by || null,
      ],
    );
  } catch (error) {
    logger.error("Failed to log email:", error);
  }
};

// Test SMTP connection
router.get("/test", async (req, res) => {
  const result = await testConnection();
  res.json(result);
});

// Send a custom email to a single client (optionally attach a statement)
router.post("/send", async (req, res) => {
  try {
    const { client_id, subject, message, attach_statement = false } =
      req.body;

    if (!client_id || !subject || !message) {
      return res
        .status(400)
        .json({ error: "Client, subject, and message are required" });
    }

    const clientResult = await query("SELECT * FROM clients WHERE id = $1", [
      client_id,
    ]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResult.rows[0];
    if (!client.email) {
      return res.status(400).json({ error: "Client has no email address" });
    }

    const company = await getCompanySettings();
    const template = templates.custom({
      subject,
      message,
      clientName: client.first_name,
      company,
    });

    const attachments = [];
    if (attach_statement) {
      const { buffer, filename } = await buildClientStatementPdf(client.id);
      attachments.push({ filename, content: buffer });
    }

    const result = await sendEmail({
      to: client.email,
      subject: template.subject,
      html: template.html,
      attachments,
    });

    await logEmail({
      client_id: client.id,
      recipient_email: client.email,
      subject: template.subject,
      message_type: "custom",
      has_attachment: attachments.length > 0,
      attachment_name: attachments[0]?.filename || null,
      status: result.success ? "sent" : "failed",
      provider_response: result,
      sent_by: req.user.id,
    });

    res.json({
      success: result.success,
      message: result.success
        ? result.disabled
          ? "Email disabled - logged only"
          : "Email sent successfully"
        : "Failed to send email",
      data: result,
    });
  } catch (error) {
    logger.error("Send email error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Send a client's account statement (PDF) by email
router.post("/send-statement/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { custom_message } = req.body;

    const clientResult = await query("SELECT * FROM clients WHERE id = $1", [
      clientId,
    ]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResult.rows[0];
    if (!client.email) {
      return res.status(400).json({ error: "Client has no email address" });
    }

    const { buffer, filename } = await buildClientStatementPdf(client.id);

    const company = await getCompanySettings();
    const subject = `Your Account Statement - ${client.client_code}`;
    const template = templates.custom({
      subject,
      message:
        custom_message ||
        "Please find your account statement attached. Thank you for being our valued customer.",
      clientName: client.first_name,
      company,
    });

    const result = await sendEmail({
      to: client.email,
      subject,
      html: template.html,
      attachments: [{ filename, content: buffer }],
    });

    await logEmail({
      client_id: client.id,
      recipient_email: client.email,
      subject,
      message_type: "statement",
      has_attachment: true,
      attachment_name: filename,
      status: result.success ? "sent" : "failed",
      provider_response: result,
      sent_by: req.user.id,
    });

    res.json({
      success: result.success,
      message: result.success
        ? result.disabled
          ? "Email disabled - logged only"
          : "Statement sent"
        : "Failed to send statement",
      data: result,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    logger.error("Send statement error:", error);
    res.status(500).json({ error: "Failed to send statement" });
  }
});

// Send a loan's agreement (PDF) by email
router.post("/send-agreement/:loanId", async (req, res) => {
  try {
    const { loanId } = req.params;

    const loanResult = await query(
      `
      SELECT l.id, l.loan_code, l.principal_amount, l.total_amount_due,
        l.loan_duration_months, l.client_id,
        c.first_name, c.email
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1
    `,
      [loanId],
    );
    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const loan = loanResult.rows[0];
    if (!loan.email) {
      return res.status(400).json({ error: "Client has no email address" });
    }

    const { buffer, filename } = await buildLoanAgreementPdf(loan.id);

    const company = await getCompanySettings();
    const template = templates.loanApproved({
      clientName: loan.first_name,
      loanCode: loan.loan_code,
      principalAmount: loan.principal_amount,
      totalDue: loan.total_amount_due,
      duration: loan.loan_duration_months,
      company,
    });

    const result = await sendEmail({
      to: loan.email,
      subject: template.subject,
      html: template.html,
      attachments: [{ filename, content: buffer }],
    });

    await logEmail({
      client_id: loan.client_id,
      loan_id: loan.id,
      recipient_email: loan.email,
      subject: template.subject,
      message_type: "loan_agreement",
      has_attachment: true,
      attachment_name: filename,
      status: result.success ? "sent" : "failed",
      provider_response: result,
      sent_by: req.user.id,
    });

    res.json({
      success: result.success,
      message: result.success
        ? result.disabled
          ? "Email disabled - logged only"
          : "Loan agreement sent"
        : "Failed to send loan agreement",
      data: result,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    logger.error("Send agreement error:", error);
    res.status(500).json({ error: "Failed to send loan agreement" });
  }
});

// Send overdue notices to all overdue clients with an email address
router.post("/send-overdue-reminders", async (req, res) => {
  try {
    const overdueClients = await query(`
      SELECT DISTINCT
        c.id as client_id, c.first_name, c.last_name, c.email,
        l.id as loan_id, l.loan_code,
        SUM(ps.amount_due - COALESCE(ps.amount_paid, 0)) as total_overdue,
        MAX(CURRENT_DATE - ps.due_date) as max_days_late
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ps.status = 'overdue'
        AND c.email IS NOT NULL
      GROUP BY c.id, c.first_name, c.last_name, c.email, l.id, l.loan_code
    `);

    if (overdueClients.rows.length === 0) {
      return res.json({
        success: true,
        message: "No overdue clients with email addresses",
        sent: 0,
        failed: 0,
        total: 0,
      });
    }

    const company = await getCompanySettings();
    const results = [];
    for (const client of overdueClients.rows) {
      const template = templates.overdueNotice({
        clientName: client.first_name,
        amount: client.total_overdue,
        daysLate: client.max_days_late,
        loanCode: client.loan_code,
        company,
      });

      const result = await sendEmail({
        to: client.email,
        subject: template.subject,
        html: template.html,
      });

      await logEmail({
        client_id: client.client_id,
        loan_id: client.loan_id,
        recipient_email: client.email,
        subject: template.subject,
        message_type: "overdue_reminder",
        status: result.success ? "sent" : "failed",
        provider_response: result,
        sent_by: req.user.id,
      });

      results.push({ client_id: client.client_id, ...result });

      // Small delay between sends to respect provider rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.length - sent;

    res.json({
      success: true,
      message: `Sent ${sent} reminders, ${failed} failed`,
      sent,
      failed,
      total: results.length,
      details: results,
    });
  } catch (error) {
    logger.error("Send overdue reminders error:", error);
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

// Get email logs (with filters)
router.get("/logs", async (req, res) => {
  try {
    const { client_id, message_type, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT
        el.*,
        c.first_name, c.last_name, c.client_code,
        l.loan_code,
        u.first_name as sent_by_name
      FROM email_logs el
      LEFT JOIN clients c ON el.client_id = c.id
      LEFT JOIN loans l ON el.loan_id = l.id
      LEFT JOIN users u ON el.sent_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (client_id) {
      paramCount++;
      queryText += ` AND el.client_id = $${paramCount}`;
      params.push(client_id);
    }

    if (message_type) {
      paramCount++;
      queryText += ` AND el.message_type = $${paramCount}`;
      params.push(message_type);
    }

    queryText += ` ORDER BY el.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const countResult = await query("SELECT COUNT(*) FROM email_logs");
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get email logs error:", error);
    res.status(500).json({ error: "Failed to fetch email logs" });
  }
});

// Get email statistics
router.get("/stats", async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        COUNT(*) as total_sent,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(CASE WHEN has_attachment = true THEN 1 END) as with_attachments,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as last_30_days
      FROM email_logs
    `);

    res.json({
      success: true,
      data: stats.rows[0],
    });
  } catch (error) {
    logger.error("Email stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
