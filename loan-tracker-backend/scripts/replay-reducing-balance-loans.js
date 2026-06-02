// One-shot retroactive replay: walk every existing reducing-balance
// loan's payment history through the NEW engine semantics (prepayment
// reduces principal, schedule re-amortizes). Writes the resulting
// schedule + loan totals to the DB.
//
// Skipped for flat-rate loans — they have no prepayment-saves-
// interest semantic to retroactively apply.
//
// Idempotent: re-runs produce the same final state for the same
// transaction history. Audit row logged.
//
// Notes on the replay model:
//   • Transactions are walked in (payment_date, id) order — the same
//     order they would have arrived under the new engine.
//   • Each tx's existing overpayment_portion is OVERWRITTEN to reflect
//     what the new engine would have allocated.
//   • If the loan auto-completes mid-history (because the lump-sum
//     payment already cleared the now-shrunk total), subsequent
//     transactions become pure overpayment (refund) — their
//     overpayment_portion grows to match.
//   • Schedule rows are completely reset before the replay starts.
//   • Loan headline totals (total_amount_due, total_interest,
//     overpayment_amount, refund_status) end up consistent with the
//     replayed schedule + transactions.

import "dotenv/config";
import pool, { query } from "../src/config/database.js";
import { computeLoanTotals } from "../src/utils/loanMath.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Mirrors the helper in paymentService.js — re-amortize unpaid rows
// off the actual current principal balance, sync loan totals.
async function recomputeReducingBalanceSchedule(loanId) {
  const loanRes = await query(`SELECT * FROM loans WHERE id = $1`, [loanId]);
  const loan = loanRes.rows[0];
  if (!loan) return;

  const monthlyRate = parseFloat(loan.interest_rate) / 100;
  const originalPrincipal = parseFloat(loan.principal_amount);
  const n = parseInt(loan.loan_duration_months, 10);
  const r = monthlyRate;
  const plannedEMI =
    r > 0
      ? round2(
          (originalPrincipal * r * Math.pow(1 + r, n)) /
            (Math.pow(1 + r, n) - 1),
        )
      : round2(originalPrincipal / n);

  const schedRes = await query(
    `SELECT * FROM payment_schedules
      WHERE loan_id = $1 ORDER BY payment_number ASC`,
    [loanId],
  );
  const rows = schedRes.rows;
  if (rows.length === 0) return;

  let balance = originalPrincipal;
  let firstUnpaidIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].status === "paid" || rows[i].status === "waived") {
      const consumed = parseFloat(rows[i].principal_portion || 0);
      balance = round2(balance - consumed);
      if (balance < 0) balance = 0;
      await query(
        `UPDATE payment_schedules SET balance_after = $1, updated_at = NOW() WHERE id = $2`,
        [balance, rows[i].id],
      );
    } else {
      firstUnpaidIdx = i;
      break;
    }
  }

  if (firstUnpaidIdx !== -1) {
    for (let i = firstUnpaidIdx; i < rows.length; i++) {
      const row = rows[i];
      if (balance <= 0.005) {
        await query(
          `UPDATE payment_schedules SET
             amount_due = 0, interest_portion = 0, principal_portion = 0,
             balance_after = 0, status = 'paid', amount_paid = 0,
             actual_payment_date = COALESCE(actual_payment_date, CURRENT_DATE),
             updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        );
        continue;
      }
      const interest = round2(balance * monthlyRate);
      let principal = round2(plannedEMI - interest);
      let amountDue = plannedEMI;
      let balanceAfter;
      if (principal >= balance) {
        principal = balance;
        amountDue = round2(interest + principal);
        balanceAfter = 0;
      } else {
        balanceAfter = round2(balance - principal);
      }
      await query(
        `UPDATE payment_schedules SET
           amount_due = $1, interest_portion = $2,
           principal_portion = $3, balance_after = $4,
           updated_at = NOW()
         WHERE id = $5`,
        [amountDue, interest, principal, balanceAfter, row.id],
      );
      balance = balanceAfter;
    }
  }

  await query(
    `UPDATE loans l SET
       total_amount_due = COALESCE(t.total_due, l.total_amount_due),
       total_interest   = COALESCE(t.total_int, l.total_interest),
       updated_at = NOW()
      FROM (
        SELECT SUM(amount_due) AS total_due,
               SUM(interest_portion) AS total_int
          FROM payment_schedules WHERE loan_id = $1
      ) t
      WHERE l.id = $1`,
    [loanId],
  );
}

async function replayLoan(loan) {
  console.log(
    `\n── Loan ${loan.loan_code} (${loan.principal_amount} principal, ${loan.interest_rate}%/mo × ${loan.loan_duration_months}mo)`,
  );

  // 1. Get original disburse totals for a clean reset
  const originalTotals = computeLoanTotals({
    principal: parseFloat(loan.principal_amount),
    annualRatePct: parseFloat(loan.interest_rate) * 12,
    months: loan.loan_duration_months,
    method: "reducing",
  });

  // 2. Read transactions in chronological order
  const txs = (
    await query(
      `SELECT * FROM transactions
        WHERE loan_id = $1 AND payment_status = 'completed'
        ORDER BY payment_date ASC, id ASC`,
      [loan.id],
    )
  ).rows;
  console.log(`   ${txs.length} transactions to replay`);

  // 3. Delete existing schedule + regenerate from disburse snapshot
  await query(`DELETE FROM payment_schedules WHERE loan_id = $1`, [loan.id]);
  const startDate = new Date(loan.start_date || loan.disbursed_at);
  for (let i = 1; i <= loan.loan_duration_months; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const row = originalTotals.schedule[i - 1];
    await query(
      `INSERT INTO payment_schedules (
         tenant_id, loan_id, payment_number, due_date,
         amount_due, interest_portion, principal_portion, balance_after,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
      [
        loan.tenant_id,
        loan.id,
        i,
        dueDate.toISOString().split("T")[0],
        row.amountDue.toFixed(2),
        row.interestPortion.toFixed(2),
        row.principalPortion.toFixed(2),
        row.balanceAfter.toFixed(2),
      ],
    );
  }

  // 4. Reset loan headline state
  await query(
    `UPDATE loans SET
       total_amount_due = $1,
       total_interest = $2,
       status = 'active',
       overpayment_amount = 0,
       refund_status = NULL,
       completed_via = NULL,
       updated_at = NOW()
     WHERE id = $3`,
    [originalTotals.totalAmountDue, originalTotals.totalInterest, loan.id],
  );

  // 5. Walk transactions in order, applying new-engine logic
  let totalOverpayment = 0;
  let loanCompleted = false;
  let completionDate = null;

  for (const tx of txs) {
    const cur = (
      await query(`SELECT * FROM loans WHERE id = $1`, [loan.id])
    ).rows[0];
    const curTotalDue = parseFloat(cur.total_amount_due);

    // Sum cash already credited to amount_due, net of penalty/overpayment.
    const paidRes = await query(
      `SELECT COALESCE(SUM(amount_paid
                       - COALESCE(penalty_portion, 0)
                       - COALESCE(overpayment_portion, 0)), 0)
                AS cash_to_amount_due
         FROM transactions
        WHERE loan_id = $1 AND payment_status = 'completed' AND id < $2`,
      [loan.id, tx.id],
    );
    const alreadyPaid = parseFloat(paidRes.rows[0].cash_to_amount_due);
    const currentBalance = Math.max(0, curTotalDue - alreadyPaid);

    const paymentAmount = parseFloat(tx.amount_paid);
    let txOverpayment = 0;
    let actualApplied = paymentAmount;

    if (loanCompleted) {
      // Loan was already paid off in an earlier replayed tx — this
      // whole payment is overpayment.
      txOverpayment = paymentAmount;
      actualApplied = 0;
    } else {
      const raw = round2(paymentAmount - currentBalance);
      if (raw >= 1) {
        txOverpayment = raw;
        actualApplied = paymentAmount - txOverpayment;
      }
    }

    totalOverpayment += txOverpayment;

    // Update the transaction's overpayment_portion to reflect the new
    // model. amount_paid stays as the gross cash received.
    await query(
      `UPDATE transactions SET
         overpayment_portion = $1, updated_at = NOW()
       WHERE id = $2`,
      [txOverpayment, tx.id],
    );

    if (!loanCompleted && actualApplied > 0) {
      // Apply to first pending row only. Excess past row.amount_due
      // bumps principal_portion + amount_paid for that row.
      const firstPending = (
        await query(
          `SELECT * FROM payment_schedules
            WHERE loan_id = $1 AND status IN ('pending', 'overdue')
            ORDER BY payment_number ASC LIMIT 1`,
          [loan.id],
        )
      ).rows[0];

      if (firstPending) {
        const amountDue = parseFloat(firstPending.amount_due);
        const alreadyPaidOnRow = parseFloat(firstPending.amount_paid || 0);
        const scheduledPrincipal = parseFloat(firstPending.principal_portion || 0);
        const stillOwed = Math.max(0, amountDue - alreadyPaidOnRow);

        if (actualApplied >= stillOwed) {
          const excess = round2(actualApplied - stillOwed);
          await query(
            `UPDATE payment_schedules SET
               amount_paid = $1,
               principal_portion = $2,
               status = 'paid',
               actual_payment_date = $3,
               updated_at = NOW()
             WHERE id = $4`,
            [
              round2(alreadyPaidOnRow + stillOwed + excess),
              round2(scheduledPrincipal + excess),
              tx.payment_date,
              firstPending.id,
            ],
          );
        } else {
          await query(
            `UPDATE payment_schedules SET
               amount_paid = $1, updated_at = NOW()
             WHERE id = $2`,
            [round2(alreadyPaidOnRow + actualApplied), firstPending.id],
          );
        }
      }

      // Re-amortize remaining rows + sync loan totals
      await recomputeReducingBalanceSchedule(loan.id);

      // Post-recompute surplus credit (see paymentService.js for the
      // same logic). When prepayment shrinks total_amount_due below
      // the cash already in, credit the surplus to this tx's
      // overpayment_portion so the loan-level overpayment_amount
      // adds up.
      const surplusRes = await query(
        `SELECT
           (SELECT COALESCE(SUM(amount_paid
                              - COALESCE(penalty_portion, 0)
                              - COALESCE(overpayment_portion, 0)), 0)
              FROM transactions
             WHERE loan_id = $1 AND payment_status = 'completed') AS cash_to_due,
           (SELECT total_amount_due FROM loans WHERE id = $1) AS total_due`,
        [loan.id],
      );
      const cashToDue = parseFloat(surplusRes.rows[0].cash_to_due);
      const newTotalDue = parseFloat(surplusRes.rows[0].total_due);
      const additionalSurplus = round2(cashToDue - newTotalDue);
      if (additionalSurplus >= 0.01) {
        await query(
          `UPDATE transactions SET
             overpayment_portion = COALESCE(overpayment_portion, 0) + $1,
             updated_at = NOW()
           WHERE id = $2`,
          [additionalSurplus, tx.id],
        );
        totalOverpayment += additionalSurplus;
      }
    }

    // Check completion against the FRESH total
    const post = (
      await query(
        `SELECT
           l.total_amount_due,
           (SELECT COALESCE(SUM(amount_paid
                              - COALESCE(penalty_portion, 0)
                              - COALESCE(overpayment_portion, 0)), 0)
              FROM transactions
             WHERE loan_id = $1 AND payment_status = 'completed') AS cash_paid
         FROM loans l WHERE l.id = $1`,
        [loan.id],
      )
    ).rows[0];

    if (
      !loanCompleted &&
      parseFloat(post.cash_paid) >= parseFloat(post.total_amount_due) - 0.005
    ) {
      loanCompleted = true;
      completionDate = tx.payment_date;
      await query(
        `UPDATE loans SET
           status = 'completed',
           completed_via = 'paid',
           updated_at = NOW()
         WHERE id = $1`,
        [loan.id],
      );
      // Mark any remaining unpaid rows as paid (amount_paid = amount_due,
      // which is now 0 for zero'd rows)
      await query(
        `UPDATE payment_schedules SET
           status = 'paid',
           amount_paid = amount_due,
           actual_payment_date = COALESCE(actual_payment_date, $2),
           updated_at = NOW()
         WHERE loan_id = $1 AND status IN ('pending', 'overdue')`,
        [loan.id, tx.payment_date],
      );
    }
  }

  // 6. Set final overpayment + refund status
  await query(
    `UPDATE loans SET
       overpayment_amount = $1::numeric,
       refund_status = CASE WHEN $1::numeric > 0 THEN 'pending' ELSE NULL END,
       updated_at = NOW()
     WHERE id = $2`,
    [round2(totalOverpayment), loan.id],
  );

  const finalLoan = (
    await query(`SELECT * FROM loans WHERE id = $1`, [loan.id])
  ).rows[0];

  console.log(
    `   → total_amount_due: ${parseFloat(finalLoan.total_amount_due).toFixed(2)} (was ${originalTotals.totalAmountDue.toFixed(2)})`,
  );
  console.log(
    `   → total_interest:   ${parseFloat(finalLoan.total_interest).toFixed(2)} (was ${originalTotals.totalInterest.toFixed(2)})`,
  );
  console.log(
    `   → overpayment:      ${parseFloat(finalLoan.overpayment_amount).toFixed(2)} (refund_status=${finalLoan.refund_status})`,
  );
  console.log(`   → status:           ${finalLoan.status}`);
  if (completionDate) {
    console.log(`   → completed on:     ${completionDate}`);
  }
}

(async () => {
  const t0 = Date.now();
  const loans = await query(
    `SELECT * FROM loans
      WHERE interest_method = 'reducing'
        AND status IN ('active', 'completed')
      ORDER BY id`,
  );
  console.log(`Replaying ${loans.rows.length} reducing-balance loan(s)…`);

  for (const loan of loans.rows) {
    await replayLoan(loan);
  }

  await query(
    `INSERT INTO audit_logs (
       tenant_id, user_id, action, action_category, table_name, entity_type,
       description, severity, status, created_at
     ) VALUES (
       NULL, NULL, 'reducing_balance_engine_retroactive_replay', 'system',
       'loans', 'loans',
       $1, 'info', 'success', NOW()
     )`,
    [
      `Retroactively replayed ${loans.rows.length} reducing-balance loan(s) through the new prepay-knocks-down-principal engine.`,
    ],
  );

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  await pool.end();
})().catch(async (err) => {
  console.error("Replay failed:", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
