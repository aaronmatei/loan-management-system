// Server-side generation of portal-customer notifications.
//
// Each INSERT ... SELECT maps a source row (payment, loan decision, schedule)
// to its platform_customer via the active customer_tenant_links, with a stable
// per-customer dedupe_key. ON CONFLICT (platform_customer_id, dedupe_key) DO
// NOTHING makes the generator safe to run repeatedly — on every fetch (scoped
// to one customer) and from the daily cron (all customers).
import { query } from "../config/database.js";
import logger from "../config/logger.js";

async function generate(pcId = null) {
  const filter = pcId ? "AND ctl.platform_customer_id = $1" : "";
  const p = pcId ? [pcId] : [];

  const LINK = `JOIN customer_tenant_links ctl
       ON ctl.client_id = l.client_id AND ctl.tenant_id = l.tenant_id
      AND ctl.status = 'active'`;

  // Payments received
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'payment', t.amount_paid,
            'payment:' || t.id, t.payment_date::timestamp
     FROM transactions t
     JOIN loans l ON t.loan_id = l.id
     ${LINK}
     WHERE t.payment_status = 'completed' ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Application picked up for review (staff clicked "Start Review"
  // or otherwise transitioned the loan to under_review). reviewed_at
  // is set on direct-approve too via COALESCE in the approve route,
  // so this also fires for fast-track approvals — fine, the customer
  // sees "your application is being reviewed" before "approved",
  // which is the right narrative.
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'under_review', l.principal_amount,
            'under_review:' || l.id, l.reviewed_at
     FROM loans l ${LINK}
     WHERE l.reviewed_at IS NOT NULL ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Counter-offer received from the lender. amount is the offered
  // (counter) figure — what the lender is willing to give — so the
  // customer sees the new number in the bell directly.
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'counter_offered', l.offered_amount,
            'counter_offered:' || l.id, l.counter_offered_at
     FROM loans l ${LINK}
     WHERE l.counter_offered_at IS NOT NULL ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Application approved
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'approved', l.principal_amount,
            'approved:' || l.id, l.approved_at
     FROM loans l ${LINK}
     WHERE l.status = 'approved' AND l.approved_at IS NOT NULL ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Loan disbursed
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'disbursed', l.principal_amount,
            'disbursed:' || l.id, l.disbursed_at
     FROM loans l ${LINK}
     WHERE l.disbursed_at IS NOT NULL ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Application declined
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'rejected', NULL,
            'rejected:' || l.id, l.rejected_at
     FROM loans l ${LINK}
     WHERE l.status = 'rejected' AND l.rejected_at IS NOT NULL ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Overdue payments
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'overdue',
            (ps.amount_due - COALESCE(ps.amount_paid,0)),
            'overdue:' || ps.id, ps.due_date::timestamp
     FROM payment_schedules ps
     JOIN loans l ON ps.loan_id = l.id
     ${LINK}
     WHERE ps.status = 'overdue' ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );

  // Due-date reminders: pending installments due within the next 3 days
  await query(
    `INSERT INTO customer_notifications
       (platform_customer_id, tenant_id, loan_id, type, amount, dedupe_key, created_at)
     SELECT ctl.platform_customer_id, l.tenant_id, l.id, 'due_soon',
            (ps.amount_due - COALESCE(ps.amount_paid,0)),
            'due_soon:' || ps.id, NOW()
     FROM payment_schedules ps
     JOIN loans l ON ps.loan_id = l.id
     ${LINK}
     WHERE ps.status = 'pending'
       AND ps.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '3 days')
       ${filter}
     ON CONFLICT (platform_customer_id, dedupe_key) DO NOTHING`,
    p,
  );
}

/** Generate any missing notifications for one customer (called on fetch). */
export async function syncForCustomer(platformCustomerId) {
  await generate(platformCustomerId);
}

/** Generate for every active customer (daily cron). */
export async function syncAllCustomers() {
  try {
    await generate(null);
  } catch (err) {
    logger.error("customer notification sync (all) failed:", err);
  }
}

export default { syncForCustomer, syncAllCustomers };
