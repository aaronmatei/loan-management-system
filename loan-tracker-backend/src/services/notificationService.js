import { query } from "../config/database.js";
import logger from "../config/logger.js";

/**
 * Create an in-app notification. Never throws — a failed notification
 * must not break the operation that triggered it (same philosophy as
 * the SMS/email/audit log writes).
 *
 * @param {number}   [userId]   notify this exact user
 * @param {string[]} [roles]    OR notify every active user with one of
 *                              these roles (e.g. ['admin','manager'])
 * @param {number}   [tenantId] REQUIRED when `roles` is used — limits
 *                              the role fan-out to staff of one tenant.
 *                              Without it the role lookup would surface
 *                              admins of every tenant on the platform.
 */
export const createNotification = async ({
  userId = null,
  type,
  title,
  message,
  icon = "📢",
  link = null,
  metadata = null,
  roles = null,
  tenantId = null,
}) => {
  try {
    let userIds = [];
    if (userId) {
      userIds = [userId];
    } else if (roles && roles.length > 0) {
      // Safety net: refuse role-based fan-out without a tenant. We'd
      // rather drop the notification than leak it cross-tenant.
      if (!tenantId) {
        logger.error(
          `createNotification: roles=${JSON.stringify(
            roles,
          )} called without tenantId — dropping to avoid cross-tenant leak`,
        );
        return;
      }
      const result = await query(
        `SELECT id FROM users
          WHERE role = ANY($1) AND is_active = true AND tenant_id = $2`,
        [roles, tenantId],
      );
      userIds = result.rows.map((r) => r.id);
    }
    if (userIds.length === 0) return;

    for (const uid of userIds) {
      await query(
        `INSERT INTO notifications (
          user_id, type, title, message, icon, link, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          uid,
          type,
          title,
          message,
          icon,
          link,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
    }
  } catch (error) {
    logger.error("Failed to create notification:", error);
  }
};

export const notifyApplicationSubmitted = async (loan, client) => {
  await createNotification({
    tenantId: loan.tenant_id,
    roles: ["admin", "manager"],
    type: "application_submitted",
    title: "New Loan Application",
    message: `${client.first_name} ${client.last_name} applied for KES ${parseFloat(
      loan.principal_amount,
    ).toLocaleString()}`,
    icon: "📋",
    link: "/applications",
    metadata: { loan_id: loan.id, client_id: client.id },
  });
};

export const notifyApplicationApproved = async (loan, loanOfficerId) => {
  await createNotification({
    userId: loanOfficerId,
    type: "application_approved",
    title: "Application Approved! ✅",
    message: `Your application ${loan.loan_code} has been approved`,
    icon: "✅",
    link: `/loans/${loan.id}`,
    metadata: { loan_id: loan.id },
  });
};

export const notifyApplicationRejected = async (
  loan,
  loanOfficerId,
  reason,
) => {
  await createNotification({
    userId: loanOfficerId,
    type: "application_rejected",
    title: "Application Rejected ❌",
    message: `Application ${loan.loan_code} rejected: ${reason}`,
    icon: "❌",
    link: `/loans/${loan.id}`,
    metadata: { loan_id: loan.id, reason },
  });
};

export const notifyLargePayment = async (
  transaction,
  loan,
  client,
  threshold = 50000,
) => {
  if (parseFloat(transaction.amount_paid) < threshold) return;
  await createNotification({
    tenantId: loan.tenant_id,
    roles: ["admin", "manager"],
    type: "large_payment",
    title: "Large Payment Received 💰",
    message: `${client.first_name} ${client.last_name} paid KES ${parseFloat(
      transaction.amount_paid,
    ).toLocaleString()} for ${loan.loan_code}`,
    icon: "💰",
    link: `/loans/${loan.id}`,
    metadata: {
      transaction_id: transaction.id,
      loan_id: loan.id,
      amount: transaction.amount_paid,
    },
  });
};

export const notifyLoanCompleted = async (loan, client) => {
  await createNotification({
    tenantId: loan.tenant_id,
    roles: ["admin", "manager"],
    type: "loan_completed",
    title: "Loan Fully Repaid! 🎉",
    message: `${client.first_name} ${client.last_name} completed loan ${loan.loan_code}`,
    icon: "🎉",
    link: `/loans/${loan.id}`,
    metadata: { loan_id: loan.id },
  });
};

export const notifyCapitalLow = async (tenantId, available, total) => {
  const avail = parseFloat(available);
  const tot = parseFloat(total);
  if (!(tot > 0)) return;
  const percentage = (avail / tot) * 100;
  if (percentage > 20) return; // only when under 20%
  await createNotification({
    tenantId,
    roles: ["admin"],
    type: "capital_low",
    title: "Capital Pool Low ⚠️",
    message: `Only KES ${avail.toLocaleString()} available (${percentage.toFixed(
      1,
    )}% of capital)`,
    icon: "🏦",
    link: "/",
    metadata: { available: avail, total: tot, percentage },
  });
};

export const notifyRefundPending = async (loan, client) => {
  await createNotification({
    tenantId: loan.tenant_id,
    roles: ["admin", "manager"],
    type: "refund_pending",
    title: "Refund Action Required 💵",
    message: `${client.first_name} ${client.last_name} is due KES ${parseFloat(
      loan.overpayment_amount,
    ).toLocaleString()} refund`,
    icon: "💵",
    link: `/loans/${loan.id}`,
    metadata: { loan_id: loan.id, amount: loan.overpayment_amount },
  });
};

export default {
  createNotification,
  notifyApplicationSubmitted,
  notifyApplicationApproved,
  notifyApplicationRejected,
  notifyLargePayment,
  notifyLoanCompleted,
  notifyCapitalLow,
  notifyRefundPending,
};
