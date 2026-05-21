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
import { sendSMS, templates } from "./smsService.js";
import {
  sendEmail,
  templates as emailTemplates,
  getCompanySettings,
} from "./emailService.js";
import { buildReceiptPdf } from "../utils/pdfDocuments.js";
import { logAudit } from "./auditService.js";
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

  // Calculate total already paid
  const paidResult = await query(
    `SELECT COALESCE(SUM(amount_paid), 0) as total_paid
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
    [loanId],
  );

  const alreadyPaid = parseFloat(paidResult.rows[0].total_paid);
  const totalDue = parseFloat(loan.total_amount_due);
  const currentBalance = totalDue - alreadyPaid;
  const paymentAmount = parseFloat(amountPaid);

  // Calculate overpayment
  let overpayment = 0;
  let actualPaymentApplied = paymentAmount;
  if (paymentAmount > currentBalance) {
    overpayment = paymentAmount - currentBalance;
    actualPaymentApplied = currentBalance;
  }

  // Generate transaction code
  const year = new Date().getFullYear();
  const countResult = await query(
    "SELECT COUNT(*) FROM transactions WHERE tenant_id = $1",
    [loan.tenant_id],
  );
  const txnCount = parseInt(countResult.rows[0].count) + 1;
  const transactionCode = `TXN-${year}-${String(txnCount).padStart(5, "0")}`;

  // Record the transaction (full amount paid by client)
  const txnResult = await query(
    `INSERT INTO transactions (
        tenant_id, transaction_code, loan_id, client_id, amount_paid,
        payment_date, payment_method, payment_reference,
        payment_status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)
      RETURNING *`,
    [
      loan.tenant_id,
      transactionCode,
      loanId,
      loan.client_id,
      paymentAmount,
      paymentDate,
      paymentMethod,
      paymentReference || null,
      notes || null,
    ],
  );
  const transaction = txnResult.rows[0];

  // Update payment schedule - mark pending payments as paid
  let remainingAmount = actualPaymentApplied;
  const scheduleResult = await query(
    `SELECT * FROM payment_schedules
       WHERE loan_id = $1 AND status = 'pending'
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

  // Recalculate totals after this payment
  const newTotalPaidResult = await query(
    `SELECT COALESCE(SUM(amount_paid), 0) as total_paid
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
         WHERE loan_id = $1 AND status = 'pending'`,
      [loanId],
    );

    logger.info(`✓ Loan ${loan.loan_code} fully paid - marked as completed`);
    if (newOverpayment > 0) {
      logger.info(`💰 Overpayment of KES ${newOverpayment} - refund pending`);
    }

    // Loan-completion SMS. Same guard as the payment-received hook so
    // both behave consistently; sendSMS() no-ops unless SMS_ENABLED.
    if (process.env.SMS_AUTO_CONFIRMATIONS === "true") {
      try {
        const completionClient = await query(
          "SELECT phone_number, first_name FROM clients WHERE id = $1",
          [loan.client_id],
        );

        if (completionClient.rows[0]?.phone_number) {
          const clientName = completionClient.rows[0].first_name;
          const phoneNumber = completionClient.rows[0].phone_number;
          const isOverpaid = newOverpayment > 0;
          const completionMessage = isOverpaid
            ? templates.loanCompletedWithOverpayment(
                clientName,
                loan.loan_code,
                newOverpayment,
              )
            : templates.loanCompleted(clientName, loan.loan_code);

          const smsResult = await sendSMS(phoneNumber, completionMessage);
          await query(
            `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              loan.client_id,
              loanId,
              phoneNumber,
              completionMessage,
              isOverpaid ? "loan_completed_overpayment" : "loan_completed",
              smsResult.success ? "sent" : "failed",
              JSON.stringify(smsResult),
              actorUserId,
            ],
          );
          logger.info(`✓ Loan completion SMS logged for ${loan.loan_code}`);
        }
      } catch (err) {
        logger.error("Loan completion SMS error:", err);
      }
    }
  }

  // Update capital pool. Split the amount actually applied to the loan
  // (overpayment is refunded, so it is NOT recovered capital) into
  // principal recovery vs interest profit using the loan's ratio.
  const loanTotalDue = parseFloat(loan.total_amount_due);
  const principalPercentage =
    loanTotalDue > 0 ? parseFloat(loan.principal_amount) / loanTotalDue : 0;
  const interestPercentage = 1 - principalPercentage;

  const principalPortion = actualPaymentApplied * principalPercentage;
  const interestPortion = actualPaymentApplied * interestPercentage;

  await query(
    `UPDATE capital_pool
         SET total_collected = total_collected + $1,
             total_interest_earned = total_interest_earned + $2,
             updated_at = NOW()
       WHERE tenant_id = $3`,
    [principalPortion, interestPortion, loan.tenant_id],
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

  // Auto payment-confirmation SMS. Always logged (consistent with the
  // manual Send endpoints); sendSMS() itself no-ops when SMS_ENABLED
  // is not 'true', so a real message only goes out when enabled.
  if (process.env.SMS_AUTO_CONFIRMATIONS === "true") {
    try {
      const clientResult = await query(
        "SELECT phone_number, first_name FROM clients WHERE id = $1",
        [loan.client_id],
      );
      if (clientResult.rows[0]?.phone_number) {
        const newBalance = totalDue - newTotalPaid;
        const smsMessage = templates.paymentReceived(
          clientResult.rows[0].first_name,
          paymentAmount,
          loan.loan_code,
          newBalance,
        );

        // Fire-and-forget; do not block the payment response
        sendSMS(clientResult.rows[0].phone_number, smsMessage).then(
          (smsResult) => {
            query(
              `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
                 VALUES ($1, $2, $3, $4, 'payment_received', $5, $6, $7)`,
              [
                loan.client_id,
                loanId,
                clientResult.rows[0].phone_number,
                smsMessage,
                smsResult.success ? "sent" : "failed",
                JSON.stringify(smsResult),
                actorUserId,
              ],
            ).catch((err) => logger.error("SMS log error:", err));
          },
        );
      }
    } catch (err) {
      logger.error("Auto SMS error:", err);
    }
  }

  // Auto payment-confirmation email with the receipt PDF attached.
  // Mirrors the SMS hook above; sendEmail() itself no-ops unless
  // EMAIL_ENABLED is 'true'. Fire-and-forget so the caller is not blocked.
  if (
    process.env.EMAIL_ENABLED === "true" &&
    process.env.EMAIL_AUTO_CONFIRMATIONS === "true"
  ) {
    (async () => {
      try {
        const clientResult = await query(
          "SELECT email, first_name FROM clients WHERE id = $1",
          [loan.client_id],
        );
        const recipient = clientResult.rows[0];
        if (recipient?.email) {
          const newBalance = totalDue - newTotalPaid;
          const company = await getCompanySettings();
          const template = emailTemplates.paymentReceived({
            clientName: recipient.first_name,
            amount: paymentAmount,
            loanCode: loan.loan_code,
            balance: newBalance,
            transactionCode,
            paymentMethod: paymentMethod,
            paymentDate: paymentDate,
            company,
          });

          const { buffer, filename } = await buildReceiptPdf(transaction.id);

          const emailResult = await sendEmail({
            to: recipient.email,
            subject: template.subject,
            html: template.html,
            attachments: [{ filename, content: buffer }],
          });

          await query(
            `INSERT INTO email_logs (client_id, loan_id, recipient_email, subject, message_type, has_attachment, attachment_name, status, provider_response, sent_by)
               VALUES ($1, $2, $3, $4, 'payment_received', true, $5, $6, $7, $8)`,
            [
              loan.client_id,
              loanId,
              recipient.email,
              template.subject,
              filename,
              emailResult.success ? "sent" : "failed",
              JSON.stringify(emailResult),
              actorUserId,
            ],
          );

          // If this payment also completed the loan, follow the receipt
          // with the celebratory completion email. Chained here (not via
          // setTimeout) so it always lands AFTER the receipt.
          if (isFullyPaid) {
            const completionTemplate =
              newOverpayment > 0
                ? emailTemplates.loanCompletedWithOverpayment({
                    clientName: recipient.first_name,
                    loanCode: loan.loan_code,
                    totalPaid: newTotalPaid,
                    overpaymentAmount: newOverpayment,
                    principalAmount: loan.principal_amount,
                    totalInterest: loan.total_interest,
                    company,
                  })
                : emailTemplates.loanCompleted({
                    clientName: recipient.first_name,
                    loanCode: loan.loan_code,
                    totalPaid: newTotalPaid,
                    principalAmount: loan.principal_amount,
                    totalInterest: loan.total_interest,
                    company,
                  });

            const completionResult = await sendEmail({
              to: recipient.email,
              subject: completionTemplate.subject,
              html: completionTemplate.html,
            });

            await query(
              `INSERT INTO email_logs (client_id, loan_id, recipient_email, subject, message_type, status, provider_response, sent_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                loan.client_id,
                loanId,
                recipient.email,
                completionTemplate.subject,
                newOverpayment > 0
                  ? "loan_completed_overpayment"
                  : "loan_completed",
                completionResult.success ? "sent" : "failed",
                JSON.stringify(completionResult),
                actorUserId,
              ],
            );

            if (completionResult.success) {
              logger.info(
                `✓ Loan completion email sent for ${loan.loan_code}`,
              );
            }
          }
        }
      } catch (err) {
        logger.error("Auto email error:", err);
      }
    })();
  }

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

    // total_paid is derived from completed transactions — `loans` has no
    // amount_paid column (the old SELECT referenced one that doesn't
    // exist, so this block silently returned null on every call). Mirrors
    // the SUM used throughout payments.js / portal customer queries.
    const paidRes = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total_paid
         FROM transactions
        WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loanId],
    );

    const totalDue = parseFloat(l.total_amount_due);
    const totalPaid = parseFloat(paidRes.rows[0].total_paid || 0);
    const remaining = Math.max(0, totalDue - totalPaid);

    const nextRes = await query(
      `SELECT payment_number, due_date, amount_due, amount_paid
         FROM payment_schedules
        WHERE loan_id = $1 AND status = 'pending'
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
