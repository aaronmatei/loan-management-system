// Daily cron: tenant-invoice lifecycle automation.
// Distinct from paymentReminderJob.js (which handles customer-facing
// loan payment_reminder + payment_overdue). This one handles the
// PLATFORM side — LoanFix billing tenants:
//
//   1. markOverdueInvoices()  invoices past due_date → status='overdue'
//                              + email tenant's billing contact.
//   2. autoSuspendTenants()   suspend any tenant whose oldest overdue
//                              invoice is past their billing_suspend_after_days
//                              grace. Founding tenant (id=1) is exempt.
//   3. autoReactivateTenants() reactivate any tenant whose suspension
//                              reason starts with "Auto-suspended" and
//                              who has zero outstanding invoices.
//   4. sendDailySummary()     email platform admins (is_platform_admin=true,
//                              is_active=true) with stats + today's cron
//                              activity.
//
// Each task returns a count of rows affected. Each task is idempotent —
// running twice in a day won't double-process.
//
// Gating: env BILLING_CRON_ENABLED=true. Schedule via BILLING_CRON_SCHEDULE
// (defaults "0 8 * * *" — runs alongside paymentReminderJob at 8 AM).

import cron from "node-cron";
import { query } from "../config/database.js";
import { sendEmail } from "./emailService.js";
import { logSystemAction } from "./auditService.js";
import referralService from "./referralService.js";
import logger from "../config/logger.js";

const FOUNDING_TENANT_ID = 1; // never auto-suspended

// ── 1. Mark overdue invoices ──────────────────────────────────────
export async function markOverdueInvoices() {
  const r = await query(
    `UPDATE invoices
        SET status = 'overdue', updated_at = NOW()
      WHERE status = 'pending'
        AND due_date < CURRENT_DATE
      RETURNING id, tenant_id, invoice_number, total_amount, amount_paid, due_date`,
  );

  for (const inv of r.rows) {
    try {
      const t = await query(
        `SELECT id, business_name, contact_email, contact_phone,
                billing_contact_email, billing_contact_phone
           FROM tenants WHERE id = $1`,
        [inv.tenant_id],
      );
      const tenant = t.rows[0];
      if (!tenant) continue;
      const to = tenant.billing_contact_email || tenant.contact_email;
      if (!to) continue;
      const outstanding = parseFloat(inv.total_amount) - parseFloat(inv.amount_paid || 0);
      const res = await sendEmail({
        to,
        subject: `⚠️ Invoice Overdue — ${inv.invoice_number}`,
        html: invoiceOverdueHtml(inv, tenant, outstanding),
        fromName: "LoanFix Billing",
      });
      // Audit + email log
      await query(
        `INSERT INTO email_logs
           (tenant_id, recipient_email, subject, message_type, has_attachment, status, provider_response)
         VALUES ($1, $2, $3, 'invoice_overdue', false, $4, $5)`,
        [
          inv.tenant_id,
          to,
          `⚠️ Invoice Overdue — ${inv.invoice_number}`,
          res?.success ? "sent" : "failed",
          JSON.stringify(res || {}),
        ],
      );
      await query(
        `INSERT INTO billing_activities (tenant_id, invoice_id, activity_type, details)
         VALUES ($1, $2, 'invoice_marked_overdue', $3)`,
        [
          inv.tenant_id,
          inv.id,
          JSON.stringify({
            outstanding,
            due_date: inv.due_date,
            auto: true,
          }),
        ],
      );
    } catch (err) {
      logger.error(`markOverdueInvoices invoice=${inv.id} error:`, err);
    }
  }
  return r.rows.length;
}

