// Shared loan-payment recording.
//
// This is the EXACT logic that used to live inline in
// routes/payments.js POST "/". It was extracted verbatim so two call
// sites can share it without duplicating balance math:
//   1. routes/payments.js  — staff records a manual payment (actor = req.user)
//   2. routes/mpesa.js      — Safaricom STK callback confirms a payment
//                             (actor = the customer/staff who initiated, or
//                              a system actor; auditReq is null)
//
// Behaviour is preserved byte-for-byte: transaction code generation,
// overpayment handling, payment_schedules allocation, loan
// completion/refund status, capital_pool + capital_transactions, the
// SMS/email confirmation hooks (still gated by the same env flags), the
// audit log, and the in-app notifications. The only change is that
// req-bound values are now parameters.
//
// NOTE: buildReceiptBlock previously SELECTed l.amount_paid — a column
// that does not exist on `loans` — so the query threw and the function
// silently returned null on every call (the receipt block was always
// null). Fixed here to derive total_paid from completed transactions,
// the same SUM used everywhere else.

import { query } from "../config/database.js";
import { tenantPrefix } from "../utils/clientCode.js";
import notificationDispatcher from "./notificationDispatcher.js";
import { buildReceiptPdf } from "../utils/pdfDocuments.js";
import { logAudit } from "./auditService.js";
import { computeInstallmentPenalty } from "../utils/penalty.js";
import {
  notifyLargePayment,
  notifyLoanCompleted,
  notifyRefundPending,
} from "./notificationService.js";
import logger from "../config/logger.js";
import { recomputeCreditScore } from "./creditScoreService.js";

// Typed error so the route can map to the right HTTP status while the
// M-Pesa caller can just catch and log.
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Reducing-balance re-amortization helper.
 *
 * Mary's prepayment example illustrates the model: she pays 20k on a
 * 50k loan with 11,263.25 monthly EMI. The 11,263.25 settles row 1
 * (interest 10,000 + scheduled principal 1,263.25). The remaining
 * 8,736.75 reduces the principal balance DIRECTLY — not by partially
 * filling row 2's amount_paid, but by knocking the actual outstanding
 * principal from 48,736.75 down to 40,000. The schedule's remaining
 * unpaid rows then re-amortize from that new balance: row 2's
 * interest becomes 8,000 (= 40,000 × 20%) instead of the originally-
 * scheduled 9,747.35, and the curve continues from there. If the
 * borrower keeps paying the original EMI, the loan closes early; the
 * tail rows reach amount_due = 0 when the balance hits zero.
 *
 * Flat-rate loans don't get this — for flat the interest is locked
 * at disbursement (principal × rate × years) and isn't accrued on a
 * balance, so prepayment doesn't save interest. The caller decides
 * whether to invoke this based on loan.interest_method.
 *
 * Updates: every unpaid schedule row's interest_portion /
 * principal_portion / balance_after / amount_due, and the loan's
 * total_amount_due + total_interest. Best-effort: errors are logged
 * but never re-thrown (this runs AFTER the user-facing payment
 * acknowledgment, never block the response).
 */
