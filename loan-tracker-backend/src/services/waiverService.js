// Waiver allocation engine.
// One shared allocator regardless of type (penalty / interest /
// principal / mixed): penalty first → amount_due next, oldest
// installment first. Same rule the payment recorder uses, so the
// effect of a waiver on the schedule is identical to "as if the
// borrower paid this much without cash actually moving."
//
// Type is reporting metadata only — it tells future reports the
// intent (goodwill / settlement / hardship) but doesn't change the
// allocation math.

import { query } from "../config/database.js";
import { computeInstallmentPenalty } from "../utils/penalty.js";
import { recomputeCreditScoreForLoan } from "./creditScoreService.js";

/**
 * Apply a waiver of `amount` to a loan. Returns the allocation snapshot
 * (suitable for storing in loan_waivers.allocation JSONB and reversing
 * later). DOES NOT update the loan's status — caller decides what to
 * do once the balance hits zero (we tag completed_via='waived').
 *
 * Throws if `amount` exceeds what's outstanding (penalty + balance).
 */
export async function applyWaiver(loanId, tenantId, amount, type = "mixed") {
  const loanRes = await query(
    `SELECT * FROM loans WHERE id = $1 AND tenant_id = $2`,
    [loanId, tenantId],
  );
  if (loanRes.rows.length === 0) {
    throw new Error("Loan not found");
  }
  const loan = loanRes.rows[0];

  // Total paid against amount_due so far (principal + interest credit).
  const paidRes = await query(
    `SELECT COALESCE(SUM(
        amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
      ), 0) AS total_paid
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );
  const alreadyPaid = parseFloat(paidRes.rows[0].total_paid || 0);
  const totalDue = parseFloat(loan.total_amount_due);
  const currentBalance = Math.max(0, totalDue - alreadyPaid);

  // Outstanding penalty per overdue installment (oldest first).
  const overdueRes = await query(
    `SELECT id, payment_number, amount_due, amount_paid, status,
            COALESCE(penalty_paid, 0) AS penalty_paid,
            (CURRENT_DATE - due_date::date) AS days_late
       FROM payment_schedules
      WHERE loan_id = $1
        AND status IN ('overdue', 'pending')
      ORDER BY due_date ASC`,
    [loanId],
  );

  const penaltyRows = overdueRes.rows
    .filter((s) => {
      const isOverdue =
        s.status === "overdue" ||
        (s.status === "pending" && parseInt(s.days_late, 10) > 0);
      return (
        isOverdue && parseFloat(s.amount_due) > parseFloat(s.amount_paid || 0)
      );
    })
    .map((s) => {
      const bal =
        parseFloat(s.amount_due) - parseFloat(s.amount_paid || 0);
      const p = computeInstallmentPenalty({
        balance: bal,
        daysLate: parseInt(s.days_late, 10) || 0,
        lateFee: loan.late_payment_fee,
        penaltyRate: loan.penalty_rate,
      });
      return {
        schedule_id: s.id,
        outstanding: Math.max(
          0,
          Math.round((p.penalty_total - parseFloat(s.penalty_paid)) * 100) /
            100,
        ),
      };
    });
  const totalOutstandingPenalty = penaltyRows.reduce(
    (acc, r) => acc + r.outstanding,
    0,
  );

  // Per-type cap. The admin's declared type narrows what the waiver
  // can touch — penalty-only can't fall through onto amount_due,
  // interest/principal can't fall through onto penalty, mixed is the
  // full effective owed (current behaviour).
  const effectiveOwed = currentBalance + totalOutstandingPenalty;
  const typeCap =
    type === "penalty"
      ? totalOutstandingPenalty
      : type === "interest" || type === "principal"
        ? currentBalance
        : effectiveOwed;
  if (amount > typeCap + 0.01) {
    const label =
      type === "penalty"
        ? "outstanding penalty"
        : type === "interest" || type === "principal"
          ? "outstanding loan balance"
          : "outstanding";
    throw new Error(
      `Waiver amount (KES ${amount.toLocaleString()}) exceeds ${label} (KES ${typeCap.toLocaleString()}).`,
    );
  }

  // ── 1) Allocate to penalty first (only when the admin opted in:
  //       penalty-type or mixed-type waiver).
  const allocation = {
    type,
    penalty_total: 0,
    amount_total: 0,
    interest_total: 0,
    principal_total: 0,
    schedules: [],
  };
  let remaining = amount;
  if (type === "penalty" || type === "mixed") {
    for (const row of penaltyRows) {
      if (remaining <= 0) break;
      const apply = Math.min(remaining, row.outstanding);
      if (apply > 0) {
        await query(
          `UPDATE payment_schedules
              SET penalty_paid = COALESCE(penalty_paid, 0) + $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [apply, row.schedule_id],
        );
        allocation.penalty_total += apply;
        allocation.schedules.push({
          schedule_id: row.schedule_id,
          penalty_paid_delta: apply,
          amount_paid_delta: 0,
          set_status_waived: false,
        });
        remaining -= apply;
      }
    }
  }

  // ── 2) Allocate to amount_due across pending+overdue, oldest first
  //       (skipped for penalty-only — it shouldn't touch amount_due).
  //
  // Interest-type waivers are special: they fill the per-installment
  // INTEREST bucket only, not the combined amount_paid. So waiving
  // 2k of interest on a 5k/6k loan with 500 interest per installment
  // fills interest_paid on the first four rows (500 × 4 = 2,000) and
  // leaves their principal portion (416.67 each) still owed in
  // amount_due. Without this split, the schedule used to show rows
  // 1–2 as 'waived' status because amount_paid had been bumped past
  // amount_due, which the admin reads as "you waived the principal
  // too." Penalty waivers were already in this shape (penalty_paid
  // only, never touching amount_paid).
  //
  // Principal-type and mixed-type waivers still bump amount_paid
  // (they're explicitly forgiving principal or a proportional blend).
  // Only type='interest' uses the new interest-bucket path.
  if (remaining > 0 && type !== "penalty") {
    const owedRows = await query(
      `SELECT id, payment_number, amount_due, amount_paid, status,
              COALESCE(interest_paid, 0)    AS interest_paid,
              COALESCE(interest_portion, 0) AS interest_portion
         FROM payment_schedules
        WHERE loan_id = $1 AND status IN ('pending', 'overdue')
        ORDER BY due_date ASC`,
      [loanId],
    );
    for (const s of owedRows.rows) {
      if (remaining <= 0) break;

      if (type === "interest") {
        // Cap by the row's own interest_portion (NOT a flat
        // total_interest/duration average). On reducing-balance
        // loans, later rows carry less interest than earlier rows —
        // a flat per-row cap over-bumps interest_paid past the
        // row's true interest portion. When cash then arrives,
        // interestRoom is already 0 and the cash gets booked as
        // 100% principal, but the row is marked "paid" with less
        // cash than the row's principal_portion required — silently
        // forgiving the gap. Capping at interest_portion makes the
        // waiver respect the contractual interest share per row,
        // and any leftover spills correctly to the next row.
        const interestSoFar = parseFloat(s.interest_paid || 0);
        const rowInterest = parseFloat(s.interest_portion || 0);
        const interestCapacity = Math.max(0, rowInterest - interestSoFar);
        if (interestCapacity <= 0) continue;
        const apply = Math.min(remaining, interestCapacity);
        const newInterestPaid = interestSoFar + apply;

        // Status flips to 'waived' only when the COMBINED balance
        // (amount_due − amount_paid − interest_paid) hits zero — for
        // an interest waiver alone that won't happen because
        // principal is still owed, which is exactly the user's intent.
        const due = parseFloat(s.amount_due);
        const cashPaid = parseFloat(s.amount_paid || 0);
        const remainingBalance = due - cashPaid - newInterestPaid;
        const fullyCleared = remainingBalance <= 0.001;

        await query(
          `UPDATE payment_schedules
              SET interest_paid = $1,
                  status        = CASE WHEN $2 THEN 'waived'::varchar ELSE status END,
                  actual_payment_date = CASE WHEN $2 THEN CURRENT_DATE ELSE actual_payment_date END,
                  updated_at    = NOW()
            WHERE id = $3`,
          [newInterestPaid, fullyCleared, s.id],
        );

        allocation.amount_total += apply;
        const existing = allocation.schedules.find(
          (a) => a.schedule_id === s.id,
        );
        if (existing) {
          existing.interest_paid_delta =
            (existing.interest_paid_delta || 0) + apply;
          existing.set_status_waived = fullyCleared;
        } else {
          allocation.schedules.push({
            schedule_id: s.id,
            penalty_paid_delta: 0,
            amount_paid_delta: 0,
            interest_paid_delta: apply,
            set_status_waived: fullyCleared,
          });
        }
        remaining -= apply;
        continue;
      }

      // Non-interest path (principal / mixed) — still bumps
      // amount_paid as before.
      const due = parseFloat(s.amount_due);
      const paid = parseFloat(s.amount_paid || 0);
      const stillOwed = due - paid;
      if (stillOwed <= 0) continue;

      const apply = Math.min(remaining, stillOwed);
      const newPaid = paid + apply;
      const fullyCleared = newPaid + 0.001 >= due;

      await query(
        `UPDATE payment_schedules
            SET amount_paid = $1,
                status      = CASE WHEN $2 THEN 'waived'::varchar ELSE status END,
                actual_payment_date = CASE WHEN $2 THEN CURRENT_DATE ELSE actual_payment_date END,
                updated_at  = NOW()
          WHERE id = $3`,
        [newPaid, fullyCleared, s.id],
      );

      allocation.amount_total += apply;
      const existing = allocation.schedules.find(
        (a) => a.schedule_id === s.id,
      );
      if (existing) {
        existing.amount_paid_delta += apply;
        existing.set_status_waived = fullyCleared;
      } else {
        allocation.schedules.push({
          schedule_id: s.id,
          penalty_paid_delta: 0,
          amount_paid_delta: apply,
          set_status_waived: fullyCleared,
        });
      }
      remaining -= apply;
    }
  }

  // ── 3) Bump the tenant's total_waived counter ───────────────────
  await query(
    `UPDATE capital_pool
        SET total_waived = total_waived + $1, updated_at = NOW()
      WHERE tenant_id = $2`,
    [amount, tenantId],
  );

  // ── 3b) Bookkeeping — interest_total / principal_total reflect
  // the admin's declared type. Penalty waivers wrote to
  // penalty_total in step 1. Pure-interest or pure-principal waivers
  // get the entire amount_total assigned to the matching bucket
  // without proration. Only mixed waivers fall back to the
  // contractual interest÷total ratio so we still have a defensible
  // split for legacy / unstated cases.
  const round2 = (n) => Math.round(n * 100) / 100;
  if (type === "interest") {
    allocation.interest_total = round2(allocation.amount_total);
    allocation.principal_total = 0;
  } else if (type === "principal") {
    allocation.principal_total = round2(allocation.amount_total);
    allocation.interest_total = 0;
  } else if (type === "penalty") {
    allocation.interest_total = 0;
    allocation.principal_total = 0;
  } else {
    // mixed — proportional split using the loan's contractual ratio
    const ratioDenom = parseFloat(loan.total_amount_due) || 0;
    const interestShare =
      ratioDenom > 0 ? parseFloat(loan.total_interest || 0) / ratioDenom : 0;
    allocation.interest_total = round2(
      allocation.amount_total * interestShare,
    );
    allocation.principal_total = round2(
      allocation.amount_total - allocation.interest_total,
    );
  }

  // ── 4) If the loan is now fully cleared, complete + tag it ──────
  const postPaidRes = await query(
    `SELECT COALESCE(SUM(
        amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
      ), 0) AS total_paid
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );
  // allocation.amount_total is the cumulative amount_due reduced by
  // this waiver — bumped per-row in step 2 regardless of whether the
  // dollars landed on schedule.amount_paid (principal/mixed waivers)
  // or schedule.interest_paid (interest waivers). So this rolls up
  // to "loan settlement progress" the same way for both.
  const effectivePaid =
    parseFloat(postPaidRes.rows[0].total_paid || 0) + allocation.amount_total;
  if (effectivePaid + 0.001 >= totalDue) {
    await query(
      `UPDATE loans
          SET status = 'completed', completed_via = 'waived', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [loanId, tenantId],
    );
    allocation.loan_completed = true;
  }

  // Recompute the client's cached credit score — a completed loan
  // (which the waiver may have just triggered) is a positive signal.
  // Best-effort; never blocks the caller.
  await recomputeCreditScoreForLoan(loanId);

  return allocation;
}