// ── 2. Auto-suspend tenants ───────────────────────────────────────
export async function autoSuspendTenants() {
  // Suspend tenants who have at least one invoice that is overdue by
  // more than their billing_suspend_after_days (default 30). Founding
  // tenant is excluded. Already-suspended tenants stay suspended.
  const candidates = await query(
    `SELECT DISTINCT t.id, t.business_name, t.contact_email,
            t.billing_contact_email, t.billing_suspend_after_days,
            (SELECT MIN(i.due_date) FROM invoices i
              WHERE i.tenant_id = t.id AND i.status = 'overdue') AS oldest_due_date
       FROM tenants t
       JOIN invoices i ON i.tenant_id = t.id
      WHERE t.billing_enabled = true
        AND t.status = 'active'
        AND t.id <> $1
        AND COALESCE(t.is_demo, false) = false
        AND i.status = 'overdue'
        AND i.due_date < CURRENT_DATE - (COALESCE(t.billing_suspend_after_days, 30) || ' days')::interval`,
    [FOUNDING_TENANT_ID],
  );

  let suspended = 0;
  for (const row of candidates.rows) {
    try {
      const upd = await query(
        `UPDATE tenants
            SET status = 'suspended',
                suspension_reason = 'Auto-suspended: Unpaid invoice past grace period',
                updated_at = NOW()
          WHERE id = $1 AND status = 'active'
          RETURNING id`,
        [row.id],
      );
      if (upd.rows.length === 0) continue;
      suspended++;

      const to = row.billing_contact_email || row.contact_email;
      if (to) {
        const res = await sendEmail({
          to,
          subject: "🚫 LoanFix Account Suspended",
          html: suspensionHtml(row),
          fromName: "LoanFix Billing",
        });
        await query(
          `INSERT INTO email_logs
             (tenant_id, recipient_email, subject, message_type, has_attachment, status, provider_response)
           VALUES ($1, $2, $3, 'tenant_suspended', false, $4, $5)`,
          [
            row.id,
            to,
            "🚫 LoanFix Account Suspended",
            res?.success ? "sent" : "failed",
            JSON.stringify(res || {}),
          ],
        );
      }
      await query(
        `INSERT INTO billing_activities (tenant_id, activity_type, details)
         VALUES ($1, 'auto_suspended', $2)`,
        [
          row.id,
          JSON.stringify({
            reason: "Unpaid invoice past grace period",
            oldest_due_date: row.oldest_due_date,
            auto: true,
          }),
        ],
      );

      // Audit (user=null → System actor). Critical severity.
      await logSystemAction({
        tenantId: row.id,
        action: "tenant.auto_suspended",
        entityType: "tenant",
        entityId: row.id,
        entityLabel: row.business_name,
        description: `Auto-suspended ${row.business_name} (unpaid invoice past grace period)`,
        severity: "critical",
        metadata: {
          oldest_due_date: row.oldest_due_date,
          auto: true,
        },
      });
    } catch (err) {
      logger.error(`autoSuspend tenant=${row.id} error:`, err);
    }
  }
  return suspended;
}

// ── 3. Auto-reactivate tenants ────────────────────────────────────
export async function autoReactivateTenants() {
  const candidates = await query(
    `SELECT t.id, t.business_name, t.contact_email, t.billing_contact_email
       FROM tenants t
      WHERE t.status = 'suspended'
        AND t.suspension_reason LIKE 'Auto-suspended%'
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
           WHERE i.tenant_id = t.id
             AND i.status IN ('pending', 'overdue')
             AND COALESCE(i.amount_paid, 0) < i.total_amount
        )`,
  );

  let reactivated = 0;
  for (const row of candidates.rows) {
    try {
      const upd = await query(
        `UPDATE tenants
            SET status = 'active',
                suspension_reason = NULL,
                updated_at = NOW()
          WHERE id = $1 AND status = 'suspended'
          RETURNING id`,
        [row.id],
      );
      if (upd.rows.length === 0) continue;
      reactivated++;

      const to = row.billing_contact_email || row.contact_email;
      if (to) {
        const res = await sendEmail({
          to,
          subject: "✅ LoanFix Account Reactivated",
          html: reactivationHtml(row),
          fromName: "LoanFix Billing",
        });
        await query(
          `INSERT INTO email_logs
             (tenant_id, recipient_email, subject, message_type, has_attachment, status, provider_response)
           VALUES ($1, $2, $3, 'tenant_reactivated', false, $4, $5)`,
          [
            row.id,
            to,
            "✅ LoanFix Account Reactivated",
            res?.success ? "sent" : "failed",
            JSON.stringify(res || {}),
          ],
        );
      }
      await query(
        `INSERT INTO billing_activities (tenant_id, activity_type, details)
         VALUES ($1, 'auto_reactivated', $2)`,
        [row.id, JSON.stringify({ auto: true })],
      );

      // Audit (System actor). Info severity — recovery, not incident.
      await logSystemAction({
        tenantId: row.id,
        action: "tenant.auto_reactivated",
        entityType: "tenant",
        entityId: row.id,
        entityLabel: row.business_name,
        description: `Auto-reactivated ${row.business_name} (all invoices paid)`,
        severity: "info",
        metadata: { auto: true },
      });
    } catch (err) {
      logger.error(`autoReactivate tenant=${row.id} error:`, err);
    }
  }
  return reactivated;
}

