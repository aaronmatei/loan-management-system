import express from "express";
import { query } from "../../config/database.js";
import { verifyToken } from "../../middleware/auth.js";
import { logTenantAction } from "../../services/auditService.js";
import logger from "../../config/logger.js";

const router = express.Router();

// Platform-admin only. verifyToken sets req.user from the signed JWT
// (which carries is_platform_admin); this is the real gate — the
// frontend check is just UX.
const requirePlatformAdmin = (req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res
      .status(403)
      .json({ error: "Platform admin access required" });
  }
  next();
};

router.use(verifyToken, requirePlatformAdmin);

// Platform dashboard overview
router.get("/dashboard", async (req, res) => {
  try {
    const tenantsOverview = await query(`
      SELECT
        COUNT(*)::int AS total_tenants,
        COUNT(*) FILTER (WHERE status = 'active')::int    AS active_tenants,
        COUNT(*) FILTER (WHERE status = 'trial')::int     AS trial_tenants,
        COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_tenants,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_this_month
      FROM tenants
    `);

    const platformMetrics = await query(`
      SELECT
        (SELECT COUNT(*) FROM clients)::int AS total_clients,
        (SELECT COUNT(*) FROM loans WHERE status='active')::int AS total_active_loans,
        (SELECT COUNT(*) FROM loans)::int AS total_loans_ever,
        (SELECT COALESCE(SUM(principal_amount),0) FROM loans
           WHERE status IN ('active','completed','defaulted')) AS total_disbursed,
        (SELECT COALESCE(SUM(amount_paid),0) FROM transactions
           WHERE payment_status='completed') AS total_collected,
        (SELECT COUNT(*) FROM users WHERE is_platform_admin = false)::int AS total_staff_users,
        (SELECT COUNT(*) FROM platform_customers)::int AS total_customers,
        (SELECT COUNT(*) FROM customer_tenant_links)::int AS total_customer_links
    `);

    const recentSignups = await query(`
      SELECT
        id, business_name, subdomain, status, created_at,
        (SELECT COUNT(*) FROM clients WHERE tenant_id = tenants.id)::int AS client_count,
        (SELECT COUNT(*) FROM loans WHERE tenant_id = tenants.id)::int   AS loan_count
      FROM tenants
      WHERE id <> 1
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Scalar subqueries (NOT joins) — joining loans×transactions then
    // SUM-ming fans out and multiplies both figures (a bug the rest
    // of this codebase explicitly avoids).
    const topTenants = await query(`
      SELECT
        t.id, t.business_name, t.subdomain, t.brand_color, t.status,
        (SELECT COUNT(*) FROM clients WHERE tenant_id = t.id)::int AS client_count,
        (SELECT COUNT(*) FROM loans   WHERE tenant_id = t.id)::int AS loan_count,
        (SELECT COALESCE(SUM(principal_amount),0) FROM loans
           WHERE tenant_id = t.id AND status = 'active') AS active_portfolio,
        (SELECT COALESCE(SUM(amount_paid),0) FROM transactions
           WHERE tenant_id = t.id AND payment_status = 'completed') AS total_collected
      FROM tenants t
      ORDER BY active_portfolio DESC
      LIMIT 10
    `);

    const growthChart = await query(`
      SELECT DATE_TRUNC('month', created_at) AS month,
             COUNT(*)::int AS tenants_added
      FROM tenants
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1 ASC
    `);

    res.json({
      success: true,
      data: {
        tenants_overview: tenantsOverview.rows[0],
        platform_metrics: platformMetrics.rows[0],
        recent_signups: recentSignups.rows,
        top_tenants: topTenants.rows,
        growth_chart: growthChart.rows,
      },
    });
  } catch (error) {
    logger.error("Platform dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch platform data" });
  }
});

// All tenants (filterable)
router.get("/tenants", async (req, res) => {
  try {
    const { status, search } = req.query;
    let q = `
      SELECT
        t.*,
        (SELECT COUNT(*) FROM clients WHERE tenant_id = t.id)::int AS client_count,
        (SELECT COUNT(*) FROM loans WHERE tenant_id = t.id)::int   AS loan_count,
        (SELECT COUNT(*) FROM loans WHERE tenant_id = t.id AND status='active')::int AS active_loans,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND is_platform_admin=false)::int AS staff_count,
        (SELECT COALESCE(SUM(principal_amount),0) FROM loans
           WHERE tenant_id = t.id AND status IN ('active','completed','defaulted')) AS total_disbursed,
        (SELECT COALESCE(SUM(amount_paid),0) FROM transactions
           WHERE tenant_id = t.id AND payment_status='completed') AS total_collected,
        (SELECT MAX(created_at) FROM loans WHERE tenant_id = t.id) AS last_loan_date
      FROM tenants t
      WHERE 1=1
    `;
    const params = [];
    if (status && status !== "all") {
      params.push(status);
      q += ` AND t.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (t.business_name ILIKE $${params.length} OR t.subdomain ILIKE $${params.length} OR t.tenant_code ILIKE $${params.length})`;
    }
    q += ` ORDER BY t.created_at DESC`;
    const result = await query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("List tenants error:", error);
    res.status(500).json({ error: "Failed to fetch tenants" });
  }
});

// Tenant detail
router.get("/tenants/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const t = await query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM clients WHERE tenant_id = t.id)::int AS client_count,
        (SELECT COUNT(*) FROM loans WHERE tenant_id = t.id)::int   AS loan_count,
        (SELECT COUNT(*) FROM loans WHERE tenant_id = t.id AND status='active')::int AS active_loans,
        (SELECT COUNT(*) FROM transactions WHERE tenant_id = t.id)::int AS transaction_count,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id)::int AS user_count
       FROM tenants t WHERE t.id = $1`,
      [id],
    );
    if (t.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const recentActivity = await query(
      `SELECT 'loan_created' AS type, loan_code AS code, created_at, principal_amount AS amount
         FROM loans WHERE tenant_id = $1
       UNION ALL
       SELECT 'payment_received' AS type, transaction_code AS code, created_at, amount_paid AS amount
         FROM transactions WHERE tenant_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [id],
    );

    // users has is_active (boolean), not a `status` column.
    const users = await query(
      `SELECT id, first_name, last_name, email, role, is_active,
              last_login, created_at
       FROM users
       WHERE tenant_id = $1 AND is_platform_admin = false
       ORDER BY created_at DESC`,
      [id],
    );

    const financials = await query(
      `SELECT
         COALESCE(SUM(principal_amount) FILTER (WHERE status IN ('active','completed','defaulted')),0) AS total_disbursed,
         COALESCE(SUM(principal_amount) FILTER (WHERE status='active'),0)   AS outstanding_principal,
         COALESCE(SUM(principal_amount) FILTER (WHERE status='defaulted'),0) AS defaulted_amount,
         COALESCE(SUM(total_interest) FILTER (WHERE status IN ('active','completed','defaulted')),0) AS total_interest_earned,
         (SELECT COALESCE(SUM(amount_paid),0) FROM transactions
            WHERE tenant_id = $1 AND payment_status='completed') AS total_collected
       FROM loans WHERE tenant_id = $1`,
      [id],
    );

    res.json({
      success: true,
      data: {
        tenant: t.rows[0],
        recent_activity: recentActivity.rows,
        users: users.rows,
        financials: financials.rows[0],
      },
    });
  } catch (error) {
    logger.error("Get tenant details error:", error);
    res.status(500).json({ error: "Failed to fetch tenant details" });
  }
});

// Update tenant status (suspend/activate/etc)
router.put("/tenants/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body || {};
    const valid = ["active", "trial", "suspended", "cancelled"];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (parseInt(id, 10) === 1) {
      return res
        .status(403)
        .json({ error: "Cannot modify the founding tenant" });
    }
    const result = await query(
      `UPDATE tenants
       SET status = $1, suspension_reason = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, reason || null, id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    logger.info(
      `Platform admin ${req.user.email} set tenant ${id} status -> ${status}`,
    );

    // Audit: 'tenant.suspended' / 'tenant.activated' / etc. Severity
    // bumps to 'critical' for suspensions (handled inside helper).
    const map = {
      active: "activated",
      trial: "trial_set",
      suspended: "suspended",
      cancelled: "cancelled",
    };
    await logTenantAction(
      req.user,
      map[status] || status,
      result.rows[0],
      req,
      { metadata: { reason: reason || null, previous_status: status } },
    );

    res.json({
      success: true,
      message: `Tenant status updated to ${status}`,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update tenant status error:", error);
    res.status(500).json({ error: "Failed to update tenant status" });
  }
});

// Platform-wide analytics
router.get("/stats", async (req, res) => {
  try {
    const monthlyTrends = await query(`
      SELECT DATE_TRUNC('month', created_at) AS month,
             COUNT(*)::int AS loans_created,
             -- Only count loans actually disbursed (not pending/unapproved).
             COALESCE(SUM(principal_amount)
               FILTER (WHERE status IN ('active','completed','defaulted')),0) AS total_disbursed
      FROM loans
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1 ASC
    `);
    const collectionsTrends = await query(`
      SELECT DATE_TRUNC('month', payment_date) AS month,
             COUNT(*)::int AS payment_count,
             COALESCE(SUM(amount_paid),0) AS total_collected
      FROM transactions
      WHERE payment_date >= NOW() - INTERVAL '12 months'
        AND payment_status='completed'
      GROUP BY 1 ORDER BY 1 ASC
    `);
    const tenantsByStatus = await query(`
      SELECT status, COUNT(*)::int AS count FROM tenants GROUP BY status
    `);
    const customerEngagement = await query(`
      SELECT
        COUNT(DISTINCT pc.id)::int AS total_customers,
        COUNT(DISTINCT pc.id) FILTER (WHERE pc.last_login >= NOW() - INTERVAL '30 days')::int AS active_customers,
        COUNT(DISTINCT pc.id) FILTER (WHERE pc.last_login >= NOW() - INTERVAL '7 days')::int  AS weekly_active,
        COALESCE(AVG(tc.tenant_count),0) AS avg_tenants_per_customer
      FROM platform_customers pc
      LEFT JOIN (
        SELECT platform_customer_id, COUNT(DISTINCT tenant_id) AS tenant_count
        FROM customer_tenant_links GROUP BY platform_customer_id
      ) tc ON tc.platform_customer_id = pc.id
    `);
    res.json({
      success: true,
      data: {
        monthly_trends: monthlyTrends.rows,
        collections_trends: collectionsTrends.rows,
        tenants_by_status: tenantsByStatus.rows,
        customer_engagement: customerEngagement.rows[0],
      },
    });
  } catch (error) {
    logger.error("Platform stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