async function recomputeReducingBalanceSchedule(loanId) {
  try {
    const loanRes = await query(`SELECT * FROM loans WHERE id = $1`, [loanId]);
    const loan = loanRes.rows[0];
    if (!loan || loan.interest_method !== "reducing") return;

    const monthlyRate = parseFloat(loan.interest_rate) / 100;
    const originalPrincipal = parseFloat(loan.principal_amount);

    // Original EMI for the loan — the contractual per-installment ask
    // that the borrower agreed to on disburse. We hold this constant
    // through the loan's life; early payments knock down principal
    // but don't shrink the regular EMI ask.
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
        WHERE loan_id = $1
        ORDER BY payment_number ASC`,
      [loanId],
    );
    const rows = schedRes.rows;
    if (rows.length === 0) return;

    // Walk paid/waived rows to derive the current actual principal
    // balance. principal_portion on those rows is the *actual* amount
    // of principal consumed (may include excess principal payments
    // bumped in by the cascade-stop logic below). We also rewrite
    // balance_after on each paid row to reflect the post-prepayment
    // running balance — without this, a paid row that received excess
    // principal would still display the stale snapshot balance.
    let balance = originalPrincipal;
    let firstUnpaidIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status === "paid" || row.status === "waived") {
        const consumed = parseFloat(row.principal_portion || 0);
        balance = round2(balance - consumed);
        if (balance < 0) balance = 0;
        await query(
          `UPDATE payment_schedules SET balance_after = $1, updated_at = NOW() WHERE id = $2`,
          [balance, row.id],
        );
      } else {
        firstUnpaidIdx = i;
        break;
      }
    }

    // Recompute every unpaid row from this point forward.
    if (firstUnpaidIdx !== -1) {
      for (let i = firstUnpaidIdx; i < rows.length; i++) {
        const row = rows[i];
        if (balance <= 0.005) {
          // Loan principal paid off — zero out remaining rows.
          await query(
            `UPDATE payment_schedules SET
               amount_due = 0,
               interest_portion = 0,
               principal_portion = 0,
               balance_after = 0,
               status = 'paid',
               amount_paid = 0,
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
          // Final row that pays the loan off — amount_due shrinks to
          // exactly interest + remaining principal.
          principal = balance;
          amountDue = round2(interest + principal);
          balanceAfter = 0;
        } else {
          balanceAfter = round2(balance - principal);
        }

        await query(
          `UPDATE payment_schedules SET
             amount_due = $1,
             interest_portion = $2,
             principal_portion = $3,
             balance_after = $4,
             updated_at = NOW()
           WHERE id = $5`,
          [amountDue, interest, principal, balanceAfter, row.id],
        );

        balance = balanceAfter;
      }
    }

    // Sync the loan's headline totals to the recomputed schedule so
    // total_amount_due / total_interest reflect actual (reducing)
    // interest, not the original snapshot.
    await query(
      `UPDATE loans l SET
         total_amount_due = COALESCE(t.total_due, l.total_amount_due),
         total_interest   = COALESCE(t.total_int, l.total_interest),
         updated_at       = NOW()
        FROM (
          SELECT SUM(amount_due)       AS total_due,
                 SUM(interest_portion) AS total_int
            FROM payment_schedules WHERE loan_id = $1
        ) t
        WHERE l.id = $1`,
      [loanId],
    );
  } catch (err) {
    logger.error(
      `recomputeReducingBalanceSchedule failed for loan ${loanId}:`,
      err.message,
    );
  }
}

/**
 * Record a completed loan payment.
 *
 * @param {object}  p
 * @param {number}  p.loanId
 * @param {number}  p.amountPaid
 * @param {string}  p.paymentDate        'YYYY-MM-DD'
 * @param {string}  p.paymentMethod      'mpesa' | 'cash' | 'bank' | ...
 * @param {string} [p.paymentReference]
 * @param {string} [p.notes]
 * @param {object} [p.actor]             { id, email, role } — staff user, or
 *                                       {} / { id:null } for a system action
 * @param {number} [p.tenantId]          when set, enforce loan.tenant_id === tenantId
 * @param {object} [p.auditReq]          Express req for audit IP/UA (optional)
 * @returns {Promise<{message:string,data:object}>}
 */
