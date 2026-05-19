import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { sendSMS, templates } from "../services/smsService.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);
// Matrix: viewers have no SMS access (spec's file list omitted this,
// but the permission matrix is explicit).
router.use(authorize("admin", "manager", "loan_officer"));

// Log an SMS to the database
const logSMS = async (data) => {
  try {
    await query(
      `
      INSERT INTO sms_logs (
        tenant_id, client_id, loan_id, phone_number, message, message_type,
        status, provider_response, sent_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
      [
        data.tenant_id || null,
        data.client_id || null,
        data.loan_id || null,
        data.phone_number,
        data.message,
        data.message_type || "custom",
        data.status || "sent",
        JSON.stringify(data.provider_response || {}),
        data.sent_by || null,
      ],
    );
  } catch (error) {
    logger.error("Failed to log SMS:", error);
  }
};

// Send custom SMS to a single client
router.post("/send", async (req, res) => {
  try {
    const { client_id, message, message_type } = req.body;

    if (!client_id || !message) {
      return res
        .status(400)
        .json({ error: "Client and message are required" });
    }

    const ct = tenantClause(req, 1);
    const clientResult = await query(
      `SELECT * FROM clients WHERE id = $1${ct.clause}`,
      [client_id, ...ct.params],
    );
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResult.rows[0];

    if (!client.phone_number) {
      return res.status(400).json({ error: "Client has no phone number" });
    }

    const result = await sendSMS(client.phone_number, message);

    await logSMS({
      tenant_id: client.tenant_id,
      client_id: client.id,
      phone_number: client.phone_number,
      message,
      message_type: message_type || "custom",
      status: result.success ? "sent" : "failed",
      provider_response: result,
      sent_by: req.user.id,
    });

    res.json({
      success: result.success,
      message: result.success
        ? result.disabled
          ? "SMS disabled - logged only"
          : "SMS sent successfully"
        : "Failed to send SMS",
      data: result,
    });
  } catch (error) {
    logger.error("Send SMS error:", error);
    res.status(500).json({ error: "Failed to send SMS" });
  }
});

// Send overdue notifications to all overdue clients
router.post("/send-overdue-reminders", async (req, res) => {
  try {
    const ot = tenantClause(req, 0, "l.tenant_id");
    const overdueClients = await query(
      `
      SELECT DISTINCT
        c.id as client_id, c.first_name, c.last_name, c.phone_number,
        l.id as loan_id, l.loan_code, l.tenant_id,
        SUM(ps.amount_due - COALESCE(ps.amount_paid, 0)) as total_overdue,
        MAX(CURRENT_DATE - ps.due_date) as max_days_late
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ps.status = 'overdue'
        AND c.phone_number IS NOT NULL${ot.clause}
      GROUP BY c.id, c.first_name, c.last_name, c.phone_number, l.id, l.loan_code, l.tenant_id
    `,
      ot.params,
    );

    if (overdueClients.rows.length === 0) {
      return res.json({
        success: true,
        message: "No overdue clients to notify",
        sent: 0,
      });
    }

    const recipients = overdueClients.rows.map((client) => ({
      phone: client.phone_number,
      client_id: client.client_id,
      loan_id: client.loan_id,
      tenant_id: client.tenant_id,
      message: templates.overdueNotice(
        client.first_name,
        client.total_overdue,
        client.max_days_late,
        client.loan_code,
      ),
    }));

    const results = [];
    for (const recipient of recipients) {
      const result = await sendSMS(recipient.phone, recipient.message);

      await logSMS({
        tenant_id: recipient.tenant_id,
        client_id: recipient.client_id,
        loan_id: recipient.loan_id,
        phone_number: recipient.phone,
        message: recipient.message,
        message_type: "overdue_reminder",
        status: result.success ? "sent" : "failed",
        provider_response: result,
        sent_by: req.user.id,
      });

      results.push({
        client_id: recipient.client_id,
        phone: recipient.phone,
        ...result,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
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

// Send payment confirmation
router.post("/send-payment-confirmation", async (req, res) => {
  try {
    const { transaction_id } = req.body;

    const tt = tenantClause(req, 1, "t.tenant_id");
    const result = await query(
      `
      SELECT t.*, c.first_name, c.last_name, c.phone_number,
        l.loan_code, l.total_amount_due,
        (l.total_amount_due - (SELECT COALESCE(SUM(amount_paid), 0) FROM transactions WHERE loan_id = l.id AND payment_status = 'completed')) as balance
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE t.id = $1${tt.clause}
    `,
      [transaction_id, ...tt.params],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const txn = result.rows[0];
    const message = templates.paymentReceived(
      txn.first_name,
      txn.amount_paid,
      txn.loan_code,
      txn.balance,
    );

    const smsResult = await sendSMS(txn.phone_number, message);

    await logSMS({
      tenant_id: txn.tenant_id,
      client_id: txn.client_id,
      loan_id: txn.loan_id,
      phone_number: txn.phone_number,
      message,
      message_type: "payment_received",
      status: smsResult.success ? "sent" : "failed",
      provider_response: smsResult,
      sent_by: req.user.id,
    });

    res.json({
      success: smsResult.success,
      message: smsResult.success ? "Confirmation sent" : "Failed to send",
      data: smsResult,
    });
  } catch (error) {
    logger.error("Payment confirmation SMS error:", error);
    res.status(500).json({ error: "Failed to send confirmation" });
  }
});

// Get SMS logs (with filters)
router.get("/logs", async (req, res) => {
  try {
    const { client_id, message_type, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT
        sl.*,
        c.first_name, c.last_name, c.client_code,
        l.loan_code,
        u.first_name as sent_by_name
      FROM sms_logs sl
      LEFT JOIN clients c ON sl.client_id = c.id
      LEFT JOIN loans l ON sl.loan_id = l.id
      LEFT JOIN users u ON sl.sent_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (client_id) {
      paramCount++;
      queryText += ` AND sl.client_id = $${paramCount}`;
      params.push(client_id);
    }

    if (message_type) {
      paramCount++;
      queryText += ` AND sl.message_type = $${paramCount}`;
      params.push(message_type);
    }

    const lt = tenantClause(req, paramCount, "sl.tenant_id");
    if (lt.clause) {
      paramCount++;
      queryText += lt.clause;
      params.push(...lt.params);
    }

    queryText += ` ORDER BY sl.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const ct = tenantClause(req, 0);
    const countResult = await query(
      `SELECT COUNT(*) FROM sms_logs WHERE 1=1${ct.clause}`,
      ct.params,
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
    logger.error("Get SMS logs error:", error);
    res.status(500).json({ error: "Failed to fetch SMS logs" });
  }
});

// Get SMS statistics
router.get("/stats", async (req, res) => {
  try {
    const st = tenantClause(req, 0);
    const stats = await query(
      `
      SELECT
        COUNT(*) as total_sent,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(CASE WHEN message_type = 'overdue_reminder' THEN 1 END) as overdue_reminders,
        COUNT(CASE WHEN message_type = 'payment_received' THEN 1 END) as payment_confirmations,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as last_30_days
      FROM sms_logs
      WHERE 1=1${st.clause}
    `,
      st.params,
    );

    res.json({
      success: true,
      data: stats.rows[0],
    });
  } catch (error) {
    logger.error("SMS stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ============================================================
// BULK SMS to selected clients (router already gated to
// admin/manager/loan_officer; viewers excluded).
// ============================================================
router.post("/bulk-send", async (req, res) => {
  try {
    const { client_ids, message } = req.body;

    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: "No clients selected" });
    }
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: "Message is required" });
    }

    const bt = tenantClause(req, 1);
    const clientsResult = await query(
      `SELECT id, tenant_id, first_name, last_name, phone_number
       FROM clients
       WHERE id = ANY($1) AND phone_number IS NOT NULL${bt.clause}`,
      [client_ids, ...bt.params],
    );
    const recipients = clientsResult.rows;
    if (recipients.length === 0) {
      return res.status(400).json({ error: "No clients have phone numbers" });
    }

    const results = [];
    for (const client of recipients) {
      const personalizedMessage = message
        .replaceAll("{first_name}", client.first_name || "")
        .replaceAll("{last_name}", client.last_name || "");

      const result = await sendSMS(client.phone_number, personalizedMessage);

      await query(
        `INSERT INTO sms_logs (
          tenant_id, client_id, phone_number, message, message_type,
          status, provider_response, sent_by
        ) VALUES ($1, $2, $3, $4, 'bulk_custom', $5, $6, $7)`,
        [
          client.tenant_id,
          client.id,
          client.phone_number,
          personalizedMessage,
          result.success ? "sent" : "failed",
          JSON.stringify(result),
          req.user.id,
        ],
      );

      results.push({ client_id: client.id, ...result });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const sent = results.filter((r) => r.success).length;

    await logAudit({
      user: req.user,
      action: "bulk_sms_sent",
      entityType: "sms",
      description: `Bulk SMS sent to ${sent} of ${recipients.length} clients`,
      newValues: {
        sent,
        total: recipients.length,
        message: message.substring(0, 100),
      },
      req,
    });

    res.json({
      success: true,
      message: `Sent ${sent} SMS, ${results.length - sent} failed`,
      sent,
      failed: results.length - sent,
      total: results.length,
    });
  } catch (error) {
    logger.error("Bulk SMS error:", error);
    res.status(500).json({ error: "Failed to send bulk SMS" });
  }
});

export default router;
