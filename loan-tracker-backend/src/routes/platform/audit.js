// Cross-tenant audit log for platform admins. Distinct from
// /api/audit which is tenant-scoped via tenantClause. This route is
// mounted at /api/platform/audit and shows every tenant's actions
// plus system/cron actions (where tenant_id is the affected tenant).
//
// Mirrors the platform/admin.js mount pattern: verifyToken +
// requirePlatformAdmin.

import express from "express";
import { query } from "../../config/database.js";
import { verifyToken } from "../../middleware/auth.js";
import logger from "../../config/logger.js";

const router = express.Router();

const requirePlatformAdmin = (req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res.status(403).json({ error: "Platform admin only" });
  }
  next();
};

router.use(verifyToken, requirePlatformAdmin);

router.get("/", async (req, res) => {
  try {
    const {
      tenant_id,
      category,
      action,
      severity,
      user_id,
      entity_type,
      search,
      date_from,
      date_to,
      page = 1,
      limit = 50,
    } = req.query;

    const filters = [];
    const params = [];

    if (tenant_id) {
      params.push(parseInt(tenant_id, 10));
      filters.push(`al.tenant_id = $${params.length}`);
    }
    if (category) {
      params.push(category);
      filters.push(`al.action_category = $${params.length}`);
    }
    if (action) {
      params.push(action);
      filters.push(`al.action = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      filters.push(`al.severity = $${params.length}`);
    }
    if (user_id) {
      params.push(parseInt(user_id, 10));
      filters.push(`al.user_id = $${params.length}`);
    }
    if (entity_type) {
      params.push(entity_type);
      filters.push(`al.entity_type = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(
        `(al.description ILIKE $${params.length} OR al.user_name ILIKE $${params.length} OR al.entity_label ILIKE $${params.length} OR al.entity_code ILIKE $${params.length})`,
      );
    }
    if (date_from) {
      params.push(date_from);
      filters.push(`al.created_at >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      filters.push(`al.created_at <= $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Count total
    const cnt = await query(
      `SELECT COUNT(*)::int AS n FROM audit_logs al ${where}`,
      params,
    );
    const total = cnt.rows[0].n;

    // Paginate
    const lim = Math.min(parseInt(limit, 10) || 50, 500);
    const off = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
    params.push(lim, off);

    const r = await query(
      `SELECT al.*, t.business_name AS tenant_name, t.subdomain AS tenant_subdomain
         FROM audit_logs al
         LEFT JOIN tenants t ON t.id = al.tenant_id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      success: true,
      data: r.rows,
      pagination: {
        total,
        page: parseInt(page, 10) || 1,
        limit: lim,
        pages: Math.ceil(total / lim),
      },
    });
  } catch (err) {
    logger.error("platform audit list error:", err);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const s = await query(`
      SELECT
        COUNT(*)::int                                                              AS total_events,
        COUNT(*) FILTER (WHERE severity = 'critical')::int                         AS critical_events,
        COUNT(*) FILTER (WHERE severity = 'warning')::int                          AS warning_events,
        COUNT(*) FILTER (WHERE action ILIKE 'login_failed%' OR action = 'login_failed')::int AS failed_logins,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int                    AS today_events,
        COUNT(DISTINCT user_id)::int                                               AS unique_users,
        COUNT(DISTINCT tenant_id)::int                                             AS tenants_touched
      FROM audit_logs
    `);
    const top = await query(`
      SELECT action, COUNT(*)::int AS count
        FROM audit_logs
       GROUP BY action ORDER BY count DESC LIMIT 10
    `);
    res.json({
      success: true,
      data: { summary: s.rows[0], top_actions: top.rows },
    });
  } catch (err) {
    logger.error("platform audit summary error:", err);
    res.status(500).json({ error: "Failed to fetch audit summary" });
  }
});

// Tenant list for the filter dropdown
router.get("/tenants", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, business_name, subdomain
         FROM tenants ORDER BY business_name`,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("platform audit tenants error:", err);
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

export default router;