export async function recordLoanPayment({
  loanId,
  amountPaid,
  paymentDate,
  paymentMethod,
  paymentReference,
  notes,
  actor = {},
  tenantId = null,
  auditReq = null,
}) {
  if (!loanId || !amountPaid || !paymentDate || !paymentMethod) {
    throw httpError(
      400,
      "Loan, amount, date, and payment method are required",
    );
  }
  const actorUserId = actor?.id ?? null;

  // Get loan details. When tenantId is provided, hard-AND it so a
  // caller can only touch their own loan (mirrors the previous
  // tenantClause behaviour; platform-admin/system pass null = no scope).
  const loanResult = await query(
    `SELECT * FROM loans WHERE id = $1 AND ($2::int IS NULL OR tenant_id = $2)`,
    [loanId, tenantId],
  );
  if (loanResult.rows.length === 0) {
    throw httpError(404, "Loan not found");
  }
  const loan = loanResult.rows[0];

  if (loan.status === "completed") {
    throw httpError(
      400,
      "This loan is already fully paid. Cannot record more payments.",
    );
  }
  if (loan.status !== "active") {
    throw httpError(400, `Cannot record payment on ${loan.status} loan`);
  }

  // "Already paid against amount_due" needs BOTH halves: the cash
  // legs of prior transactions (net of penalty + overpayment, which
  // don't reduce amount_due), AND the approved waivers' amount_total
  // (forgiven principal+interest, also reduces amount_due).
  //
  // Skipping waivers here was making the overpayment check wrong:
  // for a loan with 11k contract and 2k waiver, the recorder saw
  // currentBalance = 11k − 0 cash = 11k, decided a 9.6k payment was
  // UNDER-paying, and wrote overpayment_portion = 0. The borrower
  // had genuinely overpaid by 77.50 against the post-waiver book
  // and the refund queue silently lost them.
  const paidResult = await query(
    `SELECT
        COALESCE(SUM(
          amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
        ), 0) AS cash_to_amount_due,
        (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
           FROM loan_waivers
          WHERE loan_id = $1 AND status = 'approved') AS waived_to_amount_due
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );

  const alreadyPaid =
    parseFloat(paidResult.rows[0].cash_to_amount_due || 0) +
    parseFloat(paidResult.rows[0].waived_to_amount_due || 0);
  const totalDue = parseFloat(loan.total_amount_due);
  const currentBalance = Math.max(0, totalDue - alreadyPaid);
  const paymentAmount = parseFloat(amountPaid);

  // Outstanding penalty across the loan's overdue installments. Penalty
  // accrues per overdue installment as (late_fee + rate% * balance * months_late)
  // — see utils/penalty.js — and we now persist what's been paid via
  // payment_schedules.penalty_paid. Whatever's left must be cleared BEFORE
  // any payment reduces amount_due.
  const overduePenaltyResult = await query(
    `SELECT id, payment_number, amount_due, amount_paid,
            COALESCE(penalty_paid, 0) AS penalty_paid,
            (CURRENT_DATE - due_date::date) AS days_late
       FROM payment_schedules
      WHERE loan_id = $1
        AND (status = 'overdue' OR (status = 'pending' AND due_date < CURRENT_DATE))
        AND amount_due > COALESCE(amount_paid, 0)
      ORDER BY due_date ASC`,
    [loanId],
  );
  const penaltyRows = overduePenaltyResult.rows.map((s) => {
    const balance = parseFloat(s.amount_due) - parseFloat(s.amount_paid || 0);
    const p = computeInstallmentPenalty({
      balance,
      daysLate: parseInt(s.days_late, 10) || 0,
      lateFee: loan.late_payment_fee,
      penaltyRate: loan.penalty_rate,
    });
    const outstanding = Math.max(
      0,
      Math.round((p.penalty_total - parseFloat(s.penalty_paid)) * 100) / 100,
    );
    return {
      schedule_id: s.id,
      outstanding,
      late_fee: parseFloat(p.late_fee) || 0,
      penalty_interest: parseFloat(p.penalty_interest) || 0,
    };
  });
  const totalOutstandingPenalty = penaltyRows.reduce(
    (acc, r) => acc + r.outstanding,
    0,
  );

  // The borrower owes (principal+interest balance) + (outstanding penalty).
  // Any excess is overpayment (refunded to the borrower as before).
  // Cents-level noise from prorated penalty/interest math can leave a
  // tiny positive diff (e.g. 0.01) that's not really an overpayment —
  // anything under 1 KES is treated as zero so we don't trigger pending
  // refunds for rounding dust.
  const effectiveOwed = currentBalance + totalOutstandingPenalty;
  let overpayment = 0;
  let actualPaymentApplied = paymentAmount;
  const rawExcess = Math.round((paymentAmount - effectiveOwed) * 100) / 100;
  if (rawExcess >= 1) {
    overpayment = rawExcess;
    actualPaymentApplied = paymentAmount - overpayment;
  }

  // Allocate penalty FIRST, oldest overdue installment first, up to its
  // own outstanding penalty. Snapshot the late-fee / penalty-interest
  // breakdown onto the schedule row so the schedule UI can still show
  // how the penalty was built up even after the balance changes.
  let penaltyToAllocate = Math.min(actualPaymentApplied, totalOutstandingPenalty);
  let penaltyAllocated = 0;
  for (const row of penaltyRows) {
    if (penaltyToAllocate <= 0) break;
    const apply = Math.min(penaltyToAllocate, row.outstanding);
    if (apply > 0) {
      await query(
        `UPDATE payment_schedules
            SET penalty_paid = COALESCE(penalty_paid, 0) + $1,
                late_fee_charged =
                  GREATEST(COALESCE(late_fee_charged, 0), $2),
                penalty_interest_charged =
                  GREATEST(COALESCE(penalty_interest_charged, 0), $3),
                updated_at = NOW()
          WHERE id = $4`,
        [apply, row.late_fee, row.penalty_interest, row.schedule_id],
      );
      penaltyAllocated += apply;
      penaltyToAllocate -= apply;
    }
  }
  // Whatever's left after penalty is what reduces amount_due.
  const amountTowardSchedule = actualPaymentApplied - penaltyAllocated;

  // Generate transaction code
  const year = new Date().getFullYear();
  const countResult = await query(
    "SELECT COUNT(*) FROM transactions WHERE tenant_id = $1",
    [loan.tenant_id],
  );
  const txnCount = parseInt(countResult.rows[0].count) + 1;
  // Lender-prefixed, mirroring loan_code / client_code (e.g. TXN-FAU-2026-00001).
  const tRes = await query("SELECT subdomain FROM tenants WHERE id = $1", [
    loan.tenant_id,
  ]);
  const transactionCode = `TXN-${tenantPrefix(tRes.rows[0]?.subdomain)}-${year}-${String(txnCount).padStart(5, "0")}`;

  // Record the transaction. amount_paid is the gross client payment;
  // penalty_portion + overpayment_portion record what slice went to penalty
  // and what was overpaid (will be refunded). "Collected" anywhere else =
  // amount_paid - overpayment_portion.
  const txnResult = await query(
    `INSERT INTO transactions (
        tenant_id, transaction_code, loan_id, client_id, amount_paid,
        penalty_portion, overpayment_portion,
        payment_date, payment_method, payment_reference,
        payment_status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11)
      RETURNING *`,
    [
      loan.tenant_id,
      transactionCode,
      loanId,
      loan.client_id,
      paymentAmount,
      penaltyAllocated,
      overpayment,
      paymentDate,
      paymentMethod,
      paymentReference || null,
      notes || null,
    ],
  );
  const transaction = txnResult.rows[0];

  // Update payment schedule — only the post-penalty portion reduces amount_due.
  let remainingAmount = amountTowardSchedule;
  const scheduleResult = await query(
    `SELECT * FROM payment_schedules
       WHERE loan_id = $1 AND status IN ('pending', 'overdue')
       ORDER BY payment_number ASC`,
    [loanId],
  );

  // Reducing-balance loans stop the cascade at the first row. Excess
  // payment beyond the row's amount_due reduces the principal balance
  // DIRECTLY (recorded as extra principal_portion on that row) — then
  // recomputeReducingBalanceSchedule re-amortizes the remaining rows
  // off the lower balance. Flat-rate loans keep the legacy cascade:
  // their interest is fixed at disbursement, so excess just rolls
  // forward through the existing schedule.
  const isReducing = loan.interest_method === "reducing";

  if (isReducing) {
    const schedule = scheduleResult.rows[0];
    if (schedule && remainingAmount > 0) {
      const amountDue = parseFloat(schedule.amount_due);
      const alreadyPaidOnSchedule = parseFloat(schedule.amount_paid || 0);
      const interestPaidOnSchedule = parseFloat(schedule.interest_paid || 0);
      const scheduledPrincipal = parseFloat(schedule.principal_portion || 0);
      const stillOwed = Math.max(
        0,
        amountDue - alreadyPaidOnSchedule - interestPaidOnSchedule,
      );

      if (remainingAmount >= stillOwed) {
        // Full EMI cash payment for this row. Excess past the EMI
        // knocks down principal directly — but only up to the
        // remaining loan principal. Anything beyond that has no debt
        // to settle and becomes true overpayment recorded on the
        // transaction now (no "ghost principal" landing on the row).
        const rawExcess = round2(remainingAmount - stillOwed);
        const balRes = await query(
          `SELECT GREATEST(0,
              l.principal_amount
              - COALESCE((
                  SELECT SUM(principal_portion) FROM payment_schedules
                   WHERE loan_id = $1
                     AND (status = 'paid' OR status = 'waived')
                     AND id != $2
                ), 0)
              - $3
            ) AS principal_room
            FROM loans l WHERE l.id = $1`,
          [loanId, schedule.id, scheduledPrincipal],
        );
        const principalRoom = parseFloat(
          balRes.rows[0]?.principal_room || 0,
        );
        const principalKnockdown = Math.min(rawExcess, principalRoom);
        const cashOverpayment = round2(rawExcess - principalKnockdown);
        const newAmountPaid = round2(
          alreadyPaidOnSchedule + stillOwed + principalKnockdown,
        );
        const newPrincipalPortion = round2(
          scheduledPrincipal + principalKnockdown,
        );
        await query(
          `UPDATE payment_schedules
              SET amount_paid = $1,
                  principal_portion = $2,
                  status = 'paid',
                  actual_payment_date = $3,
                  updated_at = NOW()
            WHERE id = $4`,
          [newAmountPaid, newPrincipalPortion, paymentDate, schedule.id],
        );
        if (cashOverpayment >= 0.01) {
          await query(
            `UPDATE transactions
                SET overpayment_portion =
                      COALESCE(overpayment_portion, 0) + $1,
                    updated_at = NOW()
              WHERE id = $2`,
            [cashOverpayment, transaction.id],
          );
          overpayment = round2(overpayment + cashOverpayment);
        }
        remainingAmount = 0;
      } else {
        // Partial — fits in this row, no principal-knockdown.
        await query(
          `UPDATE payment_schedules
              SET amount_paid = $1, updated_at = NOW()
            WHERE id = $2`,
          [alreadyPaidOnSchedule + remainingAmount, schedule.id],
        );
        remainingAmount = 0;
      }
    }
  } else {
    for (const schedule of scheduleResult.rows) {
      if (remainingAmount <= 0) break;

      const amountDue = parseFloat(schedule.amount_due);
      const alreadyPaidOnSchedule = parseFloat(schedule.amount_paid || 0);
      const interestPaidOnSchedule = parseFloat(schedule.interest_paid || 0);
      // Interest already covered by waiver counts toward "this row is
      // settled" too — without this, a row whose interest had been
      // waived would need extra cash to flip to 'paid' (the cash sum
      // would have to reach amount_due even though interest_paid is
      // already covering part of it).
      const stillOwed = Math.max(
        0,
        amountDue - alreadyPaidOnSchedule - interestPaidOnSchedule,
      );

      if (remainingAmount >= stillOwed) {
        // Full payment of this installment — bump amount_paid by the
        // cash slice needed to close it, leaving interest_paid intact.
        await query(
          `UPDATE payment_schedules
             SET amount_paid = $1, status = 'paid', actual_payment_date = $2, updated_at = NOW()
             WHERE id = $3`,
          [alreadyPaidOnSchedule + stillOwed, paymentDate, schedule.id],
        );
        remainingAmount -= stillOwed;
      } else {
        // Partial payment
        await query(
          `UPDATE payment_schedules
             SET amount_paid = $1, updated_at = NOW()
             WHERE id = $2`,
          [alreadyPaidOnSchedule + remainingAmount, schedule.id],
        );
        remainingAmount = 0;
      }
    }
  }

  // Re-amortize the remaining schedule + sync loan totals when the
  // loan is reducing-balance. Best-effort; never throws.
  if (isReducing) {
    await recomputeReducingBalanceSchedule(loanId);

    // The recompute may have shrunk total_amount_due below the cash
    // already paid (prepayment knocked principal way down). Surface
    // the post-recompute surplus on THIS transaction's
    // overpayment_portion — the initial pre-payment overpayment check
    // sees the OLD total and can't detect the new excess. Without
    // this, the loan-level overpayment_amount comes out short.
    const surplusRes = await query(
      `SELECT
         (SELECT COALESCE(SUM(amount_paid
                            - COALESCE(penalty_portion, 0)
                            - COALESCE(overpayment_portion, 0)), 0)
            FROM transactions
           WHERE loan_id = $1 AND payment_status = 'completed') AS cash_to_due,
         (SELECT total_amount_due FROM loans WHERE id = $1) AS total_due`,
      [loanId],
    );
    const cashToDue = parseFloat(surplusRes.rows[0].cash_to_due);
    const newTotalDue = parseFloat(surplusRes.rows[0].total_due);
    const additionalSurplus = round2(cashToDue - newTotalDue);
    if (additionalSurplus >= 0.01) {
      await query(
        `UPDATE transactions
            SET overpayment_portion =
                  COALESCE(overpayment_portion, 0) + $1,
                updated_at = NOW()
          WHERE id = $2`,
        [additionalSurplus, transaction.id],
      );
      overpayment = round2(overpayment + additionalSurplus);
    }
  }

  // Recalculate totals after this payment. Three figures matter:
  //  - cash_to_amount_due  amount_paid net of penalty (income) and
  //                        overpayment (refundable). What the cash
  //                        leg of payments actually drove down on
  //                        the principal+interest book.
  //  - total_overpayment   SUM(overpayment_portion). Must be summed
  //                        separately — cash_to_amount_due already
  //                        excluded it, so "cash − totalDue" would
  //                        always be ≤0 and never surface a refund.
  //  - waived_to_amount_due  Waivers' allocation.amount_total on
  //                        approved waivers. A waiver is not cash,
  //                        but it forgives part of amount_due — so
  //                        for the purpose of auto-completing a
  //                        loan, it counts toward "effectively paid"
  //                        the same way a cash receipt does. Without
  //                        this, a borrower who pays the balance
  //                        AFTER a partial waiver stays stuck at
  //                        status='active' forever because the
  //                        cash-only sum never catches up to the
  //                        contractual total_amount_due.
  const newTotalsResult = await query(
    `SELECT
        COALESCE(SUM(
          amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
        ), 0)                                              AS cash_to_amount_due,
        COALESCE(SUM(COALESCE(overpayment_portion, 0)), 0) AS total_overpayment,
        (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
           FROM loan_waivers
          WHERE loan_id = $1 AND status = 'approved')      AS waived_to_amount_due
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );

  const cashToAmountDue = parseFloat(
    newTotalsResult.rows[0].cash_to_amount_due,
  );
  const waivedToAmountDue = parseFloat(
    newTotalsResult.rows[0].waived_to_amount_due,
  );
  const newOverpayment = parseFloat(newTotalsResult.rows[0].total_overpayment);
  const newTotalPaid = cashToAmountDue + waivedToAmountDue;
  // For reducing-balance loans, recomputeReducingBalanceSchedule may
  // have shrunk loan.total_amount_due (when prepayment knocks down
  // principal, future interest accrues on a lower balance, so the
  // contractual sum drops). Re-read the post-recompute total so the
  // auto-complete check fires against the new reality, not the
  // pre-payment snapshot held in `totalDue`.
  const totalDueRes = await query(
    `SELECT total_amount_due FROM loans WHERE id = $1`,
    [loanId],
  );
  const effectiveTotalDue = parseFloat(
    totalDueRes.rows[0]?.total_amount_due ?? totalDue,
  );
  const isFullyPaid = newTotalPaid >= effectiveTotalDue;

  // Update loan status based on actual amounts
  if (isFullyPaid) {
    await query(
      `UPDATE loans
         SET status = 'completed',
             completed_via = COALESCE(completed_via, 'paid'),
             overpayment_amount = $1,
             refund_status = $2,
             updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
      [
        newOverpayment,
        newOverpayment > 0 ? "pending" : null,
        loanId,
        loan.tenant_id,
      ],
    );

    // Also mark any remaining pending schedules as paid
    await query(
      `UPDATE payment_schedules
         SET status = 'paid', amount_paid = amount_due, updated_at = NOW()
         WHERE loan_id = $1 AND status IN ('pending', 'overdue')`,
      [loanId],
    );

    logger.info(`✓ Loan ${loan.loan_code} fully paid - marked as completed`);
    if (newOverpayment > 0) {
      logger.info(`💰 Overpayment of KES ${newOverpayment} - refund pending`);
    }

    // Loan-completion notification is handled below in one unified
    // dispatcher block alongside payment_received — keeps SMS + Email
    // logging consistent and gated by tenant prefs.
  }

  // Update capital pool. Split the amount actually applied to the loan
  // (overpayment is refunded, so it is NOT recovered capital) into
  // principal recovery vs interest profit using the loan's ratio.
  // Only the post-penalty portion goes into this split; penalty itself is
  // income, recognised straight onto total_interest_earned.
  const loanTotalDue = parseFloat(loan.total_amount_due);
  const principalPercentage =
    loanTotalDue > 0 ? parseFloat(loan.principal_amount) / loanTotalDue : 0;
  const interestPercentage = 1 - principalPercentage;

  const principalPortion = amountTowardSchedule * principalPercentage;
  const interestPortion = amountTowardSchedule * interestPercentage;

  await query(
    `UPDATE capital_pool
         SET total_collected = total_collected + $1,
             total_interest_earned = total_interest_earned + $2,
             updated_at = NOW()
       WHERE tenant_id = $3`,
    [principalPortion, interestPortion + penaltyAllocated, loan.tenant_id],
  );

  await query(
    `INSERT INTO capital_transactions (tenant_id, transaction_type, amount, loan_id, transaction_id, description)
       VALUES ($1, 'payment_received', $2, $3, $4, $5)`,
    [
      loan.tenant_id,
      actualPaymentApplied,
      loanId,
      transaction.id,
      `Payment received for ${loan.loan_code}`,
    ],
  );

  // Customer SMS + Email via the central dispatcher. Gated by the
  // tenant's notify_payment_{sms,email} prefs and logged to
  // sms_logs / email_logs. The transaction receipt PDF is attached to
  // the email so customers get the receipt alongside the notice.
  // If this payment closed the loan, fire loan_completed straight
  // after, chained so it always lands AFTER the receipt.
  (async () => {
    try {
      const c = await query(
        "SELECT phone_number, first_name, last_name, email FROM clients WHERE id = $1",
        [loan.client_id],
      );
      const cust = c.rows[0];
      if (!cust) return;
      const newBalance = totalDue - newTotalPaid;

      // Receipt PDF — only worth building if there's an email recipient.
      let attachments;
      if (cust.email) {
        try {
          const { buffer, filename } = await buildReceiptPdf(transaction.id);
          attachments = [{ filename, content: buffer }];
        } catch (pdfErr) {
          logger.error("Receipt PDF build error:", pdfErr);
        }
      }

      await notificationDispatcher.notify("payment_received", {
        tenantId: loan.tenant_id,
        customer: { ...cust, client_id: loan.client_id },
        data: {
          loan_id: loanId,
          loan_code: loan.loan_code,
          amount: paymentAmount,
          balance: newBalance,
          transaction_code: transactionCode,
          payment_method: paymentMethod,
          payment_date: paymentDate,
        },
        attachments,
      });

      if (isFullyPaid) {
        await notificationDispatcher.notify("loan_completed", {
          tenantId: loan.tenant_id,
          customer: { ...cust, client_id: loan.client_id },
          data: {
            loan_id: loanId,
            loan_code: loan.loan_code,
            total_paid: newTotalPaid,
            principal_amount: loan.principal_amount,
            total_interest: loan.total_interest,
            overpayment_amount: newOverpayment,
          },
        });
        logger.info(`✓ Loan completion notification sent for ${loan.loan_code}`);
      }
    } catch (err) {
      logger.error("Payment notification error:", err);
    }
  })();

  await logAudit({
    user: actor,
    action: "payment_recorded",
    entityType: "transaction",
    entityId: transaction.id,
    entityCode: transactionCode,
    description: `Recorded payment of KES ${paymentAmount.toLocaleString()} for loan ${loan.loan_code}`,
    newValues: {
      amount: paymentAmount,
      method: paymentMethod,
      loan_code: loan.loan_code,
      overpayment: newOverpayment,
    },
    metadata: {
      loan_id: loanId,
      is_completion: isFullyPaid,
      has_overpayment: newOverpayment > 0,
    },
    req: auditReq,
  });

  try {
    const ci = await query("SELECT * FROM clients WHERE id = $1", [
      loan.client_id,
    ]);
    const client = ci.rows[0];
    if (client) {
      await notifyLargePayment(transaction, loan, client);
      if (isFullyPaid) {
        await notifyLoanCompleted(loan, client);
        if (newOverpayment > 0) {
          await notifyRefundPending(
            { ...loan, overpayment_amount: newOverpayment },
            client,
          );
        }
      }
    }
  } catch (err) {
    logger.error("Payment notification error:", err);
  }

  logger.info(
    `✓ Payment recorded: ${transactionCode}, KES ${paymentAmount} for loan ${loan.loan_code}`,
  );

  // Build the receipt block the frontend modal needs. Pass the just-
  // recorded transaction so per-payment lines (penalty cleared by
  // this txn, overpayment from this txn) survive into the receipt —
  // without it the immediate-after-payment slip silently drops them
  // and the user only sees them later when re-opening from history.
  const receipt = await buildReceiptBlock(
    loan.id,
    loan.tenant_id,
    transaction,
  );

  // Keep clients.credit_score fresh — best-effort. A payment is one
  // of the few writes that materially changes a client's standing
  // (new on-time/late mark, possible auto-completion). Failures are
  // logged inside the service; never block the payment response.
  await recomputeCreditScore(loan.client_id, loan.tenant_id);

  return {
    message:
      newOverpayment > 0
        ? `Payment recorded. Overpayment of KES ${newOverpayment.toFixed(2)} - refund pending.`
        : "Payment recorded successfully",
    data: {
      ...transaction,
      overpayment_amount: newOverpayment,
      loan_status: isFullyPaid ? "completed" : "active",
      receipt,
    },
  };
}

/**
 * Compose the receipt block returned alongside a freshly-recorded
 * payment. Tenant-scoped; returns null on miss rather than throwing —
 * the receipt is a UX enhancement, not part of the payment contract.
 */
export async function buildReceiptBlock(loanId, tenantId, transaction = null) {
  try {
    const loanRes = await query(
      `SELECT
         l.id, l.loan_code, l.principal_amount, l.total_interest,
         l.total_amount_due, l.overpayment_amount,
         c.first_name, c.last_name, c.phone_number, c.client_code
       FROM loans l
       JOIN clients c ON c.id = l.client_id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [loanId, tenantId],
    );
    if (loanRes.rows.length === 0) return null;
    const l = loanRes.rows[0];

    // total_paid is the principal+interest portion applied to amount_due
    // (excludes penalty AND overpayment) PLUS waivers' amount_total, so
    // a receipt issued right after a waiver+payment that together cover
    // the contract reads "Remaining KES 0" instead of leaving the
    // waived share on the books. Mirrors routes/payments.js summary,
    // the loans list balance_due, and the dashboard outstanding —
    // same formula everywhere.
    const paidRes = await query(
      `SELECT
          COALESCE(SUM(
            amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
          ), 0) AS cash_to_amount_due,
          (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
             FROM loan_waivers
            WHERE loan_id = $1 AND status = 'approved') AS waived_to_amount_due
         FROM transactions
        WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loanId],
    );

    const totalDue = parseFloat(l.total_amount_due);
    const cashToAmountDue = parseFloat(paidRes.rows[0].cash_to_amount_due || 0);
    const waivedToAmountDue = parseFloat(
      paidRes.rows[0].waived_to_amount_due || 0,
    );
    const totalPaid = cashToAmountDue + waivedToAmountDue;
    const remaining = Math.max(0, totalDue - totalPaid);
    // Prefer per-transaction overpayment when the caller passed the
    // just-recorded transaction in — that's what the receipt is FOR
    // (this payment, not the cumulative loan-level figure). Falls
    // back to loans.overpayment_amount for callers that don't have
    // a single transaction in mind.
    const overpayment = transaction
      ? parseFloat(transaction.overpayment_portion || 0)
      : parseFloat(l.overpayment_amount || 0);
    // Penalty cleared by this specific transaction. Without this the
    // immediate receipt under-counts what the cash actually settled
    // and the "Toward balance" line on the slip is wrong.
    const penaltyPaid = transaction
      ? parseFloat(transaction.penalty_portion || 0)
      : 0;

    const nextRes = await query(
      `SELECT payment_number, due_date, amount_due, amount_paid,
              (SELECT COUNT(*) FROM payment_schedules WHERE loan_id = $1)::int
                AS total_installments
         FROM payment_schedules
        WHERE loan_id = $1 AND status IN ('pending', 'overdue')
        ORDER BY due_date ASC
        LIMIT 1`,
      [loanId],
    );
    const next = nextRes.rows[0] || null;
    // "Next payment" = the standard EMI the borrower should plan for,
    // not the residual on a partially-paid row. Surplus payments still
    // shrink the headline `remaining_balance` (the borrower sees the
    // benefit there), but the per-installment ask stays at the EMI —
    // matching how banks render mortgages after an extra payment.
    //
    // Exception: on the FINAL installment, the residual is whatever's
    // actually left after rounding-pin amortization (might be a cent
    // or two off the EMI), so use the residual to avoid suggesting a
    // payment slightly larger than what's owed.
    let nextAmount = 0;
    if (next) {
      const emi = parseFloat(next.amount_due);
      const residual = Math.max(0, emi - parseFloat(next.amount_paid || 0));
      const isFinal =
        parseInt(next.payment_number, 10) ===
        parseInt(next.total_installments, 10);
      nextAmount = isFinal ? residual : emi;
    }

    return {
      loan_id: l.id,
      loan_code: l.loan_code,
      client_name: `${l.first_name} ${l.last_name}`,
      client_phone: l.phone_number,
      client_code: l.client_code,
      principal: parseFloat(l.principal_amount),
      total_interest: parseFloat(l.total_interest || 0),
      total_amount_due: totalDue,
      total_paid: totalPaid,
      remaining_balance: remaining,
      overpayment,
      penalty_paid: penaltyPaid,
      is_fully_paid: remaining === 0,
      next_payment_number: next?.payment_number || null,
      next_payment_amount: nextAmount,
      next_payment_date: next?.due_date || null,
      completion_percentage:
        totalDue > 0 ? ((totalPaid / totalDue) * 100).toFixed(1) : "0",
    };
  } catch (err) {
    logger.error("buildReceiptBlock error:", err);
    return null;
  }
}

export default { recordLoanPayment, buildReceiptBlock };
