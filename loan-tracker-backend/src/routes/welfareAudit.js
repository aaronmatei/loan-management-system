// Welfare admin audit log. A welfare is its own tenant, and audit_logs is
// tenant-scoped, so "all audit for this welfare" == audit_logs for the
// welfare's tenant_id. Mounted at /api/welfares/:welfareId.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Resolve + tenant-guard the welfare (same pattern as the other welfare routes).
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (audit) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /audit — paginated, filterable activity log for this welfare's tenant.
router.get("/audit", authorize("admin", "manager"), async (req, res) => {
  try {
    const { action, entity_type, date_from, date_to, search } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const params = [req.welfare.tenant_id];
    let where = " WHERE al.tenant_id = $1";
    let p = 1;
    if (action) { p++; where += ` AND al.action = $${p}`; params.push(action); }
    if (entity_type) { p++; where += ` AND al.entity_type = $${p}`; params.push(entity_type); }
    if (date_from) { p++; where += ` AND al.created_at >= $${p}`; params.push(date_from); }
    if (date_to) { p++; where += ` AND al.created_at <= $${p}::date + INTERVAL '1 day'`; params.push(date_to); }
    if (search) {
      p++;
      where += ` AND (al.description ILIKE $${p} OR al.entity_code ILIKE $${p} OR al.user_name ILIKE $${p})`;
      params.push(`%${search}%`);
    }

    const rows = (await query(
      `SELECT al.id, al.created_at, al.user_name, al.user_email, al.action,
              al.action_category, al.entity_type, al.entity_code, al.description, al.severity
         FROM audit_logs al${where}
        ORDER BY al.created_at DESC
        LIMIT $${p + 1} OFFSET $${p + 2}`,
      [...params, limit, offset],
    )).rows;

    const total = parseInt((await query(`SELECT COUNT(*) FROM audit_logs al${where}`, params)).rows[0].count, 10);
    // Distinct actions in this tenant — powers the filter dropdown.
    const actions = (await query(
      `SELECT DISTINCT action FROM audit_logs WHERE tenant_id = $1 ORDER BY action`,
      [req.welfare.tenant_id],
    )).rows.map((r) => r.action);

    res.json({ success: true, data: rows, total, page, limit, actions });
  } catch (e) {
    logger.error("welfare audit error:", e);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

export default router;