// ── 4. Daily summary to platform admins ───────────────────────────
export async function sendDailySummary(results = {}) {
  const stats = (
    await query(`
      SELECT
        (SELECT COUNT(*) FROM tenants WHERE status = 'active')::int    AS active_tenants,
        (SELECT COUNT(*) FROM tenants WHERE status = 'suspended')::int AS suspended_tenants,
        (SELECT COUNT(*) FROM loans   WHERE status = 'active')::int    AS active_loans,
        (SELECT COUNT(*) FROM payment_schedules WHERE status='overdue')::int AS overdue_payments,
        (SELECT COUNT(*) FROM invoices WHERE status='overdue')::int    AS overdue_invoices,
        COALESCE((SELECT SUM(total_amount - COALESCE(amount_paid,0))
                    FROM invoices WHERE status IN ('overdue','pending')), 0) AS outstanding_amount
    `)
  ).rows[0];

  const admins = await query(
    `SELECT email, first_name FROM users
      WHERE is_platform_admin = true AND is_active = true`,
  );
  let sent = 0;
  for (const a of admins.rows) {
    try {
      const res = await sendEmail({
        to: a.email,
        subject: `📊 LoanFix Daily Summary — ${new Date().toLocaleDateString("en-GB")}`,
        html: dailySummaryHtml(results, stats),
        fromName: "LoanFix System",
      });
      await query(
        `INSERT INTO email_logs
           (tenant_id, recipient_email, subject, message_type, has_attachment, status, provider_response)
         VALUES (NULL, $1, $2, 'daily_summary', false, $3, $4)`,
        [
          a.email,
          `📊 LoanFix Daily Summary — ${new Date().toLocaleDateString("en-GB")}`,
          res?.success ? "sent" : "failed",
          JSON.stringify(res || {}),
        ],
      );
      if (res?.success) sent++;
    } catch (err) {
      logger.error(`daily-summary to ${a.email} error:`, err);
    }
  }
  return { admins_notified: sent, stats };
}

// ── Combined daily run (returns the result map the UI displays) ───
export async function runBillingDailyTasks() {
  const started = Date.now();
  const results = {
    tenant_invoices_overdue: 0,
    tenants_suspended: 0,
    tenants_reactivated: 0,
    referrals_qualified: 0,
    admins_notified: 0,
    errors: [],
  };
  try { results.tenant_invoices_overdue = await markOverdueInvoices(); }
  catch (e) { results.errors.push("markOverdueInvoices: " + e.message); }
  try { results.tenants_suspended      = await autoSuspendTenants(); }
  catch (e) { results.errors.push("autoSuspendTenants: " + e.message); }
  try { results.tenants_reactivated    = await autoReactivateTenants(); }
  catch (e) { results.errors.push("autoReactivateTenants: " + e.message); }
  // Promote pending referrals whose referred tenant now meets the
  // configured qualification rule (default: status='active'). Runs
  // here so reactivations earlier in the same tick are picked up.
  try { results.referrals_qualified    = await referralService.processPendingReferrals(); }
  catch (e) { results.errors.push("processPendingReferrals: " + e.message); }
  try {
    const s = await sendDailySummary(results);
    results.admins_notified = s.admins_notified;
    results.stats = s.stats;
  } catch (e) { results.errors.push("sendDailySummary: " + e.message); }

  logger.info(
    `💼 Billing daily: ${results.tenant_invoices_overdue} overdue, ${results.tenants_suspended} suspended, ${results.tenants_reactivated} reactivated, ${results.referrals_qualified} referrals qualified, ${results.admins_notified} admin emails in ${Date.now() - started}ms`,
  );
  return results;
}

// ── Cron registration ─────────────────────────────────────────────
export function setupBillingCron() {
  if (process.env.BILLING_CRON_ENABLED !== "true") {
    logger.info("💼 Billing cron DISABLED");
    return;
  }
  const expr = process.env.BILLING_CRON_SCHEDULE || "0 8 * * *";
  if (!cron.validate(expr)) {
    logger.error(`💼 Invalid BILLING_CRON_SCHEDULE "${expr}" — not started`);
    return;
  }
  logger.info(`💼 Billing cron ENABLED: ${expr}`);
  cron.schedule(expr, () => {
    runBillingDailyTasks().catch((err) =>
      logger.error("billing cron tick error:", err),
    );
  });
}