/**
 * Reverse a previously-applied waiver. Reads the allocation snapshot
 * and unwinds each delta. Restores schedule statuses to their pre-
 * waiver values where the waiver had flipped them to 'waived'.
 */
export async function reverseWaiver(loanId, tenantId, allocation) {
  if (!allocation || !Array.isArray(allocation.schedules)) return;

  for (const a of allocation.schedules) {
    // Walk back: subtract penalty_paid_delta + amount_paid_delta +
    // interest_paid_delta, and restore status if we'd flipped it to
    // 'waived'. interest_paid_delta is the new bucket for type=
    // 'interest' waivers — older waiver allocations don't carry the
    // field so the `|| 0` keeps reversals of pre-feature waivers
    // running unchanged.
    await query(
      `UPDATE payment_schedules
          SET penalty_paid  = GREATEST(COALESCE(penalty_paid, 0)  - $1, 0),
              amount_paid   = GREATEST(COALESCE(amount_paid, 0)   - $2, 0),
              interest_paid = GREATEST(COALESCE(interest_paid, 0) - $5, 0),
              status        = CASE
                                WHEN $3 AND status = 'waived'
                                THEN CASE
                                  WHEN due_date < CURRENT_DATE THEN 'overdue'
                                  ELSE 'pending'
                                END
                                ELSE status
                              END,
              actual_payment_date = CASE WHEN $3 AND status = 'waived' THEN NULL ELSE actual_payment_date END,
              updated_at = NOW()
        WHERE id = $4`,
      [
        a.penalty_paid_delta || 0,
        a.amount_paid_delta || 0,
        Boolean(a.set_status_waived),
        a.schedule_id,
        a.interest_paid_delta || 0,
      ],
    );
  }

  const total =
    parseFloat(allocation.penalty_total || 0) +
    parseFloat(allocation.amount_total || 0);
  await query(
    `UPDATE capital_pool
        SET total_waived = GREATEST(total_waived - $1, 0), updated_at = NOW()
      WHERE tenant_id = $2`,
    [total, tenantId],
  );

  // After the unwind, re-derive the loan's settlement state and
  // sync the loan + schedule rows so they reflect reality.
  //
  // The old logic only flipped the loan back to 'active' when the
  // reversed waiver had itself completed the loan (allocation.
  // loan_completed=true). That misses the common case where the
  // loan was completed by a CASH payment after the waiver had been
  // applied — reversing the waiver then leaves the loan stuck on
  // 'completed' with a positive balance owed. We now check
  // settlement directly instead of trusting the historical flag.
  await syncLoanStateAfterUnwind(loanId, tenantId);

  // Reversal can flip a 'completed' loan back to 'active' and
  // demote 'paid' schedules to 'overdue' — recompute the client's
  // cached credit score so the dashboard reflects the new reality.
  await recomputeCreditScoreForLoan(loanId);
}

