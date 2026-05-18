import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { sendSMS, templates } from "../services/smsService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Log an SMS to the database
const logSMS = async (data) => {
  try {
    await query(
      `
      INSERT INTO sms_logs (
        client_id, loan_id, phone_number, message, message_type,
        status, provider_response, sent_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
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

    const clientResult = await query("SELECT * FROM clients WHERE id = $1", [
      client_id,
    ]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResult.rows[0];

    if (!client.phone_number) {
      return res.status(400).json({ error: "Client has no phone number" });
    }

    const result = await sendSMS(client.phone_number, message);

    await logSMS({
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
    const overdueClients = await query(`
      SELECT DISTINCT
        c.id as client_id, c.first_name, c.last_name, c.phone_number,
        l.id as loan_id, l.loan_code,
        SUM(ps.amount_due - COALESCE(ps.amount_paid, 0)) as total_overdue,
        MAX(CURRENT_DATE - ps.due_date) as max_days_late
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ps.status = 'overdue'
        AND c.phone_number IS NOT NULL
      GROUP BY c.id, c.first_name, c.last_name, c.phone_number, l.id, l.loan_code
    `);

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

    const result = await query(
      `
      SELECT t.*, c.first_name, c.last_name, c.phone_number,
        l.loan_code, l.total_amount_due,
        (l.total_amount_due - (SELECT COALESCE(SUM(amount_paid), 0) FROM transactions WHERE loan_id = l.id AND payment_status = 'completed')) as balance
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE t.id = $1
    `,
      [transaction_id],
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

    queryText += ` ORDER BY sl.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const countResult = await query("SELECT COUNT(*) FROM sms_logs");
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
    const stats = await query(`
      SELECT
        COUNT(*) as total_sent,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(DISTINCT client_id) as unique_clients,
        COUNT(CASE WHEN message_type = 'overdue_reminder' THEN 1 END) as overdue_reminders,
        COUNT(CASE WHEN message_type = 'payment_received' THEN 1 END) as payment_confirmations,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as last_30_days
      FROM sms_logs
    `);

    res.json({
      success: true,
      data: stats.rows[0],
    });
  } catch (error) {
    logger.error("SMS stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