// ── HTML templates ────────────────────────────────────────────────
function invoiceOverdueHtml(inv, tenant, outstanding) {
  return `<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;margin:0 auto;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:30px;text-align:center;">
        <h1 style="margin:0;">⚠️ Invoice Overdue</h1>
      </td></tr>
      <tr><td style="padding:30px;">
        <p>Hi <strong>${tenant.business_name}</strong>,</p>
        <p>Your LoanFix invoice is now overdue.</p>
        <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:8px;margin:20px 0;">
          <p style="margin:0 0 4px 0;"><strong>Invoice:</strong> ${inv.invoice_number}</p>
          <p style="margin:0 0 4px 0;"><strong>Due:</strong> ${new Date(inv.due_date).toLocaleDateString("en-GB")}</p>
          <p style="margin:0;font-size:24px;color:#dc2626;"><strong>KES ${parseFloat(outstanding).toLocaleString()}</strong> outstanding</p>
        </div>
        <p>Please settle to avoid suspension after the grace period.</p>
      </td></tr>
    </table></body></html>`;
}

function suspensionHtml(tenant) {
  return `<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;margin:0 auto;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;padding:30px;text-align:center;">
        <h1 style="margin:0;">🚫 Account Suspended</h1>
      </td></tr>
      <tr><td style="padding:30px;">
        <p>Hi <strong>${tenant.business_name}</strong>,</p>
        <p>Your LoanFix account has been suspended due to unpaid invoices past the grace period.</p>
        <ul>
          <li>Staff dashboard access is blocked</li>
          <li>Customer portal continues to work (we don't penalize customers)</li>
          <li>Your data is preserved</li>
        </ul>
        <p>Pay outstanding invoices to reactivate — it's automatic.</p>
      </td></tr>
    </table></body></html>`;
}

function reactivationHtml(tenant) {
  return `<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;margin:0 auto;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;padding:30px;text-align:center;">
        <h1 style="margin:0;">✅ Account Reactivated</h1>
      </td></tr>
      <tr><td style="padding:30px;">
        <p>Welcome back, <strong>${tenant.business_name}</strong>!</p>
        <p>All your data is intact. You can resume normal operations immediately.</p>
      </td></tr>
    </table></body></html>`;
}

function dailySummaryHtml(results, stats) {
  const row = (label, value, color = "") =>
    `<tr><td style="padding:6px 0;">${label}</td><td style="text-align:right;font-weight:bold;${color ? `color:${color};` : ""}">${value}</td></tr>`;
  return `<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;margin:0 auto;overflow:hidden;">
      <tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;padding:30px;text-align:center;">
        <h1 style="margin:0;">📊 LoanFix Daily Summary</h1>
        <p style="margin:8px 0 0 0;opacity:.9;">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </td></tr>
      <tr><td style="padding:30px;">
        <h2>🤖 Billing-Cron Activity</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px;">
          ${row("📄 Invoices marked overdue", results.tenant_invoices_overdue || 0)}
          ${row("🚫 Tenants auto-suspended", results.tenants_suspended || 0, "#dc2626")}
          ${row("✅ Tenants auto-reactivated", results.tenants_reactivated || 0, "#16a34a")}
        </table>
        <h2 style="margin-top:28px;">📈 Platform Stats</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#dbeafe;border-radius:8px;padding:16px;">
          ${row("🏢 Active tenants", stats?.active_tenants ?? "?")}
          ${row("🚫 Suspended tenants", stats?.suspended_tenants ?? "?", "#dc2626")}
          ${row("💰 Active loans", stats?.active_loans ?? "?")}
          ${row("⚠️ Overdue payments (customer side)", stats?.overdue_payments ?? "?", "#dc2626")}
          ${row("📄 Overdue invoices", stats?.overdue_invoices ?? "?", "#dc2626")}
          ${row("💵 Outstanding", "KES " + parseFloat(stats?.outstanding_amount || 0).toLocaleString(), "#dc2626")}
        </table>
        ${results.errors?.length ? `<h2 style="margin-top:28px;color:#dc2626;">⚠️ Errors</h2><ul style="color:#7f1d1d;">${results.errors.map((e) => `<li>${e}</li>`).join("")}</ul>` : ""}
      </td></tr>
    </table></body></html>`;
}

export default {
  setupBillingCron,
  runBillingDailyTasks,
  markOverdueInvoices,
  autoSuspendTenants,
  autoReactivateTenants,
  sendDailySummary,
};
