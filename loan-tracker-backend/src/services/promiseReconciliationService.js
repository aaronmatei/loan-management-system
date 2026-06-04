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
// with created_at >= promise.made_at, net of penalty_portion and
// overpayment_portion. That matches what the borrower experiences as
// "money I sent toward this loan" rather than what the lender booked
// internally (split between principal/interest/penalty).
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
            - COALESCE(penalty_portion, 0)
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

export default { reconcilePromisesForLoan };
