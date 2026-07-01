import { query } from "../config/database.js";
import logger from "../config/logger.js";

// ============================================================
// Tenant context + enforcement.
//
// IMPORTANT: data scoping must use req.user.tenant_id (from the
// SIGNED JWT — not forgeable). The subdomain / X-Tenant-* header
// is client-controlled and is only used for pre-auth resolution
// (e.g. login-page branding), NEVER for query scoping.
//
// This middleware is dormant until wired into routes; it is safe
// to have on disk before the multitenancy migration runs.
// ============================================================
export const tenantContext = async (req, res, next) => {
  try {
    let tenantId = req.user?.tenant_id || null;
    let subdomain = null;

    if (!tenantId) {
      const host = req.get("host") || "";
      const parts = host.split(".");
      if (parts.length >= 2 && !["www", "api"].includes(parts[0])) {
        subdomain = parts[0];
      }
      subdomain = req.headers["x-tenant-subdomain"] || subdomain;
    }

    let tenant = null;
    if (tenantId) {
      const r = await query("SELECT * FROM tenants WHERE id = $1", [
        tenantId,
      ]);
      tenant = r.rows[0];
    } else if (subdomain) {
      const r = await query(
        "SELECT * FROM tenants WHERE subdomain = $1",
        [subdomain],
      );
      tenant = r.rows[0];
    }

    if (tenant && !req.user?.is_platform_admin) {
      if (tenant.status === "suspended") {
        return res.status(403).json({
          error: "Account suspended",
          message:
            "Your account has been suspended. Please contact support.",
          code: "TENANT_SUSPENDED",
        });
      }
      if (tenant.status === "cancelled") {
        return res.status(403).json({
          error: "Account cancelled",
          message: "This account has been cancelled.",
          code: "TENANT_CANCELLED",
        });
      }
      if (tenant.status === "pending") {
        return res.status(403).json({
          error: "Account pending approval",
          message: "Your account is awaiting review by our team.",
          code: "TENANT_PENDING",
        });
      }
      if (tenant.status === "rejected") {
        return res.status(403).json({
          error: "Application not approved",
          message: "Your account application was not approved.",
          code: "TENANT_REJECTED",
        });
      }
      if (
        tenant.plan === "trial" &&
        tenant.trial_ends_at &&
        new Date(tenant.trial_ends_at) < new Date()
      ) {
        return res.status(403).json({
          error: "Trial expired",
          message:
            "Your trial period has ended. Please upgrade to continue.",
          code: "TRIAL_EXPIRED",
        });
      }
    }

    req.tenant = tenant;
    req.tenantId = tenant?.id;
    next();
  } catch (error) {
    logger.error("Tenant context error:", error);
    res.status(500).json({ error: "Failed to identify tenant" });
  }
};

export const requireTenant = (req, res, next) => {
  if (!req.tenant) {
    return res
      .status(400)
      .json({ error: "No tenant context", message: "Tenant required" });
  }
  next();
};

export const requirePlatformAdmin = (req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res
      .status(403)
      .json({ error: "Platform admin access required" });
  }
  next();
};

export const checkLimit = (limitType) => async (req, res, next) => {
  if (!req.tenant) return next();
  try {
    let currentCount = 0;
    let maxAllowed = 0;
    if (limitType === "clients") {
      const r = await query(
        "SELECT COUNT(*) AS count FROM clients WHERE tenant_id = $1",
        [req.tenant.id],
      );
      currentCount = parseInt(r.rows[0].count, 10);
      maxAllowed = req.tenant.max_clients;
    } else if (limitType === "loans") {
      const r = await query(
        `SELECT COUNT(*) AS count FROM loans
         WHERE tenant_id = $1
           AND status IN ('active','pending','under_review','approved')`,
        [req.tenant.id],
      );
      currentCount = parseInt(r.rows[0].count, 10);
      maxAllowed = req.tenant.max_loans;
    } else if (limitType === "users") {
      const r = await query(
        "SELECT COUNT(*) AS count FROM users WHERE tenant_id = $1 AND is_active = true",
        [req.tenant.id],
      );
      currentCount = parseInt(r.rows[0].count, 10);
      maxAllowed = req.tenant.max_users;
    }
    if (maxAllowed && currentCount >= maxAllowed) {
      return res.status(403).json({
        error: "Limit reached",
        message: `Your plan allows up to ${maxAllowed} ${limitType}. Please upgrade to add more.`,
        code: "LIMIT_REACHED",
        current: currentCount,
        max: maxAllowed,
      });
    }
    next();
  } catch (error) {
    logger.error("Limit check error:", error);
    next(); // never block on a limit-check failure
  }
};

export default {
  tenantContext,
  requireTenant,
  requirePlatformAdmin,
  checkLimit,
};
