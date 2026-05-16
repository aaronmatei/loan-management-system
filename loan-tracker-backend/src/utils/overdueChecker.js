import { query } from "../config/database.js";
import logger from "../config/logger.js";

/**
 * Promote past-due pending installments to 'overdue' and keep days_late
 * accurate for everything already flagged overdue.
 *
 * A schedule is overdue when:
 *   - status = 'pending'
 *   - due_date is in the past
 *   - there is still money owed (amount_due > amount_paid)
 *
 * Returns the number of schedules newly marked overdue by this run.
 */
export async function runOverdueCheck() {
  // 1. Newly past-due pending installments -> overdue
  const promoted = await query(`
    UPDATE payment_schedules
    SET status = 'overdue',
        days_late = (CURRENT_DATE - due_date::date),
        updated_at = NOW()
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
      AND amount_due > COALESCE(amount_paid, 0)
    RETURNING id
  `);

  // 2. Refresh days_late for installments already overdue so the
  //    number keeps growing each day without re-running the promotion.
  await query(`
    UPDATE payment_schedules
    SET days_late = (CURRENT_DATE - due_date::date),
        updated_at = NOW()
    WHERE status = 'overdue'
  `);

  const markedCount = promoted.rowCount;

  if (markedCount > 0) {
    logger.info(
      `⚠️ Overdue check: ${markedCount} payment(s) marked as overdue`,
    );
  }

  return markedCount;
}

export default runOverdueCheck;
