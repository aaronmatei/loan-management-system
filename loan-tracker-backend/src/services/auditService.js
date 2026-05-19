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

    await query(
      `INSERT INTO audit_logs (
        tenant_id, user_id, user_email, user_name, action, entity_type, entity_id,
        entity_code, description, old_values, new_values, ip_address,
        user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        user?.tenant_id || null,
        user?.id || null,
        user?.email || "system",
        userName,
        action,
        entityType,
        entityId,
        entityCode,
        description,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress,
        userAgent,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
  } catch (error) {
    // Swallow — auditing must never break the audited operation.
    logger.error("Audit log error:", error);
  }
};

export default { logAudit };
