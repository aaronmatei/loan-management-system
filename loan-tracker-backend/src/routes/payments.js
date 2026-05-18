import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { sendSMS, templates } from "../services/smsService.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET ALL PAYMENTS
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { loan_id, client_id, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT 
        t.*,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.client_code,
        l.loan_code
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (loan_id) {
      paramCount++;
      queryText += ` AND t.loan_id = $${paramCount}`;
      params.push(loan_id);
    }

    if (client_id) {
      paramCount++;
      queryText += ` AND t.client_id = $${paramCount}`;
      params.push(client_id);
    }

    queryText += ` ORDER BY t.payment_date DESC, t.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const countResult = await query("SELECT COUNT(*) FROM transactions");
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// ============================================================
// RECORD PAYMENT (with overpayment handling)
// ============================================================
router.post("/", async (req, res) => {
  try {
    const {
      loan_id,
      amount_paid,
      payment_date,
      payment_method,
      payment_reference,
      notes,
    } = req.body;

    // Validation
    if (!loan_id || !amount_paid || !payment_date || !payment_method) {
      return res.status(400).json({
        error: "Loan, amount, date, and payment method are required",
      });
    }

    // Get loan details
    const loanResult = await query("SELECT * FROM loans WHERE id = $1", [
      loan_id,
    ]);

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const loan = loanResult.rows[0];

    if (loan.status === "completed") {
      return res.status(400).json({
        error: "This loan is already fully paid. Cannot record more payments.",
      });
    }

    if (loan.status !== "active") {
      return res.status(400).json({
        error: `Cannot record payment on ${loan.status} loan`,
      });
    }

    // Calculate total already paid
    const paidResult = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total_paid 
       FROM transactions 
       WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loan_id],
    );

    const alreadyPaid = parseFloat(paidResult.rows[0].total_paid);
    const totalDue = parseFloat(loan.total_amount_due);
    const currentBalance = totalDue - alreadyPaid;
    const paymentAmount = parseFloat(amount_paid);

    // Calculate overpayment
    let overpayment = 0;
    let actualPaymentApplied = paymentAmount;

    if (paymentAmount > currentBalance) {
      overpayment = paymentAmount - currentBalance;
      actualPaymentApplied = currentBalance;
    }

    // Generate transaction code
    const year = new Date().getFullYear();
    const countResult = await query("SELECT COUNT(*) FROM transactions");
    const txnCount = parseInt(countResult.rows[0].count) + 1;
    const transactionCode = `TXN-${year}-${String(txnCount).padStart(5, "0")}`;

    // Record the transaction (full amount paid by client)
    const txnResult = await query(
      `INSERT INTO transactions (
        transaction_code, loan_id, client_id, amount_paid,
        payment_date, payment_method, payment_reference,
        payment_status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8)
      RETURNING *`,
      [
        transactionCode,
        loan_id,
        loan.client_id,
        paymentAmount,
        payment_date,
        payment_method,
        payment_reference || null,
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
      [loan_id],
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
          [amountDue, payment_date, schedule.id],
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

    // ✅ Recalculate totals after this payment
    const newTotalPaidResult = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total_paid 
       FROM transactions 
       WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loan_id],
    );

    const newTotalPaid = parseFloat(newTotalPaidResult.rows[0].total_paid);
    const newOverpayment = Math.max(0, newTotalPaid - totalDue);
    const isFullyPaid = newTotalPaid >= totalDue;

    // ✅ Update loan status based on actual amounts
    if (isFullyPaid) {
      await query(
        `UPDATE loans 
         SET status = 'completed', 
             overpayment_amount = $1,
             refund_status = $2,
             updated_at = NOW() 
         WHERE id = $3`,
        [newOverpayment, newOverpayment > 0 ? "pending" : null, loan_id],
      );

      // Also mark any remaining pending schedules as paid
      await query(
        `UPDATE payment_schedules 
         SET status = 'paid', amount_paid = amount_due, updated_at = NOW()
         WHERE loan_id = $1 AND status = 'pending'`,
        [loan_id],
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

            // Slight delay so it lands after the payment-received SMS
            setTimeout(() => {
              sendSMS(phoneNumber, completionMessage)
                .then((smsResult) =>
                  query(
                    `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                      loan.client_id,
                      loan_id,
                      phoneNumber,
                      completionMessage,
                      isOverpaid
                        ? "loan_completed_overpayment"
                        : "loan_completed",
                      smsResult.success ? "sent" : "failed",
                      JSON.stringify(smsResult),
                      req.user.id,
                    ],
                  ).then(() =>
                    logger.info(
                      `✓ Loan completion SMS logged for ${loan.loan_code}`,
                    ),
                  ),
                )
                .catch((err) =>
                  logger.error("Loan completion SMS error:", err),
                );
            }, 2000);
          }
        } catch (err) {
          logger.error("Loan completion SMS error:", err);
        }
      }
    }

    // ✅ Update capital pool. Split the amount actually applied to the
    // loan (overpayment is refunded, so it is NOT recovered capital)
    // into principal recovery vs interest profit using the loan's ratio.
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
       WHERE id = (SELECT id FROM capital_pool ORDER BY id DESC LIMIT 1)`,
      [principalPortion, interestPortion],
    );

    await query(
      `INSERT INTO capital_transactions (transaction_type, amount, loan_id, transaction_id, description)
       VALUES ('payment_received', $1, $2, $3, $4)`,
      [
        actualPaymentApplied,
        loan_id,
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
                  loan_id,
                  clientResult.rows[0].phone_number,
                  smsMessage,
                  smsResult.success ? "sent" : "failed",
                  JSON.stringify(smsResult),
                  req.user.id,
                ],
              ).catch((err) => logger.error("SMS log error:", err));
            },
          );
        }
      } catch (err) {
        logger.error("Auto SMS error:", err);
      }
    }

    logger.info(
      `✓ Payment recorded: ${transactionCode}, KES ${paymentAmount} for loan ${loan.loan_code}`,
    );

    res.status(201).json({
      success: true,
      message:
        newOverpayment > 0
          ? `Payment recorded. Overpayment of KES ${newOverpayment.toFixed(2)} - refund pending.`
          : "Payment recorded successfully",
      data: {
        ...transaction,
        overpayment_amount: newOverpayment,
        loan_status: isFullyPaid ? "completed" : "active",
      },
    });
  } catch (error) {
    logger.error("Record payment error:", error);
    res.status(500).json({ error: "Failed to record payment" });
  }
});

// ============================================================
// GET LOAN PAYMENT SUMMARY
// ============================================================
router.get("/loan/:loanId/summary", async (req, res) => {
  try {
    const { loanId } = req.params;

    const loanResult = await query(
      `SELECT 
        l.*,
        c.first_name, c.last_name, c.phone_number, c.client_code, c.email
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1`,
      [loanId],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const loan = loanResult.rows[0];

    // Get total paid
    const paidResult = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total_paid 
       FROM transactions 
       WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loanId],
    );

    // Get payment schedule
    const scheduleResult = await query(
      `SELECT * FROM payment_schedules 
       WHERE loan_id = $1 
       ORDER BY payment_number ASC`,
      [loanId],
    );

    // Get transactions
    const transactionsResult = await query(
      `SELECT * FROM transactions 
       WHERE loan_id = $1 
       ORDER BY payment_date DESC`,
      [loanId],
    );

    const totalPaid = parseFloat(paidResult.rows[0].total_paid);
    const totalDue = parseFloat(loan.total_amount_due);
    const overpayment = parseFloat(loan.overpayment_amount || 0);
    const balance = Math.max(0, totalDue - totalPaid);

    res.json({
      success: true,
      data: {
        loan,
        summary: {
          total_due: totalDue,
          total_paid: totalPaid,
          balance: balance,
          overpayment: overpayment,
          refund_status: loan.refund_status,
          progress_percentage: (
            (Math.min(totalPaid, totalDue) / totalDue) *
            100
          ).toFixed(1),
        },
        schedule: scheduleResult.rows,
        transactions: transactionsResult.rows,
      },
    });
  } catch (error) {
    logger.error("Get loan summary error:", error);
    res.status(500).json({ error: "Failed to fetch loan summary" });
  }
});

// ============================================================
// MARK REFUND AS PAID
// ============================================================
router.post("/refund/:loanId", async (req, res) => {
  try {
    const { loanId } = req.params;
    const { refund_method, refund_reference, refunded_date } = req.body;

    // Validation
    if (!refund_method || !refunded_date) {
      return res.status(400).json({
        error: "Refund method and date are required",
      });
    }

    // Get loan
    const loanResult = await query("SELECT * FROM loans WHERE id = $1", [
      loanId,
    ]);

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const loan = loanResult.rows[0];

    // Check if refund is pending
    if (loan.refund_status !== "pending") {
      return res.status(400).json({
        error: "No pending refund for this loan",
      });
    }

    if (parseFloat(loan.overpayment_amount) <= 0) {
      return res.status(400).json({
        error: "No overpayment to refund",
      });
    }

    // Update loan with refund details
    await query(
      `UPDATE loans 
       SET refund_status = 'refunded',
           refund_method = $1,
           refund_reference = $2,
           refunded_date = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [refund_method, refund_reference || null, refunded_date, loanId],
    );

    logger.info(
      `✓ Refund processed for loan ${loan.loan_code}: KES ${loan.overpayment_amount}`,
    );

    // Refund-processed SMS (same guard as the other payment-flow hooks)
    if (process.env.SMS_AUTO_CONFIRMATIONS === "true") {
      try {
        const refundClient = await query(
          "SELECT phone_number, first_name FROM clients WHERE id = $1",
          [loan.client_id],
        );

        if (refundClient.rows[0]?.phone_number) {
          const clientName = refundClient.rows[0].first_name;
          const phoneNumber = refundClient.rows[0].phone_number;
          const message = templates.refundProcessed(
            clientName,
            loan.overpayment_amount,
            loan.loan_code,
          );

          const smsResult = await sendSMS(phoneNumber, message);

          await query(
            `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
             VALUES ($1, $2, $3, $4, 'refund_processed', $5, $6, $7)`,
            [
              loan.client_id,
              loanId,
              phoneNumber,
              message,
              smsResult.success ? "sent" : "failed",
              JSON.stringify(smsResult),
              req.user.id,
            ],
          );

          logger.info(`✓ Refund SMS logged for ${loan.loan_code}`);
        }
      } catch (err) {
        logger.error("Refund SMS error:", err);
      }
    }

    res.json({
      success: true,
      message: `Refund of KES ${loan.overpayment_amount} marked as paid`,
    });
  } catch (error) {
    logger.error("Process refund error:", error);
    res.status(500).json({ error: "Failed to process refund" });
  }
});

export default router;
