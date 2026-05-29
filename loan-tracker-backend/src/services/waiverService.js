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

/**
 * Apply a waiver of `amount` to a loan. Returns the allocation snapshot
 * (suitable for storing in loan_waivers.allocation JSONB and reversing
 * later). DOES NOT update the loan's status — caller decides what to
 * do once the balance hits zero (we tag completed_via='waived').
 *
 * Throws if `amount` exceeds what's outstanding (penalty + balance).
 */
export async function applyWaiver(loanId, tenantId, amount) {
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

  const effectiveOwed = currentBalance + totalOutstandingPenalty;
  if (amount > effectiveOwed + 0.01) {
    throw new Error(
      `Waiver amount (KES ${amount.toLocaleString()}) exceeds outstanding (KES ${effectiveOwed.toLocaleString()}).`,
    );
  }

  // ── 1) Allocate to penalty first ────────────────────────────────
  const allocation = {
    penalty_total: 0,
    amount_total: 0,
    schedules: [],
  };
  let remaining = amount;
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

  // ── 2) Allocate to amount_due across pending+overdue, oldest first ─
  if (remaining > 0) {
    const owedRows = await query(
      `SELECT id, payment_number, amount_due, amount_paid, status
         FROM payment_schedules
        WHERE loan_id = $1 AND status IN ('pending', 'overdue')
        ORDER BY due_date ASC`,
      [loanId],
    );
    for (const s of owedRows.rows) {
      if (remaining <= 0) break;
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

  // ── 3b) Decompose amount_total into interest_total / principal_total
  // using the loan's contractual ratio. Stored in the allocation so
  // downstream queries (Total Fines net, Net Interest net) can read
  // explicit numbers instead of recomputing the proportional split
  // from scratch each time. Penalty was already tracked separately,
  // so it's not touched here.
  const ratioDenom = parseFloat(loan.total_amount_due) || 0;
  const interestShare =
    ratioDenom > 0 ? parseFloat(loan.total_interest || 0) / ratioDenom : 0;
  allocation.interest_total =
    Math.round(allocation.amount_total * interestShare * 100) / 100;
  allocation.principal_total =
    Math.round(
      (allocation.amount_total - allocation.interest_total) * 100,
    ) / 100;

  // ── 4) If the loan is now fully cleared, complete + tag it ──────
  const postPaidRes = await query(
    `SELECT COALESCE(SUM(
        amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
      ), 0) AS total_paid
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );
  // Schedule rows now reflect the waiver via amount_paid (since we
  // bumped amount_paid in step 2). Effective paid against total_due
  // = transactions paid + waiver amount_total applied to schedules.
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
    // Walk back: subtract penalty_paid_delta + amount_paid_delta,
    // and restore status if we'd flipped it to 'waived'.
    await query(
      `UPDATE payment_schedules
          SET penalty_paid = GREATEST(COALESCE(penalty_paid, 0) - $1, 0),
              amount_paid  = GREATEST(COALESCE(amount_paid, 0)  - $2, 0),
              status       = CASE
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

  // If the waiver had flipped the loan to completed/waived, unflip
  // it back to active. Any post-reversal payment recording will
  // re-flip it correctly if the borrower then settles.
  if (allocation.loan_completed) {
    await query(
      `UPDATE loans
          SET status = 'active', completed_via = NULL, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [loanId, tenantId],
    );
  }
}
