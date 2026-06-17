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
import { reconcilePromisesForLoan } from "./promiseReconciliationService.js";

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
            COALESCE(late_fee_charged, 0) AS late_fee_charged,
            COALESCE(penalty_interest_charged, 0) AS penalty_interest_charged,
            (CURRENT_DATE - due_date::date) AS days_late
       FROM payment_schedules
      WHERE loan_id = $1
        AND (
          -- still-overdue installments accrue penalty on their unpaid balance
          ( (status = 'overdue' OR (status = 'pending' AND due_date < CURRENT_DATE))
            AND amount_due > COALESCE(amount_paid, 0) )
          -- OR a fine that's already been charged but isn't fully paid — e.g.
          -- a penalty reopened by a payment reversal now sits on a row whose
          -- amount_due is settled, so the live formula reads 0. Without this
          -- branch the fine is invisible to collection and a payment meant to
          -- clear it gets mis-booked as overpayment.
          OR ( COALESCE(late_fee_charged, 0) + COALESCE(penalty_interest_charged, 0)
                 > COALESCE(penalty_paid, 0) )
        )
      ORDER BY due_date ASC`,
    [loanId],
  );
  const penaltyRows = overduePenaltyResult.rows.map((s) => {
    const balance = parseFloat(s.amount_due) - parseFloat(s.amount_paid || 0);
    const p = computeInstallmentPenalty({
      balance: Math.max(0, balance),
      daysLate: parseInt(s.days_late, 10) || 0,
      lateFee: loan.late_payment_fee,
      penaltyRate: loan.penalty_rate,
    });
    // While a row is still overdue the live formula is the accruing truth.
    // Only fall back to the persisted charge snapshot once amount_due is
    // settled (live reads 0) but a fine was charged — e.g. one reopened by a
    // reversal. Flooring on the (DB-rounded) snapshot for still-overdue rows
    // would collect a stray cent of penalty against the live figure.
    const live = parseFloat(p.penalty_total) || 0;
    const snapshotTotal =
      Math.round(
        (parseFloat(s.late_fee_charged) + parseFloat(s.penalty_interest_charged)) * 100,
      ) / 100;
    const penaltyTotal = balance > 0.005 ? live : Math.max(live, snapshotTotal);
    const outstanding = Math.max(
      0,
      Math.round((penaltyTotal - parseFloat(s.penalty_paid)) * 100) / 100,
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

  // Generate transaction code. Lender-prefixed, mirroring
  // loan_code / client_code (e.g. TXN-FAU-2026-00001).
  //
  // Numbering uses MAX(suffix) + 1 across the tenant's existing
  // codes — NOT COUNT(*) + 1, which collided after a loan
  // deletion left a gap. Concrete repro: loan 313 had
  // TXN-KUW-2026-00001; after deleting loan 313 + its txn,
  // tenant 23 had codes 00002 + 00003 with COUNT = 2. The next
  // payment generated COUNT + 1 = 00003 → duplicate-key on
  // transactions_tenant_code_unique → "Failed to record payment"
  // with no specific reason surfaced to the UI.
  //
  // The regex strips the suffix off any "...-NNNNN" code,
  // tolerates non-numeric noise, and ignores codes that don't
  // match the pattern. COALESCE handles "no prior codes" by
  // starting at 1.
  // Code period is the PAYMENT month+year (mmyyyy), mirroring loan_code —
  // so a backdated payment reads with the month it was actually paid.
  const pd = new Date(paymentDate);
  const codePeriod = `${String(pd.getMonth() + 1).padStart(2, "0")}${pd.getFullYear()}`;
  const tRes = await query("SELECT subdomain FROM tenants WHERE id = $1", [
    loan.tenant_id,
  ]);
  const lastNumRes = await query(
    `SELECT COALESCE(
       MAX((regexp_match(transaction_code, '-(\\d+)$'))[1]::int),
       0
     ) AS last_num
       FROM transactions WHERE tenant_id = $1`,
    [loan.tenant_id],
  );
  const txnCount = parseInt(lastNumRes.rows[0].last_num, 10) + 1;
  const transactionCode = `TXN-${tenantPrefix(tRes.rows[0]?.subdomain)}-${codePeriod}-${String(txnCount).padStart(5, "0")}`;

  // Backdated payments carry no clock time (the form is a date picker), so
  // default their timestamp to 08:00 on the payment date instead of "now" —
  // otherwise a past-dated receipt prints today's time. Same-day payments
  // keep the real recording time.
  const pdStr = pd.toISOString().split("T")[0];
  const todayStr = new Date().toISOString().split("T")[0];
  const createdAt =
    pdStr < todayStr ? `${pdStr}T08:00:00` : new Date().toISOString();

  // Record the transaction. amount_paid is the gross client payment;
  // penalty_portion + overpayment_portion record what slice went to penalty
  // and what was overpaid (will be refunded). "Collected" anywhere else =
  // amount_paid - overpayment_portion.
  const txnResult = await query(
    `INSERT INTO transactions (
        tenant_id, transaction_code, loan_id, client_id, amount_paid,
        penalty_portion, overpayment_portion,
        payment_date, payment_method, payment_reference,
        payment_status, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12)
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
      createdAt,
    ],
  );
  const transaction = txnResult.rows[0];

  // Snapshot every schedule row BEFORE the cascade so the pool
  // booking can do per-row attribution of cash → principal vs
  // interest. A loan-level ratio (interest_total / amount_due)
  // is correct on aggregate but wrong on a row that's been
  // partially settled by a waiver: when 10k of interest is
  // waived on a row whose amount_due is 11,263, the remaining
  // 1,263 of cash is pure principal — ratio-splitting it
  // overstates interest income and understates principal
  // recovery by the principal share of the waiver. Carrying
  // (amount_due, amount_paid, interest_paid, interest_portion,
  //  principal_portion) lets us replay per-row settlement after
  // the cascade with full waiver visibility.
  const preCascadeRows = await query(
    `SELECT id, amount_due, amount_paid, COALESCE(interest_paid, 0) AS interest_paid,
            COALESCE(interest_portion, 0) AS interest_portion,
            COALESCE(principal_portion, 0) AS principal_portion
       FROM payment_schedules WHERE loan_id = $1`,
    [loanId],
  );
  const preRowMap = new Map(
    preCascadeRows.rows.map((r) => [
      r.id,
      {
        amount_due: parseFloat(r.amount_due),
        amount_paid: parseFloat(r.amount_paid),
        interest_paid: parseFloat(r.interest_paid),
        interest_portion: parseFloat(r.interest_portion),
        principal_portion: parseFloat(r.principal_portion),
      },
    ]),
  );

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
    // Walk OVERDUE rows in order first — they each had their EMI
    // (interest + principal) accrued at their due date, so cash must
    // settle them like the flat-rate cascade does. Once we hit the
    // FIRST PENDING (not-yet-overdue) row, switch to the prepay
    // model: settle that row's EMI, then knock principal down with
    // any excess. The recompute zeros remaining rows.
    for (let i = 0; i < scheduleResult.rows.length; i++) {
      if (remainingAmount <= 0) break;
      const schedule = scheduleResult.rows[i];
      const amountDue = parseFloat(schedule.amount_due);
      const alreadyPaidOnSchedule = parseFloat(schedule.amount_paid || 0);
      const interestPaidOnSchedule = parseFloat(schedule.interest_paid || 0);
      const scheduledPrincipal = parseFloat(schedule.principal_portion || 0);
      const stillOwed = Math.max(
        0,
        amountDue - alreadyPaidOnSchedule - interestPaidOnSchedule,
      );
      const rowIsOverdue = schedule.status === "overdue";

      // Overdue rows that get fully settled: just cascade onward —
      // their accrued interest is already earned, cash closes them
      // the normal way. Knockdown only applies once we reach the
      // first PENDING row or the only remaining row.
      if (rowIsOverdue && remainingAmount >= stillOwed) {
        await query(
          `UPDATE payment_schedules
              SET amount_paid = $1,
                  status = 'paid',
                  actual_payment_date = $2,
                  updated_at = NOW()
            WHERE id = $3`,
          [alreadyPaidOnSchedule + stillOwed, paymentDate, schedule.id],
        );
        remainingAmount = round2(remainingAmount - stillOwed);
        continue;
      }

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

    // No post-recompute surplus credit needed. The cascade-stop above
    // already capped principal_portion at the actual remaining loan
    // principal and recorded any cash beyond that as
    // transaction.overpayment_portion in the same step. After the
    // recompute the difference between cash_to_amount_due and
    // total_amount_due is NOT additional overpayment — it's cash that
    // legitimately reduced principal (and therefore future interest),
    // which is why total_amount_due dropped. Adding that gap to
    // overpayment would double-count: the cash was already accounted
    // for both as principal_portion on the row AND would also become
    // a refund — the borrower can't get a refund for cash they used
    // to pay down their loan.
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

    // Note: promises on a completed loan are filtered out of every
    // Promises-page query (see routes/promises.js) — no need to mutate
    // their status. Leaving them in their real state preserves history
    // and lets the queue re-appear correctly if the loan ever flips
    // back to active (e.g. a waiver reversal).

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

  // Capital pool booking — per-row attribution of this txn's
  // cash to interest income vs. principal recovery.
  //
  // For each row this txn touched (post.amount_paid changed):
  //   cash_added           = post.amount_paid − pre.amount_paid
  //   cash_to_amount_due   = min(cash_added, pre.amount_due − pre.amount_paid)
  //   knockdown            = cash_added − cash_to_amount_due (100% principal)
  //   interest_room        = max(0, pre.interest_portion − pre.interest_paid)
  //   cash_to_interest     = min(cash_to_amount_due, interest_room)
  //   cash_to_principal    = cash_to_amount_due − cash_to_interest + knockdown
  //
  // Sum across rows for the txn's totals. This gives the right
  // split when waivers have settled the interest side of a row
  // and the cash that arrives is pure principal — a loan-level
  // ratio can't see that, and inflates interest income by the
  // principal share of the waiver. For loan 313, the ratio
  // approach booked 47,996.90 principal / 39,919.76 interest;
  // per-row attribution books 50,000 / 37,915.87 — which is the
  // composition that actually settled (interest = sum of
  // (cash to fill interest_portion − waiver_interest) per row).
  //
  // Knockdown still books as 100% principal — it's by definition
  // extra principal payment beyond contractual amount_due.
  //
  // Overpayment is NOT booked to the pool; it stays a refund
  // liability on loans.overpayment_amount so available_pool
  // reflects lendable cash, not gross cash received.
  const postCascadeRows = await query(
    `SELECT id, amount_paid FROM payment_schedules WHERE loan_id = $1`,
    [loanId],
  );
  let principalDelta = 0;
  let interestDelta = 0;
  for (const post of postCascadeRows.rows) {
    const pre = preRowMap.get(post.id);
    if (!pre) continue;
    const cashAdded = round2(parseFloat(post.amount_paid) - pre.amount_paid);
    if (cashAdded <= 0) continue;
    const room = Math.max(0, pre.amount_due - pre.amount_paid);
    const cashToAmountDue = Math.min(cashAdded, room);
    const knockdown = round2(cashAdded - cashToAmountDue);

    // Per-row interest attribution that's stable across multiple
    // payments on the same row WITHOUT writing cash into
    // schedule.interest_paid (which the cascade reads as already-
    // settled and would silently drop cash from later payments).
    //
    //   interestRoomTotal     = full interest still owed on the row
    //                           after waiver credits
    //   priorCashToInterest   = how much of pre.amount_paid already
    //                           filled that room (clamped, since cash
    //                           lands principal-first only if waiver
    //                           pre-covered interest)
    //   interestRoomRemaining = what THIS payment can still book as
    //                           interest income
    //
    // Earlier txns' cash-to-interest is recovered from pre.amount_paid
    // alone — no schedule-state mutation needed. interest_paid stays
    // waiver-only, the cascade's stillOwed math stays correct, and
    // multi-txn rows can't book the same interest twice.
    const interestRoomTotal = Math.max(0, pre.interest_portion - pre.interest_paid);
    const priorCashToInterest = Math.min(pre.amount_paid, interestRoomTotal);
    const interestRoomRemaining = Math.max(0, interestRoomTotal - priorCashToInterest);
    const cashToInterest = Math.min(cashToAmountDue, interestRoomRemaining);
    const cashToPrincipal = cashToAmountDue - cashToInterest + knockdown;
    interestDelta += cashToInterest;
    principalDelta += cashToPrincipal;
  }
  const principalPortion = round2(principalDelta);
  const interestPortion = round2(interestDelta);

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

  // Promise-to-Pay auto-reconciliation. Walks every open promise on
  // this loan and transitions to 'partial' or 'kept' based on the
  // cumulative cash that's arrived since the promise was logged.
  // Best-effort by construction — the helper swallows errors so a
  // hiccup here can't bring down a successful payment recording.
  await reconcilePromisesForLoan(loanId);

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

// ── Editing a recorded payment ───────────────────────────────────────
// A loan's realised interest + principal (from the schedule rows) and
// penalties collected (from transactions). Used to compute the capital
// pool DELTA on an edit — interest-first per row, matching analytics.
async function loanRealizedFigures(loanId) {
  const r = await query(
    `SELECT
       COALESCE(SUM(LEAST(amount_paid,
         GREATEST(0, COALESCE(interest_portion,0) - COALESCE(interest_paid,0)))),0)::float AS interest,
       COALESCE(SUM(LEAST(amount_paid, amount_due)),0)::float AS cash_to_due
     FROM payment_schedules WHERE loan_id = $1`,
    [loanId],
  );
  const p = await query(
    `SELECT COALESCE(SUM(COALESCE(penalty_portion,0)),0)::float AS penalty
       FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );
  return {
    interest: r.rows[0].interest,
    principal: r.rows[0].cash_to_due - r.rows[0].interest,
    penalty: p.rows[0].penalty,
  };
}

// Re-cascade the loan's completed cash onto its EXISTING schedule rows in
// order — only amount_paid + status change; the interest/principal split
// is preserved. Returns { fullyPaid }.
async function recascadeLoanSchedule(loanId) {
  const loanRes = await query(
    `SELECT penalty_rate, late_payment_fee FROM loans WHERE id = $1`,
    [loanId],
  );
  const loan = loanRes.rows[0] || {};
  const sched = await query(
    `SELECT id, amount_due, due_date,
            COALESCE(late_fee_charged, 0) AS late_fee_charged,
            COALESCE(penalty_interest_charged, 0) AS penalty_interest_charged
       FROM payment_schedules
      WHERE loan_id = $1 ORDER BY payment_number ASC`,
    [loanId],
  );
  const cashRes = await query(
    `SELECT COALESCE(SUM(amount_paid - COALESCE(penalty_portion,0) - COALESCE(overpayment_portion,0)),0)::float AS cash,
            COALESCE(SUM(COALESCE(penalty_portion,0)),0)::float AS penalty_cash
       FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );
  // Penalty cash that's actually been settled = surviving payments' penalty
  // portions + approved penalty waivers (waivers credit penalty_paid directly,
  // see waiverService). A voided/edited payment's penalty portion is gone, so
  // we re-spread whatever remains across the overdue installments oldest-first
  // — otherwise penalty_paid stays stuck at the pre-void figure and a fine
  // looks settled when the cash that cleared it has been pulled back.
  const waiverRes = await query(
    `SELECT COALESCE(SUM(COALESCE((allocation->>'penalty_total')::float, 0)), 0)::float AS waived_penalty
       FROM loan_waivers WHERE loan_id = $1 AND status = 'approved'`,
    [loanId],
  );
  let remaining = cashRes.rows[0].cash;
  const totalCash = cashRes.rows[0].cash;
  let penaltyCash = round2(
    cashRes.rows[0].penalty_cash + waiverRes.rows[0].waived_penalty,
  );
  const now = new Date();
  let totalDue = 0;
  let outstandingPenalty = 0;
  for (const s of sched.rows) {
    const due = parseFloat(s.amount_due);
    totalDue += due;
    let paid = 0;
    let status;
    if (remaining >= due) {
      paid = due;
      status = "paid";
      remaining -= due;
    } else {
      if (remaining > 0) {
        paid = round2(remaining);
        remaining = 0;
      }
      status = new Date(s.due_date) < now ? "overdue" : "pending";
    }

    // Penalty CHARGED on this row: the persisted high-water snapshot (set when
    // penalty was first paid), or — for a row that's overdue now but never had
    // penalty snapshotted — the live formula. A paid row keeps its snapshot so
    // a cleared fine doesn't vanish from the books.
    let charged = round2(
      parseFloat(s.late_fee_charged) + parseFloat(s.penalty_interest_charged),
    );
    if (new Date(s.due_date) < now && paid < due) {
      const daysLate = Math.floor((now - new Date(s.due_date)) / 86400000);
      const live = computeInstallmentPenalty({
        balance: round2(due - paid),
        daysLate,
        lateFee: loan.late_payment_fee,
        penaltyRate: loan.penalty_rate,
      });
      charged = Math.max(charged, round2(live.penalty_total));
    }
    const penPay = Math.min(penaltyCash, charged);
    penaltyCash = round2(penaltyCash - penPay);
    outstandingPenalty = round2(outstandingPenalty + (charged - penPay));

    await query(
      `UPDATE payment_schedules
          SET amount_paid = $1, status = $2, penalty_paid = $3, updated_at = NOW()
        WHERE id = $4`,
      [paid, status, round2(penPay), s.id],
    );
  }
  // A loan isn't settled while a fine is still owed: penalty is owed on top of
  // principal+interest (recordLoanPayment's effectiveOwed), so the completion
  // gate must clear penalty too — otherwise a void leaves a "completed" loan
  // with unpaid fines.
  const fullyPaid =
    totalDue > 0 && totalCash + 0.01 >= totalDue && outstandingPenalty <= 0.01;
  return { fullyPaid, outstandingPenalty };
}

/**
 * Edit an already-recorded payment (amount / date / method / reference /
 * notes). Re-derives the loan's schedule fill + status and reconciles the
 * capital pool by the DELTA of realised principal/interest, so unrelated
 * figures never drift. Penalty/overpayment portions are preserved — to
 * change those, void & re-record instead.
 */
export async function editLoanPayment({
  transactionId,
  amountPaid,
  paymentDate,
  paymentTime, // "HH:MM" — optional explicit clock time
  paymentMethod,
  paymentReference,
  notes,
  tenantId = null,
  actor = {},
  req = null,
}) {
  const txnRes = await query(
    `SELECT * FROM transactions
      WHERE id = $1 AND ($2::int IS NULL OR tenant_id = $2)`,
    [transactionId, tenantId],
  );
  if (txnRes.rows.length === 0) throw httpError(404, "Payment not found");
  const txn = txnRes.rows[0];
  if (txn.payment_status !== "completed")
    throw httpError(400, "Only completed payments can be edited");

  const loanRes = await query(`SELECT * FROM loans WHERE id = $1`, [txn.loan_id]);
  const loan = loanRes.rows[0];
  if (!loan) throw httpError(404, "Loan not found");

  const newAmount =
    amountPaid != null && amountPaid !== ""
      ? parseFloat(amountPaid)
      : parseFloat(txn.amount_paid);
  if (!(newAmount > 0)) throw httpError(400, "Amount must be greater than zero");
  const penalty = parseFloat(txn.penalty_portion || 0);
  if (newAmount + 0.001 < penalty)
    throw httpError(
      400,
      `Amount can't be less than its penalty portion (KES ${penalty.toFixed(2)})`,
    );

  // Overpayment is RE-DERIVED from the new amount, not preserved. Editing a
  // payment's amount down can drop the loan from overpaid to underpaid; keeping
  // the old overpayment_portion leaves a phantom surplus (which then gets
  // refunded, paying out money the loan never actually had). Recompute the
  // loan's true surplus = all cash that lands on amount_due (net of each
  // payment's penalty) + approved waivers − total amount due, then give this
  // edited payment whatever slice of it the OTHER payments don't already hold.
  const otherTxnRes = await query(
    `SELECT COALESCE(SUM(amount_paid - COALESCE(penalty_portion,0)),0)::float AS net_other,
            COALESCE(SUM(COALESCE(overpayment_portion,0)),0)::float            AS over_other
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed' AND id <> $2`,
    [loan.id, transactionId],
  );
  const editWaiverRes = await query(
    `SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)::float AS waived
       FROM loan_waivers WHERE loan_id = $1 AND status = 'approved'`,
    [loan.id],
  );
  const thisNet = round2(newAmount - penalty); // this payment's cash toward amount_due/surplus
  const amountDueTotal = parseFloat(loan.total_amount_due || 0);
  const rawSurplus = round2(
    otherTxnRes.rows[0].net_other +
      thisNet +
      editWaiverRes.rows[0].waived -
      amountDueTotal,
  );
  // Sub-1-KES diffs are prorated-math dust, not a real overpayment.
  const loanSurplus = rawSurplus >= 1 ? rawSurplus : 0;
  const otherOver = round2(otherTxnRes.rows[0].over_other);
  const overpay = Math.max(0, Math.min(round2(loanSurplus - otherOver), thisNet));
  const newLoanOverpayment = round2(otherOver + overpay);

  const oldDateStr = new Date(txn.payment_date).toISOString().split("T")[0];
  const newDateStr = paymentDate
    ? new Date(paymentDate).toISOString().split("T")[0]
    : oldDateStr;
  if (newDateStr > new Date().toISOString().split("T")[0]) {
    throw httpError(400, "Payment date cannot be in the future");
  }
  const newMethod = paymentMethod || txn.payment_method;
  const newRef =
    paymentReference !== undefined ? paymentReference : txn.payment_reference;
  const newNotes = notes !== undefined ? notes : txn.notes;

  // Timestamp: an explicit time wins; otherwise, when the date moves to a
  // past day, default to 08:00 (a same-day move uses the current time).
  const todayStr = new Date().toISOString().split("T")[0];
  let createdAt = txn.created_at;
  if (paymentTime && /^\d{1,2}:\d{2}$/.test(paymentTime)) {
    createdAt = `${newDateStr}T${paymentTime.padStart(5, "0")}:00`;
  } else if (newDateStr !== oldDateStr) {
    createdAt =
      newDateStr < todayStr
        ? `${newDateStr}T08:00:00`
        : new Date().toISOString();
  }

  const before = await loanRealizedFigures(loan.id);

  await query(
    `UPDATE transactions
        SET amount_paid = $1, payment_date = $2, payment_method = $3,
            payment_reference = $4, notes = $5, created_at = $6,
            overpayment_portion = $7, updated_at = NOW()
      WHERE id = $8`,
    [newAmount, newDateStr, newMethod, newRef || null, newNotes || null, createdAt, overpay, transactionId],
  );
  // Keep the capital ledger entry for this payment in step with the new net.
  await query(
    `UPDATE capital_transactions SET amount = $1 WHERE transaction_id = $2`,
    [round2(newAmount - overpay), transactionId],
  );

  const { fullyPaid } = await recascadeLoanSchedule(loan.id);
  // Sync loan status + the overpayment/refund liability to the re-derived
  // figures. An already-'refunded' loan is left as-is — the cash is out the
  // door — even if the edit erased the surplus on paper; that mismatch needs a
  // human (recover from the borrower or write off), not a silent un-refund.
  const statusPatch =
    loan.status === "active" && fullyPaid
      ? "status='completed', "
      : loan.status === "completed" && !fullyPaid
        ? "status='active', "
        : "";
  const clearableRefund = loan.refund_status !== "refunded";
  await query(
    `UPDATE loans
        SET ${statusPatch}
            overpayment_amount = $1::numeric,
            refund_status = CASE
              WHEN $3::boolean = false THEN refund_status
              WHEN $1::numeric > 0 THEN COALESCE(NULLIF(refund_status, 'refunded'), 'pending')
              ELSE NULL END,
            updated_at = NOW()
      WHERE id = $2`,
    [newLoanOverpayment, loan.id, clearableRefund],
  );

  const after = await loanRealizedFigures(loan.id);
  const dCollected = round2(after.principal - before.principal);
  const dInterest = round2(
    after.interest - before.interest + (after.penalty - before.penalty),
  );
  if (dCollected !== 0 || dInterest !== 0) {
    await query(
      `UPDATE capital_pool
          SET total_collected = total_collected + $1,
              total_interest_earned = total_interest_earned + $2,
              updated_at = NOW()
        WHERE tenant_id = $3`,
      [dCollected, dInterest, loan.tenant_id],
    );
  }

  await logAudit({
    user: actor,
    action: "payment_edited",
    entityType: "transaction",
    entityId: transactionId,
    entityCode: txn.transaction_code,
    description: `Edited payment ${txn.transaction_code} on ${loan.loan_code}`,
    oldValues: {
      amount_paid: txn.amount_paid,
      payment_date: oldDateStr,
      payment_method: txn.payment_method,
    },
    newValues: {
      amount_paid: newAmount,
      payment_date: newDateStr,
      payment_method: newMethod,
    },
    req,
  });

  await recomputeCreditScore(loan.client_id, loan.tenant_id).catch(() => {});

  const updated = await query(`SELECT * FROM transactions WHERE id = $1`, [transactionId]);
  return { success: true, data: updated.rows[0] };
}

/**
 * Reverse (void) a completed payment. Soft-voids the transaction
 * (payment_status='voided' — the financial record is never destroyed; every
 * total filters payment_status='completed', so it drops out of the books), then
 * re-derives the loan's schedule + status from the REMAINING payments and
 * reconciles the capital pool by the realised-figure DELTA — the exact same
 * machinery as editLoanPayment, so a void can't drift the pool. Overpayment is
 * only a refund liability on the loan (never booked to the pool), so reversal
 * just recomputes it from the surviving payments.
 */
export async function voidLoanPayment({ transactionId, reason, tenantId = null, actor = {}, req = null }) {
  const txnRes = await query(
    `SELECT * FROM transactions WHERE id = $1 AND ($2::int IS NULL OR tenant_id = $2)`,
    [transactionId, tenantId],
  );
  if (txnRes.rows.length === 0) throw httpError(404, "Payment not found");
  const txn = txnRes.rows[0];
  if (txn.payment_status !== "completed")
    throw httpError(400, "Only completed payments can be reversed");

  const loanRes = await query(`SELECT * FROM loans WHERE id = $1`, [txn.loan_id]);
  const loan = loanRes.rows[0];
  if (!loan) throw httpError(404, "Loan not found");

  const before = await loanRealizedFigures(loan.id);

  // Soft-void the payment + drop its capital-ledger entry (the pool itself is
  // reconciled by the delta below).
  await query(
    `UPDATE transactions
        SET payment_status = 'voided', voided_at = NOW(), voided_by = $2, void_reason = $3, updated_at = NOW()
      WHERE id = $1`,
    [transactionId, actor?.id || null, reason || null],
  );
  await query(`DELETE FROM capital_transactions WHERE transaction_id = $1`, [transactionId]);

  // Re-derive schedule fill + completion from the surviving payments.
  const { fullyPaid } = await recascadeLoanSchedule(loan.id);

  // Overpayment is the sum of surviving payments' overpayment legs.
  const opRes = await query(
    `SELECT COALESCE(SUM(COALESCE(overpayment_portion, 0)), 0)::float AS op
       FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loan.id],
  );
  const newOverpayment = round2(opRes.rows[0].op);
  const wasRefunded = loan.refund_status === "refunded";

  if (fullyPaid) {
    await query(
      `UPDATE loans
          SET status = 'completed',
              overpayment_amount = $1,
              refund_status = CASE WHEN $1 > 0 THEN COALESCE(refund_status, 'pending') ELSE NULL END,
              updated_at = NOW()
        WHERE id = $2`,
      [newOverpayment, loan.id],
    );
  } else {
    // Back to active — clear completion + any refund liability this payment held.
    await query(
      `UPDATE loans
          SET status = 'active', completed_via = NULL,
              overpayment_amount = 0, refund_status = NULL,
              refund_method = NULL, refund_reference = NULL, refunded_date = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [loan.id],
    );
  }

  // Reconcile the pool by the realised principal / interest+penalty delta.
  const after = await loanRealizedFigures(loan.id);
  const dCollected = round2(after.principal - before.principal);
  const dInterest = round2(after.interest - before.interest + (after.penalty - before.penalty));
  if (dCollected !== 0 || dInterest !== 0) {
    await query(
      `UPDATE capital_pool
          SET total_collected = total_collected + $1,
              total_interest_earned = total_interest_earned + $2,
              updated_at = NOW()
        WHERE tenant_id = $3`,
      [dCollected, dInterest, loan.tenant_id],
    );
  }

  await logAudit({
    user: actor,
    action: "payment_voided",
    entityType: "transaction",
    entityId: transactionId,
    entityCode: txn.transaction_code,
    description:
      `Reversed payment ${txn.transaction_code} (KES ${parseFloat(txn.amount_paid).toLocaleString()}) on ${loan.loan_code}` +
      (reason ? ` — ${reason}` : "") +
      (wasRefunded ? " [WARNING: an overpayment on this loan was already marked refunded — verify any cash paid out]" : ""),
    oldValues: { amount_paid: txn.amount_paid, payment_status: "completed" },
    newValues: { payment_status: "voided" },
    req,
  });

  await recomputeCreditScore(loan.client_id, loan.tenant_id).catch(() => {});

  return {
    success: true,
    data: {
      transaction_id: transactionId,
      loan_status: fullyPaid ? "completed" : "active",
      overpayment_amount: newOverpayment,
      pool_adjustment: { total_collected: dCollected, total_interest_earned: dInterest },
      was_refunded_warning: wasRefunded,
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
    // PLUS waivers' amount_total, so a receipt issued right after a
    // waiver+payment that together cover the contract reads
    // "Remaining KES 0" instead of leaving the waived share on the
    // books. Mirrors routes/payments.js summary, the loans list
    // balance_due, and the dashboard outstanding — same formula
    // everywhere.
    //
    // cash_to_amount_due is derived from the schedule (per-row
    // LEAST(amount_paid, amount_due)) rather than the transactions
    // table. For reducing-balance loans the cascade can park
    // surplus cash on a row as principal knockdown (amount_paid >
    // amount_due) and then zero future rows via recompute — that
    // knockdown cash isn't applied to amount_due, it eliminated
    // future amount_due. Counting it would double-subtract (the
    // recompute lowered total_amount_due AND the knockdown would
    // count as paid) and the receipt would render >100% complete.
    const paidRes = await query(
      `SELECT
          COALESCE(SUM(LEAST(amount_paid, amount_due)), 0) AS cash_to_amount_due,
          (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
             FROM loan_waivers
            WHERE loan_id = $1 AND status = 'approved') AS waived_to_amount_due
         FROM payment_schedules
        WHERE loan_id = $1`,
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
