// Promise-to-Pay reconciliation.
//
// Walks every open (pending/partial) promise on a loan, sums the cash
// the borrower has actually paid since the promise was logged, and
// transitions the status accordingly:
//
//   paid_since_made_at == 0           → stays 'pending'
//                                       (the route then derives 'broken'
//                                        once promised_date < today)
//   0 < paid_since_made_at < amount   → 'partial'
//   paid_since_made_at >= amount      → 'kept'
//
// 'Partial' sticks even after promised_date passes — the borrower made
// effort, so it stays out of the Broken queue.
//
// "Paid since" = cumulative cash on the loan from completed transactions
// with created_at >= promise.made_at, net of overpayment_portion only
// (refunds go back to the borrower, so they shouldn't count toward the
// commitment they made). PENALTY IS INCLUDED — the borrower handed
// over that cash too, and from their perspective "I sent 4,630 toward
// my loan" doesn't care how the lender booked it internally. Excluding
// penalty made a promise stay Partial after the full promised sum had
// actually landed, which read as a system bug to the user.
//
// Best-effort by design: never throws into the caller. Payment recording
// is the primary operation; promise bookkeeping is a side-effect.

import { query } from "../config/database.js";
import logger from "../config/logger.js";

/**
 * Reconcile every open promise on a loan after a payment lands.
 * Returns an array of { id, prev_status, next_status, paid_since } for
 * each promise touched, mainly for logging/audit. Errors are caught
 * and logged — the caller (recordLoanPayment) shouldn't 500 just
 * because a promise update failed.
 */
export async function reconcilePromisesForLoan(loanId) {
  if (!loanId) return [];
  const touched = [];
  try {
    const open = await query(
      `SELECT id, amount, made_at, status
         FROM promises_to_pay
        WHERE loan_id = $1
          AND status IN ('pending', 'partial')`,
      [loanId],
    );
    if (open.rows.length === 0) return [];

    for (const p of open.rows) {
      const paidRes = await query(
        `SELECT COALESCE(SUM(
            amount_paid
            - COALESCE(overpayment_portion, 0)
          ), 0)::float AS paid_since
           FROM transactions
          WHERE loan_id = $1
            AND payment_status = 'completed'
            AND created_at >= $2`,
        [loanId, p.made_at],
      );
      const paidSince = parseFloat(paidRes.rows[0].paid_since || 0);
      const amount = parseFloat(p.amount);

      // Sub-cent tolerance so floating-point noise from interest splits
      // can't leave a promise stuck at 'partial' when it's effectively
      // settled (paid_since = amount − 0.001).
      let nextStatus;
      if (paidSince + 0.01 >= amount) nextStatus = "kept";
      else if (paidSince > 0) nextStatus = "partial";
      else nextStatus = "pending";

      if (nextStatus === p.status) continue;

      // Only set resolved_at when crossing into a terminal state
      // (kept). Partial keeps resolved_at NULL — it's still in flight
      // and may yet become kept on the next payment.
      const resolvedAtClause =
        nextStatus === "kept" ? "resolved_at = NOW()," : "";

      await query(
        `UPDATE promises_to_pay
            SET status      = $1,
                ${resolvedAtClause}
                updated_at  = NOW()
          WHERE id = $2`,
        [nextStatus, p.id],
      );
      touched.push({
        id: p.id,
        prev_status: p.status,
        next_status: nextStatus,
        paid_since: paidSince,
      });
    }
  } catch (err) {
    logger.error("reconcilePromisesForLoan error:", err);
    // intentionally swallowed — payment recording must not fail because
    // of a promise bookkeeping hiccup.
  }
  return touched;
}

/**
 * Close every open promise on a loan that just transitioned to
 * 'completed'. Sets status='cancelled' with a system reason so the
 * promise drops out of the Pending / Partial / Broken queues but
 * stays on record for audit in the Cancelled tab. We don't mark it
 * 'kept' — the loan may have been settled by a waiver, not by the
 * cash the borrower promised, and pretending otherwise overstates
 * the borrower's reliability score.
 *
 * Best-effort: caller doesn't fail if this throws.
 */
export async function closeOpenPromisesForCompletedLoan(loanId) {
  if (!loanId) return [];
  try {
    const r = await query(
      `UPDATE promises_to_pay
          SET status           = 'cancelled',
              cancelled_reason = 'Loan completed — promise auto-closed',
              resolved_at      = NOW(),
              updated_at       = NOW()
        WHERE loan_id = $1
          AND status IN ('pending', 'partial')
       RETURNING id`,
      [loanId],
    );
    return r.rows.map((row) => row.id);
  } catch (err) {
    logger.error("closeOpenPromisesForCompletedLoan error:", err);
    return [];
  }
}

export default { reconcilePromisesForLoan, closeOpenPromisesForCompletedLoan };
