// Resolve "my welfare" from the logged-in tenant. A welfare account has exactly
// one welfare record (one per tenant), so the standalone welfare UI never has to
// navigate a list or know an id up front — it asks here on load. Mounted at
// /api/welfare (singular, distinct from /api/welfares/:welfareId).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
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

export default router;
