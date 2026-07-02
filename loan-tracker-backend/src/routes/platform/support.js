import express from "express";
import { query } from "../../config/database.js";
import { verifyToken } from "../../middleware/auth.js";
import logger from "../../config/logger.js";

// Platform-side support inbox: triage + reply to every tenant's tickets.
const router = express.Router();
router.use(verifyToken);
router.use((req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res.status(403).json({ error: "Platform admin access required" });
  }
  next();
});

const TK = (id) => `TK-${String(id).padStart(5, "0")}`;
const PRIORITIES = ["low", "normal", "high"];
const STATUSES = ["open", "pending", "resolved", "closed"];

async function actorName(userId) {
  if (!userId) return null;
  const r = await query("SELECT first_name, last_name FROM users WHERE id = $1", [userId]);
  if (!r.rows.length) return null;
  const u = r.rows[0];
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || null;
}

// Counts by status — powers the tabs + the nav "open" badge.
router.get("/summary", async (req, res) => {
  try {
    const r = await query("SELECT status, COUNT(*)::int AS n FROM support_tickets WHERE channel = 'platform' GROUP BY status");
    const out = { open: 0, pending: 0, resolved: 0, closed: 0 };
    for (const row of r.rows) if (out[row.status] != null) out[row.status] = row.n;
    res.json({ success: true, data: out });
  } catch (error) {
    logger.error("Support summary error:", error);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// All tenants' tickets, optional ?status filter, newest activity first.
router.get("/tickets", async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = "WHERE t.channel = 'platform'";
    if (status && STATUSES.includes(status)) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }
    const r = await query(
      `SELECT t.*, ten.business_name, ten.brand_color, ten.tenant_code,
              (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count
         FROM support_tickets t
         JOIN tenants ten ON ten.id = t.tenant_id
         ${where}
        ORDER BY t.last_reply_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows.map((t) => ({ ...t, code: TK(t.id) })) });
  } catch (error) {
    logger.error("List platform tickets error:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

router.get("/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const t = await query(
      `SELECT t.*, ten.business_name, ten.brand_color, ten.tenant_code
         FROM support_tickets t JOIN tenants ten ON ten.id = t.tenant_id
        WHERE t.id = $1 AND t.channel = 'platform'`,
      [id],
    );
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const m = await query(
      "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
      [id],
    );
    res.json({ success: true, data: { ...t.rows[0], code: TK(t.rows[0].id), messages: m.rows } });
  } catch (error) {
    logger.error("Get platform ticket error:", error);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

// Platform reply — moves the ticket to 'pending' (awaiting the tenant) unless
// it's been closed.
router.post("/tickets/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const t = await query("SELECT id, status FROM support_tickets WHERE id = $1 AND channel = 'platform'", [id]);
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const name = await actorName(req.user.id);
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'platform', $2, $3, $4)`,
      [id, req.user.id, name, body.trim()],
    );
    await query(
      `UPDATE support_tickets
          SET status = CASE WHEN status = 'closed' THEN status ELSE 'pending' END,
              last_reply_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [id],
    );
    res.json({ success: true });
  } catch (error) {
    logger.error("Platform reply error:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

// Triage: set status and/or priority.
router.put("/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body || {};
    if (status !== undefined && !STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority" });
    }
    const resolvedAt =
      status === "resolved" ? "NOW()" : status === "open" || status === "pending" ? "NULL" : "resolved_at";
    const r = await query(
      `UPDATE support_tickets SET
         status      = COALESCE($1, status),
         priority    = COALESCE($2, priority),
         resolved_at = ${resolvedAt},
         updated_at  = NOW()
       WHERE id = $3 AND channel = 'platform' RETURNING *`,
      [status ?? null, priority ?? null, id],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Ticket not found" });
    logger.info(`Platform admin ${req.user.email} updated ticket ${TK(id)}`);
    res.json({ success: true, data: { ...r.rows[0], code: TK(r.rows[0].id) } });
  } catch (error) {
    logger.error("Update ticket error:", error);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

export default router;
