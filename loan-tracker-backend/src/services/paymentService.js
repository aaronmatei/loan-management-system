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

// Typed error so the route can map to the right HTTP status while the
// M-Pesa caller can just catch and log.
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
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

  // "Already paid against amount_due" excludes both the penalty_portion
  // (income, not principal) AND the overpayment_portion (refunded to the
  // client, not applied to the balance).
  const paidResult = await query(
    `SELECT COALESCE(
        SUM(amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)),
        0
      ) AS total_paid
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );

  const alreadyPaid = parseFloat(paidResult.rows[0].total_paid);
  const totalDue = parseFloat(loan.total_amount_due);
  const currentBalance = totalDue - alreadyPaid;
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
  const effectiveOwed = currentBalance + totalOutstandingPenalty;
  let overpayment = 0;
  let actualPaymentApplied = paymentAmount;
  if (paymentAmount > effectiveOwed) {
    overpayment = paymentAmount - effectiveOwed;
    actualPaymentApplied = effectiveOwed;
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

  for (const schedule of scheduleResult.rows) {
    if (remainingAmount <= 0) break;

    const amountDue = parseFloat(schedule.amount_due);
    const alreadyPaidOnSchedule = parseFloat(schedule.amount_paid || 0);
    const stillOwed = amountDue - alreadyPaidOnSchedule;

    if (remainingAmount >= stillOwed) {
      // Full payment of this installment
      await query(
        `UPDATE payment_schedules
           SET amount_paid = $1, status = 'paid', actual_payment_date = $2, updated_at = NOW()
           WHERE id = $3`,
        [amountDue, paymentDate, schedule.id],
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

  // Recalculate totals after this payment. Same exclusions as alreadyPaid:
  // penalty_portion (income) and overpayment_portion (refunded).
  const newTotalPaidResult = await query(
    `SELECT COALESCE(
        SUM(amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)),
        0
      ) AS total_paid
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );

  const newTotalPaid = parseFloat(newTotalPaidResult.rows[0].total_paid);
  const newOverpayment = Math.max(0, newTotalPaid - totalDue);
  const isFullyPaid = newTotalPaid >= totalDue;

  // Update loan status based on actual amounts
  if (isFullyPaid) {
    await query(
      `UPDATE loans
         SET status = 'completed',
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

  // Build the receipt block the frontend modal needs.
  const receipt = await buildReceiptBlock(loan.id, loan.tenant_id);

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
export async function buildReceiptBlock(loanId, tenantId) {
  try {
    const loanRes = await query(
      `SELECT
         l.id, l.loan_code, l.principal_amount, l.total_interest,
         l.total_amount_due,
         c.first_name, c.last_name, c.phone_number, c.client_code
       FROM loans l
       JOIN clients c ON c.id = l.client_id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [loanId, tenantId],
    );
    if (loanRes.rows.length === 0) return null;
    const l = loanRes.rows[0];

    // total_paid is the principal+interest portion applied to amount_due
    // (excludes penalty AND overpayment). Mirrors routes/payments.js summary.
    const paidRes = await query(
      `SELECT COALESCE(
          SUM(amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)),
          0
        ) AS total_paid
         FROM transactions
        WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loanId],
    );

    const totalDue = parseFloat(l.total_amount_due);
    const totalPaid = parseFloat(paidRes.rows[0].total_paid || 0);
    const remaining = Math.max(0, totalDue - totalPaid);
    const overpayment = parseFloat(l.overpayment_amount || 0);

    const nextRes = await query(
      `SELECT payment_number, due_date, amount_due, amount_paid
         FROM payment_schedules
        WHERE loan_id = $1 AND status IN ('pending', 'overdue')
        ORDER BY due_date ASC
        LIMIT 1`,
      [loanId],
    );
    const next = nextRes.rows[0] || null;
    const nextAmount = next
      ? Math.max(
          0,
          parseFloat(next.amount_due) - parseFloat(next.amount_paid || 0),
        )
      : 0;

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
