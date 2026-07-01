import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

// Tenant-side support: a tenant's staff raise tickets to the platform and
// carry on the thread. Everything here is scoped to req.user.tenant_id.
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
        WHERE t.tenant_id = $1
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
    const t = await query("SELECT * FROM support_tickets WHERE id = $1 AND tenant_id = $2", [id, tid]);
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
    const t = await query("SELECT id FROM support_tickets WHERE id = $1 AND tenant_id = $2", [id, tid]);
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

export default router;
