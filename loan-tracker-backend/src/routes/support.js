import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { sendEmail } from "../services/emailService.js";
import logger from "../config/logger.js";

// Tenant-side support. Two channels, both scoped to req.user.tenant_id:
//   • /tickets  — tickets THIS tenant raises to the platform (channel='platform')
//   • /inbox    — tickets this tenant's CUSTOMERS raise to it (channel='tenant':
//                 borrowers / welfare members). Staff triage + reply here.
const router = express.Router();
router.use(verifyToken);

const TK = (id) => `TK-${String(id).padStart(5, "0")}`;
const PRIORITIES = ["low", "normal", "high"];

// The JWT has no name; look it up for message attribution.
async function actorName(userId) {
  if (!userId) return null;
  const r = await query("SELECT first_name, last_name FROM users WHERE id = $1", [userId]);
  if (!r.rows.length) return null;
  const u = r.rows[0];
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || null;
}

// List this tenant's tickets (most recent activity first).
router.get("/tickets", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(403).json({ error: "Tenant context required" });
    const r = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count
         FROM support_tickets t
        WHERE t.tenant_id = $1 AND t.channel = 'platform'
        ORDER BY t.last_reply_at DESC`,
      [tid],
    );
    res.json({ success: true, data: r.rows.map((t) => ({ ...t, code: TK(t.id) })) });
  } catch (error) {
    logger.error("List tenant tickets error:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// Create a ticket + its opening message.
router.post("/tickets", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(403).json({ error: "Tenant context required" });
    const { subject, body, priority } = req.body || {};
    if (!subject || !subject.trim()) return res.status(400).json({ error: "Subject is required" });
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const pri = PRIORITIES.includes(priority) ? priority : "normal";
    const name = await actorName(req.user.id);
    const t = await query(
      `INSERT INTO support_tickets (tenant_id, subject, priority, status, created_by, created_by_name)
       VALUES ($1, $2, $3, 'open', $4, $5) RETURNING *`,
      [tid, subject.trim().slice(0, 200), pri, req.user.id, name],
    );
    const ticket = t.rows[0];
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'tenant', $2, $3, $4)`,
      [ticket.id, req.user.id, name, body.trim()],
    );
    logger.info(`Tenant ${tid} opened support ticket ${TK(ticket.id)}`);
    res.status(201).json({ success: true, data: { ...ticket, code: TK(ticket.id) } });
  } catch (error) {
    logger.error("Create ticket error:", error);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

// View a ticket + its thread (tenant-scoped).
router.get("/tickets/:id", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const { id } = req.params;
    const t = await query("SELECT * FROM support_tickets WHERE id = $1 AND tenant_id = $2 AND channel = 'platform'", [id, tid]);
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const m = await query(
      "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
      [id],
    );
    res.json({ success: true, data: { ...t.rows[0], code: TK(t.rows[0].id), messages: m.rows } });
  } catch (error) {
    logger.error("Get ticket error:", error);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// Tenant reply — reopens the ticket so it needs platform attention again.
router.post("/tickets/:id/messages", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const { id } = req.params;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const t = await query("SELECT id FROM support_tickets WHERE id = $1 AND tenant_id = $2 AND channel = 'platform'", [id, tid]);
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const name = await actorName(req.user.id);
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'tenant', $2, $3, $4)`,
      [id, req.user.id, name, body.trim()],
    );
    await query(
      `UPDATE support_tickets
          SET status = 'open', resolved_at = NULL, last_reply_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [id],
    );
    res.json({ success: true });
  } catch (error) {
    logger.error("Reply ticket error:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

// ── Customer inbox (channel='tenant') — tickets from this tenant's borrowers /
// welfare members. Staff triage + reply here. ─────────────────────────────
const STATUSES = ["open", "pending", "resolved", "closed"];

router.get("/inbox/summary", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const r = await query(
      "SELECT status, COUNT(*)::int n FROM support_tickets WHERE tenant_id = $1 AND channel = 'tenant' GROUP BY status",
      [tid],
    );
    const out = { open: 0, pending: 0, resolved: 0, closed: 0 };
    for (const row of r.rows) if (out[row.status] != null) out[row.status] = row.n;
    res.json({ success: true, data: out });
  } catch (error) {
    logger.error("Inbox summary error:", error);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

router.get("/inbox", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(403).json({ error: "Tenant context required" });
    const { status } = req.query;
    const params = [tid];
    let where = "t.tenant_id = $1 AND t.channel = 'tenant'";
    if (status && STATUSES.includes(status)) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }
    const r = await query(
      `SELECT t.*, c.first_name, c.last_name, c.phone_number,
              (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count
         FROM support_tickets t
         LEFT JOIN platform_customers c ON c.id = t.platform_customer_id
        WHERE ${where}
        ORDER BY t.last_reply_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows.map((t) => ({ ...t, code: TK(t.id) })) });
  } catch (error) {
    logger.error("List inbox error:", error);
    res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

router.get("/inbox/:id", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const t = await query(
      `SELECT t.*, c.first_name, c.last_name, c.phone_number, c.email
         FROM support_tickets t LEFT JOIN platform_customers c ON c.id = t.platform_customer_id
        WHERE t.id = $1 AND t.tenant_id = $2 AND t.channel = 'tenant'`,
      [req.params.id, tid],
    );
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const m = await query(
      "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
      [req.params.id],
    );
    res.json({ success: true, data: { ...t.rows[0], code: TK(t.rows[0].id), messages: m.rows } });
  } catch (error) {
    logger.error("Get inbox ticket error:", error);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// Staff reply — moves the ticket to 'pending' (awaiting the customer).
router.post("/inbox/:id/messages", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const t = await query(
      "SELECT id, status FROM support_tickets WHERE id = $1 AND tenant_id = $2 AND channel = 'tenant'",
      [req.params.id, tid],
    );
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const name = await actorName(req.user.id);
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'tenant', $2, $3, $4)`,
      [req.params.id, req.user.id, name, body.trim()],
    );
    await query(
      `UPDATE support_tickets
          SET status = CASE WHEN status = 'closed' THEN status ELSE 'pending' END,
              last_reply_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [req.params.id],
    );
    // Email the customer that their provider replied. Fire-and-forget.
    try {
      const meta = await query(
        `SELECT c.email, c.first_name, ten.business_name
           FROM support_tickets st
           JOIN platform_customers c ON c.id = st.platform_customer_id
           JOIN tenants ten ON ten.id = st.tenant_id
          WHERE st.id = $1`,
        [req.params.id],
      );
      const m = meta.rows[0];
      if (m?.email) {
        const safe = body.trim().replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
        await sendEmail({
          to: m.email,
          fromName: m.business_name,
          subject: `New reply to your support request — ${TK(req.params.id)}`,
          html: `<p>Hi ${m.first_name || "there"},</p>
                 <p><strong>${m.business_name}</strong> replied to your support request <strong>${TK(req.params.id)}</strong>:</p>
                 <blockquote style="border-left:3px solid #0d8f63;padding-left:12px;color:#333;">${safe}</blockquote>
                 <p>Log in to your account to view the conversation and reply.</p>`,
        });
      }
    } catch (e) {
      logger.error("Support reply email failed:", e);
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Inbox reply error:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

router.put("/inbox/:id", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    const { status, priority } = req.body || {};
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
    if (priority !== undefined && !PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority" });
    const resolvedAt = status === "resolved" ? "NOW()" : status === "open" || status === "pending" ? "NULL" : "resolved_at";
    const r = await query(
      `UPDATE support_tickets SET
         status = COALESCE($1, status), priority = COALESCE($2, priority),
         resolved_at = ${resolvedAt}, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4 AND channel = 'tenant' RETURNING *`,
      [status ?? null, priority ?? null, req.params.id, tid],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Ticket not found" });
    res.json({ success: true, data: { ...r.rows[0], code: TK(r.rows[0].id) } });
  } catch (error) {
    logger.error("Update inbox ticket error:", error);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

export default router;
