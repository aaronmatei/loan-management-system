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

// Member account/security activity that belongs in the welfare's audit (logins,
// password changes, KYC, statements) — borrower-portal noise (viewed_loan,
// widget_event, applications…) is excluded.
const MEMBER_ACTIVITY = [
  "login", "login_failed", "password_changed", "password_reset",
  "registration", "kyc_uploaded", "downloaded_statement",
];

// GET /audit — paginated, filterable activity for this welfare. Merges STAFF
// actions (audit_logs, tenant-scoped) with MEMBER account activity
// (customer_activities for this welfare's members), since member logins and
// password changes are recorded there, not in audit_logs.
router.get("/audit", authorize("admin", "manager"), async (req, res) => {
  try {
    const { action, search } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    // $1 = welfare tenant; $2 = member-activity whitelist.
    const base = `
      WITH combined AS (
        SELECT 'al-' || al.id AS id, al.created_at,
               al.user_name AS actor, al.user_email AS actor_id,
               al.action, al.description, al.entity_code, al.severity, 'staff'::text AS source
          FROM audit_logs al WHERE al.tenant_id = $1
        UNION ALL
        SELECT 'ca-' || ca.id AS id, ca.created_at,
               COALESCE(NULLIF(TRIM(COALESCE(pc.first_name,'') || ' ' || COALESCE(pc.last_name,'')), ''), pc.phone_number) AS actor,
               pc.phone_number AS actor_id,
               ca.activity_type AS action,
               CASE ca.activity_type
                 WHEN 'login' THEN 'Logged in'
                 WHEN 'login_failed' THEN 'Failed login attempt'
                 WHEN 'password_changed' THEN 'Changed password'
                 WHEN 'password_reset' THEN 'Reset password'
                 WHEN 'registration' THEN 'Registered'
                 WHEN 'kyc_uploaded' THEN 'Uploaded KYC document'
                 WHEN 'downloaded_statement' THEN 'Downloaded statement'
                 ELSE ca.activity_type END AS description,
               NULL::text AS entity_code,
               CASE WHEN ca.activity_type = 'login_failed' THEN 'warning' ELSE 'info' END AS severity,
               'member'::text AS source
          FROM customer_activities ca
          JOIN platform_customers pc ON pc.id = ca.platform_customer_id
         WHERE ca.activity_type = ANY($2)
           AND (ca.tenant_id = $1 OR ca.tenant_id IS NULL)
           AND ca.platform_customer_id IN (
             SELECT platform_customer_id FROM customer_tenant_links
              WHERE tenant_id = $1 AND member_id IS NOT NULL)
      )
      SELECT id, created_at, actor AS user_name, actor_id AS user_email,
             action, description, entity_code, severity, source
        FROM combined`;

    const params = [req.welfare.tenant_id, MEMBER_ACTIVITY];
    let where = " WHERE 1=1";
    let p = 2;
    if (action) { p++; where += ` AND action = $${p}`; params.push(action); }
    if (search) {
      p++;
      where += ` AND (description ILIKE $${p} OR entity_code ILIKE $${p} OR user_name ILIKE $${p})`;
      params.push(`%${search}%`);
    }

    const rows = (await query(
      `${base}${where} ORDER BY created_at DESC LIMIT $${p + 1} OFFSET $${p + 2}`,
      [...params, limit, offset],
    )).rows;
    const total = parseInt((await query(`SELECT COUNT(*) FROM (${base}${where}) z`, params)).rows[0].count, 10);
    const actions = (await query(`SELECT DISTINCT action FROM (${base}) z ORDER BY action`, [req.welfare.tenant_id, MEMBER_ACTIVITY])).rows.map((r) => r.action);

    res.json({ success: true, data: rows, total, page, limit, actions });
  } catch (e) {
    logger.error("welfare audit error:", e);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

export default router;
