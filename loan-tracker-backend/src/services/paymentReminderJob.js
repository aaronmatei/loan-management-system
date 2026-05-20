// Daily cron: payment_reminder + payment_overdue
//
// Runs once per day (configurable). For every tenant:
//   • reminders: payment_schedules where due_date = today + reminder_days_before
//     AND status = 'pending'. Fires notify('payment_reminder') unless a
//     'reminder' message_type was already logged today for that schedule's loan.
//   • overdues: payment_schedules where status = 'pending' AND due_date < today
//     AND (today - due_date) % overdue_reminder_frequency_days == 0.
//     Fires notify('payment_overdue') with dedup against today's
//     'overdue_reminder' log.
//
// Gated by env REMINDER_CRON_ENABLED=true. Cron expression defaults
// to "0 8 * * *" (08:00 local). All work is per-tenant via the
// tenants' own reminder_days_before / overdue_reminder_frequency_days.

import cron from "node-cron";
import { query } from "../config/database.js";
import notificationDispatcher from "./notificationDispatcher.js";
import logger from "../config/logger.js";

/** Daily scan + dispatch. Exported for manual/test invocation. */
export async function runDailyPaymentNotifications() {
  const started = Date.now();
  const summary = { reminders: 0, overdues: 0, errors: 0 };

  // Tenants with their cadence settings + the email/sms pref for the
  // events we're about to consider firing. Filter to status='active'
  // so suspended tenants don't bother their customers.
  const tenants = await query(
    `SELECT id, reminder_days_before, overdue_reminder_frequency_days
       FROM tenants WHERE status = 'active'`,
  );

  for (const t of tenants.rows) {
    try {
      summary.reminders += await runReminders(t);
      summary.overdues += await runOverdues(t);
    } catch (err) {
      summary.errors++;
      logger.error(`paymentNotifications tenant=${t.id} error:`, err);
    }
  }

  logger.info(
    `📨 Daily payment notifications: ${summary.reminders} reminders, ${summary.overdues} overdues, ${summary.errors} errors in ${Date.now() - started}ms`,
  );
  return summary;
}

// ── reminders ──────────────────────────────────────────────────────
async function runReminders(tenant) {
  const reminderDays = tenant.reminder_days_before || 3;
  // Match by exact day so we send at the configured horizon, not every
  // day before. Dedup against today's logs (per loan) so a same-day
  // re-run of the cron doesn't double-send.
  const rows = await query(
    `SELECT ps.id, ps.loan_id, ps.payment_number, ps.due_date, ps.amount_due,
            l.loan_code, c.first_name, c.last_name, c.phone_number, c.email, c.id AS client_id
       FROM payment_schedules ps
       JOIN loans l   ON l.id = ps.loan_id
       JOIN clients c ON c.id = l.client_id
      WHERE l.tenant_id = $1
        AND ps.status = 'pending'
        AND ps.due_date = CURRENT_DATE + ($2 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM sms_logs s
           WHERE s.loan_id = l.id AND s.message_type = 'reminder'
             AND s.created_at::date = CURRENT_DATE
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_logs e
           WHERE e.loan_id = l.id AND e.message_type = 'reminder'
             AND e.created_at::date = CURRENT_DATE
        )`,
    [tenant.id, reminderDays],
  );

  for (const r of rows.rows) {
    await notificationDispatcher.notify("payment_reminder", {
      tenantId: tenant.id,
      customer: {
        first_name: r.first_name,
        last_name: r.last_name,
        phone_number: r.phone_number,
        email: r.email,
        client_id: r.client_id,
      },
      data: {
        loan_id: r.loan_id,
        loan_code: r.loan_code,
        amount: r.amount_due,
        due_date: r.due_date,
        payment_number: r.payment_number,
      },
    });
  }
  return rows.rows.length;
}

// ── overdues ───────────────────────────────────────────────────────
async function runOverdues(tenant) {
  const freq = tenant.overdue_reminder_frequency_days || 3;
  // Fire if days_late >= 1 and (days_late - 1) % freq == 0, so the
  // first nudge lands on day 1 overdue, then every `freq` days after.
  const rows = await query(
    `SELECT ps.id, ps.loan_id, ps.payment_number, ps.due_date, ps.amount_due,
            (CURRENT_DATE - ps.due_date) AS days_late,
            l.loan_code, c.first_name, c.last_name, c.phone_number, c.email, c.id AS client_id
       FROM payment_schedules ps
       JOIN loans l   ON l.id = ps.loan_id
       JOIN clients c ON c.id = l.client_id
      WHERE l.tenant_id = $1
        AND ps.status = 'pending'
        AND ps.due_date < CURRENT_DATE
        AND ((CURRENT_DATE - ps.due_date - 1) % $2) = 0
        AND NOT EXISTS (
          SELECT 1 FROM sms_logs s
           WHERE s.loan_id = l.id AND s.message_type = 'overdue_reminder'
             AND s.created_at::date = CURRENT_DATE
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_logs e
           WHERE e.loan_id = l.id AND e.message_type = 'overdue_reminder'
             AND e.created_at::date = CURRENT_DATE
        )`,
    [tenant.id, freq],
  );

  for (const r of rows.rows) {
    await notificationDispatcher.notify("payment_overdue", {
      tenantId: tenant.id,
      customer: {
        first_name: r.first_name,
        last_name: r.last_name,
        phone_number: r.phone_number,
        email: r.email,
        client_id: r.client_id,
      },
      data: {
        loan_id: r.loan_id,
        loan_code: r.loan_code,
        amount: r.amount_due,
        days_late: r.days_late,
        due_date: r.due_date,
      },
    });
  }
  return rows.rows.length;
}

/** Mount on server boot. Env REMINDER_CRON_ENABLED=true to activate. */
export function setupPaymentNotifications() {
  if (process.env.REMINDER_CRON_ENABLED !== "true") {
    logger.info("📨 Payment reminder cron DISABLED");
    return;
  }
  const expr = process.env.REMINDER_CRON_SCHEDULE || "0 8 * * *";
  if (!cron.validate(expr)) {
    logger.error(`📨 Invalid REMINDER_CRON_SCHEDULE "${expr}" — cron not started`);
    return;
  }
  logger.info(`📨 Payment reminder cron ENABLED: ${expr}`);
  cron.schedule(expr, () => {
    runDailyPaymentNotifications().catch((err) =>
      logger.error("payment reminder cron tick error:", err),
    );
  });
}

export default { setupPaymentNotifications, runDailyPaymentNotifications };
