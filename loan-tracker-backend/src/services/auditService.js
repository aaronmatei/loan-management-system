import { query } from "../config/database.js";
import logger from "../config/logger.js";

/**
 * Record an audit event. Never throws — a failed audit write must not
 * break the operation being audited (same philosophy as the SMS/email
 * log inserts elsewhere in the codebase).
 *
 * @param {Object}  options
 * @param {Object}  options.user        - req.user ({ id, email, role }) or a
 *                                        richer object (login passes the DB row
 *                                        with first_name/last_name).
 * @param {string}  options.action      - created | updated | deleted |
 *                                        status_changed | login | login_failed |
 *                                        payment_recorded | refund_processed | ...
 * @param {string}  options.entityType  - client | loan | payment | transaction |
 *                                        user | capital_pool | settings | report
 * @param {number}  [options.entityId]
 * @param {string}  [options.entityCode] - human code, e.g. CLT-2026-0001
 * @param {string}  [options.description]
 * @param {Object}  [options.oldValues]
 * @param {Object}  [options.newValues]
 * @param {Object}  [options.req]        - Express req, for IP + user agent
 * @param {Object}  [options.metadata]
 */
export const logAudit = async (options) => {
  try {
    const {
      user,
      action,
      entityType,
      entityId = null,
      entityCode = null,
      description = "",
      oldValues = null,
      newValues = null,
      req = null,
      metadata = null,
    } = options;

    // req.user only carries { id, email, role } (see auth.js JWT payload),
    // so user_name is usually the email; the login hook passes the full
    // DB user so the name is populated there. The audit list/stats
    // endpoints also LEFT JOIN users for the current display name.
    const userName = user
      ? `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
        user.email ||
        "Unknown"
      : "System";

    const ipAddress =
      req?.headers?.["x-forwarded-for"] ||
      req?.socket?.remoteAddress ||
      "unknown";
    const userAgent = req?.headers?.["user-agent"] || "unknown";

    // New fields from migration 014 — all optional, all default-safe.
    const {
      tenantId: tenantIdOverride,     // explicit override (e.g. system actions)
      actionCategory = null,           // derived below if not provided
      entityLabel = null,
      severity = "info",
      status = "success",
    } = options;

    // Derive category from action prefix if not explicitly passed.
    // Mirrors the migration's backfill mapping so old + new rows agree.
    const category = actionCategory || deriveCategory(action, entityType);

    await query(
      `INSERT INTO audit_logs (
        tenant_id, user_id, user_email, user_name, user_role, is_platform_admin,
        action, action_category, entity_type, entity_id, entity_code, entity_label,
        description, old_values, new_values, ip_address, user_agent, metadata,
        severity, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20
      )`,
      [
        tenantIdOverride ?? user?.tenant_id ?? null,
        user?.id || null,
        user?.email || "system",
        userName,
        user?.role || null,
        !!user?.is_platform_admin,
        action,
        category,
        entityType,
        entityId,
        entityCode,
        entityLabel || entityCode,        // fall back to code for symmetry
        description,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress,
        userAgent,
        metadata ? JSON.stringify(metadata) : null,
        severity,
        status,
      ],
    );
  } catch (error) {
    // Swallow — auditing must never break the audited operation.
    logger.error("Audit log error:", error);
  }
};

// Mirrors migration 014's CASE statement so back-fill and live writes
// produce the same buckets.
function deriveCategory(action = "", entityType = "") {
  const a = String(action).toLowerCase();
  if (a.startsWith("login") || a === "logout") return "auth";
  if (a.startsWith("application")) return "application";
  if (a.startsWith("payment") || a.startsWith("refund")) return "payment";
  if (a.startsWith("ledger") || a.startsWith("capital")) return "capital";
  if (a.startsWith("backup")) return "backup";
  if (a.startsWith("email") || a.startsWith("sms")) return "messaging";
  if (a.startsWith("tenant") || a.startsWith("auto_")) return "tenant";
  if (a.startsWith("invoice") || a.startsWith("billing")) return "billing";
  if (a.startsWith("settings") || a.startsWith("whitelabel"))
    return "settings";
  if (["client", "loan", "payment", "user", "tenant"].includes(entityType))
    return entityType;
  return "system";
}

// ── Convenience wrappers ──────────────────────────────────────────
// Existing call sites use logAudit(...) directly and keep working.
// These helpers exist so new sites (e.g. cron auto-actions) don't
// have to spell out every field.

export const logTenantAction = (user, action, tenant, req, extra = {}) =>
  logAudit({
    user,
    req,
    tenantId: tenant.id,
    action: `tenant.${action}`,
    actionCategory: "tenant",
    entityType: "tenant",
    entityId: tenant.id,
    entityCode: tenant.subdomain || null,
    entityLabel: tenant.business_name,
    description: `${action.charAt(0).toUpperCase() + action.slice(1)} tenant ${tenant.business_name}`,
    severity: ["suspended", "auto_suspended", "deleted"].includes(action)
      ? "critical"
      : "info",
    ...extra,
  });

// System (no user) variant — for cron-driven actions. Caller supplies
// tenantId explicitly because there's no req.user to read it from.
export const logSystemAction = ({
  tenantId,
  action,
  entityType,
  entityId,
  entityCode,
  entityLabel,
  description,
  severity = "info",
  metadata = null,
}) =>
  logAudit({
    user: null,
    tenantId,
    action,
    entityType,
    entityId,
    entityCode,
    entityLabel,
    description,
    severity,
    metadata,
  });

export default { logAudit, logTenantAction, logSystemAction };
