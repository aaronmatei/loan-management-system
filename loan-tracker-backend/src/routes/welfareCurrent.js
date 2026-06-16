// Resolve "my welfare" from the logged-in tenant. A welfare account has exactly
// one welfare record (one per tenant), so the standalone welfare UI never has to
// navigate a list or know an id up front — it asks here on load. Mounted at
// /api/welfare (singular, distinct from /api/welfares/:welfareId).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// GET /api/welfare/current — the tenant's welfare (id + basics).
router.get("/current", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const r = await query(
      `SELECT id, name, registration_no, status, created_at
         FROM groups WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1`,
      [tid],
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: "No welfare found for this account" });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare current error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /api/welfare/lending — whether this welfare lends to non-members, which
// controls whether it appears to outside borrowers in the customer directory.
router.get("/lending", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const r = await query(
      `SELECT COALESCE(lends_to_non_members, false) AS lends_to_non_members
         FROM tenants WHERE id = $1`,
      [tid],
    );
    res.json({ success: true, data: r.rows[0] || { lends_to_non_members: false } });
  } catch (e) {
    logger.error("welfare lending get error:", e);
    res.status(500).json({ error: "Failed to load lending setting" });
  }
});

// PUT /api/welfare/lending — toggle lending to non-members. Turning it on also
// makes the welfare visible/addable in the borrower directory; turning it off
// withdraws it (it stays members-only).
router.put("/lending", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const enabled = !!req.body?.lends_to_non_members;
    const r = await query(
      `UPDATE tenants
          SET lends_to_non_members = $2,
              customer_portal_enabled = CASE WHEN $2 THEN true ELSE customer_portal_enabled END,
              allow_self_signup       = CASE WHEN $2 THEN true ELSE allow_self_signup END
        WHERE id = $1
        RETURNING COALESCE(lends_to_non_members, false) AS lends_to_non_members`,
      [tid, enabled],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare lending update error:", e);
    res.status(500).json({ error: "Failed to save lending setting" });
  }
});

export default router;
