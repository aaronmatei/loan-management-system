import express from "express";
import { query } from "../../config/database.js";
import { verifyCustomer } from "../../middleware/customerAuth.js";
import logger from "../../config/logger.js";

// Customer -> tenant support (channel='tenant'). A portal customer raises an
// issue to a tenant they're LINKED to: a borrower to one of their lenders, or a
// welfare member to their welfare admin. The target tenant comes in explicitly
// (validated against customer_tenant_links) so a multi-lender borrower can
// pick; it falls back to the currently-scoped tenant. The tenant's staff handle
// these in their inbox.
const router = express.Router();
router.use(verifyCustomer);

const TK = (id) => `TK-${String(id).padStart(5, "0")}`;
const PRIORITIES = ["low", "normal", "high"];

async function customerName(pcid) {
  if (!pcid) return null;
  const r = await query("SELECT first_name, last_name FROM platform_customers WHERE id = $1", [pcid]);
  if (!r.rows.length) return null;
  const u = r.rows[0];
  return `${u.first_name || ""} ${u.last_name || ""}`.trim() || null;
}

// The tenant to act on: explicit (validated against the customer's active
// links) or the currently-scoped tenant. Returns null if not linked.
async function resolveTid(req, explicit) {
  const pcid = req.platformCustomerId;
  const tid = explicit ? parseInt(explicit, 10) : req.currentTenantId;
  if (!pcid || !tid) return null;
  const r = await query(
    "SELECT 1 FROM customer_tenant_links WHERE platform_customer_id = $1 AND tenant_id = $2 AND status = 'active'",
    [pcid, tid],
  );
  return r.rows.length ? tid : null;
}

// Providers the customer can contact (their active links), optionally by kind.
router.get("/providers", async (req, res) => {
  try {
    const pcid = req.platformCustomerId;
    const { kind } = req.query;
    const params = [pcid];
    let kw = "";
    if (kind) { params.push(kind); kw = ` AND t.kind = $${params.length}`; }
    const r = await query(
      `SELECT t.id, t.business_name, t.kind, t.brand_color
         FROM customer_tenant_links ctl JOIN tenants t ON t.id = ctl.tenant_id
        WHERE ctl.platform_customer_id = $1 AND ctl.status = 'active'${kw}
        ORDER BY t.business_name`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("List providers error:", error);
    res.status(500).json({ error: "Failed to fetch providers" });
  }
});

router.get("/tickets", async (req, res) => {
  try {
    const pcid = req.platformCustomerId;
    const tid = await resolveTid(req, req.query.tenant_id);
    if (!tid) return res.status(403).json({ error: "Select a provider first" });
    const r = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count
         FROM support_tickets t
        WHERE t.channel = 'tenant' AND t.tenant_id = $1 AND t.platform_customer_id = $2
        ORDER BY t.last_reply_at DESC`,
      [tid, pcid],
    );
    res.json({ success: true, data: r.rows.map((t) => ({ ...t, code: TK(t.id) })) });
  } catch (error) {
    logger.error("List customer tickets error:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

router.post("/tickets", async (req, res) => {
  try {
    const pcid = req.platformCustomerId;
    const { subject, body, priority, tenant_id } = req.body || {};
    const tid = await resolveTid(req, tenant_id);
    if (!tid) return res.status(403).json({ error: "Select a provider first" });
    if (!subject || !subject.trim()) return res.status(400).json({ error: "Subject is required" });
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const pri = PRIORITIES.includes(priority) ? priority : "normal";
    const name = await customerName(pcid);
    const t = await query(
      `INSERT INTO support_tickets (tenant_id, channel, platform_customer_id, subject, priority, status, created_by, created_by_name)
       VALUES ($1, 'tenant', $2, $3, $4, 'open', $2, $5) RETURNING *`,
      [tid, pcid, subject.trim().slice(0, 200), pri, name],
    );
    const ticket = t.rows[0];
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'customer', $2, $3, $4)`,
      [ticket.id, pcid, name, body.trim()],
    );
    res.status(201).json({ success: true, data: { ...ticket, code: TK(ticket.id) } });
  } catch (error) {
    logger.error("Create customer ticket error:", error);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

// A customer only ever reads/replies to their OWN tickets, so scope by
// platform_customer_id (no tenant param needed here).
router.get("/tickets/:id", async (req, res) => {
  try {
    const pcid = req.platformCustomerId;
    const t = await query(
      "SELECT * FROM support_tickets WHERE id = $1 AND channel = 'tenant' AND platform_customer_id = $2",
      [req.params.id, pcid],
    );
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const m = await query(
      "SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC",
      [req.params.id],
    );
    res.json({ success: true, data: { ...t.rows[0], code: TK(t.rows[0].id), messages: m.rows } });
  } catch (error) {
    logger.error("Get customer ticket error:", error);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

router.post("/tickets/:id/messages", async (req, res) => {
  try {
    const pcid = req.platformCustomerId;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const t = await query(
      "SELECT id FROM support_tickets WHERE id = $1 AND channel = 'tenant' AND platform_customer_id = $2",
      [req.params.id, pcid],
    );
    if (!t.rows.length) return res.status(404).json({ error: "Ticket not found" });
    const name = await customerName(pcid);
    await query(
      `INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body)
       VALUES ($1, 'customer', $2, $3, $4)`,
      [req.params.id, pcid, name, body.trim()],
    );
    await query(
      `UPDATE support_tickets SET status = 'open', resolved_at = NULL, last_reply_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    res.json({ success: true });
  } catch (error) {
    logger.error("Reply customer ticket error:", error);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

export default router;