/**
 * Re-derive the loan + schedule state after a waiver reversal
 * (or any other operation that may shrink the effective paid amount).
 *
 *  • If the loan is currently 'completed' but cash + remaining
 *    approved waivers no longer cover total_amount_due, flip the
 *    loan back to 'active' and clear completed_via.
 *  • Walk each schedule: if its paid bucket (amount_paid +
 *    interest_paid) no longer meets amount_due, demote 'paid' to
 *    'overdue' (due_date in the past) or 'pending' (due_date today
 *    or future) so the overdue queue, schedule UI, and balance
 *    breakdowns line up with the loan-level truth.
 */
async function syncLoanStateAfterUnwind(loanId, tenantId) {
  const r = await query(
    `SELECT
       l.total_amount_due,
       l.status,
       (SELECT COALESCE(SUM(
                 amount_paid - COALESCE(penalty_portion, 0)
                             - COALESCE(overpayment_portion, 0)
              ), 0)
          FROM transactions
         WHERE loan_id = $1 AND payment_status = 'completed') AS cash_net,
       (SELECT COALESCE(SUM((allocation->>'amount_total')::numeric), 0)
          FROM loan_waivers
         WHERE loan_id = $1 AND status = 'approved') AS waiver_net
       FROM loans l WHERE l.id = $1`,
    [loanId],
  );
  if (!r.rows[0]) return;
  const totalDue = parseFloat(r.rows[0].total_amount_due) || 0;
  const effectivePaid =
    parseFloat(r.rows[0].cash_net) + parseFloat(r.rows[0].waiver_net);
  const stillSettled = effectivePaid + 0.001 >= totalDue;

  if (r.rows[0].status === "completed" && !stillSettled) {
    await query(
      `UPDATE loans
          SET status = 'active', completed_via = NULL, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [loanId, tenantId],
    );
  }

  // Schedule-level recompute. Any schedule still marked 'paid' whose
  // cash+interest_paid no longer meets amount_due gets demoted; mirror
  // logic the waived-flip path uses (overdue if due_date < today, else
  // pending). 'waived' rows are left alone — the waiver-status walk
  // above already handles them.
  await query(
    `UPDATE payment_schedules
        SET status = CASE
                       WHEN due_date < CURRENT_DATE THEN 'overdue'
                       ELSE 'pending'
                     END,
            updated_at = NOW()
      WHERE loan_id = $1
        AND status = 'paid'
        AND COALESCE(amount_paid, 0) + COALESCE(interest_paid, 0)
            + 0.001 < amount_due`,
    [loanId],
  );
}
