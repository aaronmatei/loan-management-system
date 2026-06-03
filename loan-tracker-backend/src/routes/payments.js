import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { sendSMS, templates } from "../services/smsService.js";
import {
  sendEmail,
  templates as emailTemplates,
  getCompanySettings,
} from "../services/emailService.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { recordLoanPayment } from "../services/paymentService.js";
import { computeInstallmentPenalty } from "../utils/penalty.js";
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

    const tcl = tenantClause(req, paramCount, "t.tenant_id");
    if (tcl.clause) {
      paramCount++;
      queryText += tcl.clause;
    }

    queryText += ` ORDER BY t.payment_date DESC, t.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(...tcl.params, limit, offset);

    const result = await query(queryText, params);

    const cclt = tenantClause(req, 0);
    const countResult = await query(
      `SELECT COUNT(*) FROM transactions WHERE 1=1${cclt.clause}`,
      cclt.params,
    );
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
//
// Core logic lives in services/paymentService.recordLoanPayment so the
// M-Pesa STK callback can record confirmed payments through the exact
// same path (schedules, capital pool, completion, notifications, audit).
// This handler just maps req → service args and errors → HTTP status.
// ============================================================
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const {
      loan_id,
      amount_paid,
      payment_date,
      payment_method,
      payment_reference,
      notes,
    } = req.body;

    const result = await recordLoanPayment({
      loanId: loan_id,
      amountPaid: amount_paid,
      paymentDate: payment_date,
      paymentMethod: payment_method,
      paymentReference: payment_reference,
      notes,
      actor: req.user, // { id, email, role } from the JWT
      tenantId: tenantId(req), // null for platform admin → no scope (unchanged)
      auditReq: req,
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
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

    const lt = tenantClause(req, 1, "l.tenant_id");
    const loanResult = await query(
      `SELECT
        l.*,
        c.first_name, c.last_name, c.phone_number, c.client_code, c.email
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1${lt.clause}`,
      [loanId, ...lt.params],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    const loan = loanResult.rows[0];

    // total_paid    = principal+interest settled against amount_due
    //                 (cash via transactions + amount_due-side waivers).
    //                 This drives the headline balance + progress %.
    // total_cash_paid = the cash leg only (transactions, ex penalty/overpayment).
    // total_collected = what the lender actually kept (gross − overpayment).
    // total_waived_amount_due / total_waived_penalty surfaced so the
    // UI can break "Paid So Far" into cash vs. waived if it wants.
    const paidResult = await query(
      `SELECT
         COALESCE(SUM(amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)), 0) AS total_cash_paid,
         COALESCE(SUM(amount_paid - COALESCE(overpayment_portion, 0)), 0)                                 AS total_collected,
         COALESCE(SUM(COALESCE(penalty_portion, 0)), 0)                                                    AS total_penalty_paid,
         COALESCE(SUM(COALESCE(overpayment_portion, 0)), 0)                                                AS total_overpayment
       FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'`,
      [loanId],
    );

    // Waivers approved on this loan — split into the amount_due bucket
    // (interest / principal forgiven) and the penalty bucket. Both count
    // toward "settled" for the balance / progress headline; the penalty
    // bucket also reduces the per-installment penalty_outstanding via
    // schedule.penalty_paid that the allocator already bumped.
    const waiverResult = await query(
      `SELECT
         COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)   AS total_waived_amount_due,
         COALESCE(SUM(COALESCE((allocation->>'penalty_total')::float, 0)), 0) AS total_waived_penalty
       FROM loan_waivers
       WHERE loan_id = $1 AND status = 'approved'`,
      [loanId],
    );

    // Get payment schedule. days_late drives the per-installment penalty.
    const scheduleResult = await query(
      `SELECT *, (CURRENT_DATE - due_date::date) AS days_late
       FROM payment_schedules
       WHERE loan_id = $1
       ORDER BY payment_number ASC`,
      [loanId],
    );

    // Annotate each installment with its late fee + penalty interest, using
    // the same shared formula as the Overdue page (utils/penalty.js). Paid or
    // not-yet-due installments resolve to zero penalty.
    // Each installment carries a share of the loan's total interest — its
    // policy share is total_interest / loan_duration_months. The interest
    // EARNED so far on an installment is that share scaled by how much of
    // its amount_due has been paid (so partial payments earn proportional
    // interest; fully-paid installments earn the full share).
    const monthsCount = parseInt(loan.loan_duration_months, 10) || 1;
    const interestPerInstallment =
      parseFloat(loan.total_interest || 0) / monthsCount;

    const scheduleWithPenalty = scheduleResult.rows.map((s) => {
      const due = parseFloat(s.amount_due) || 0;
      const cashPaid = parseFloat(s.amount_paid || 0);
      const interestPaid = parseFloat(s.interest_paid || 0);
      // Two balances on this row, used for different things:
      //
      //   bal (display / status) = due − cash − interest waiver
      //     → "how much more cash does the borrower need to close
      //        this installment." Drives balance_due in the row +
      //        the row's status. Shrinks when interest is waived.
      //
      //   penaltyBal (penalty math) = due − cash only
      //     → the CONTRACTUALLY overdue amount that penalty
      //        accrues against. Interest forgiveness on a row
      //        doesn't shrink the penalty owed for being late; the
      //        installment was still missed at its full amount.
      //        Otherwise a 500 interest waiver would silently
      //        reduce every overdue row's penalty interest too,
      //        which double-credits the borrower (less interest
      //        owed AND a smaller late-fee charge).
      const bal = due - cashPaid - interestPaid;
      const penaltyBal = Math.max(0, due - cashPaid);
      const daysLate =
        s.status === "paid" ? 0 : parseInt(s.days_late, 10) || 0;
      const computed = computeInstallmentPenalty({
        balance: penaltyBal,
        daysLate,
        lateFee: loan.late_payment_fee,
        penaltyRate: loan.penalty_rate,
      });
      const penaltyPaid = parseFloat(s.penalty_paid || 0);
      // "Penalty total" is the headline number for what was ever charged
      // on this installment. The live formula above re-computes against
      // CURRENT balance, which drops once a payment lands — so a paid
      // instalment recomputes to 0 even though penalty was charged at the
      // time, and a partially-paid one recomputes lower than what was
      // actually billed. Take the max with what's been paid so the
      // headline never disputes the historical charge.
      const penaltyTotal = Math.max(computed.penalty_total, penaltyPaid);
      const outstanding = Math.max(
        0,
        Math.round((penaltyTotal - penaltyPaid) * 100) / 100,
      );
      // Late-fee / penalty-interest breakdown: prefer the persisted
      // snapshot taken when penalty was paid (migration 030). Falls
      // back to the live formula for installments that haven't yet
      // had penalty charged.
      const lateFeeCharged = parseFloat(s.late_fee_charged || 0);
      const penaltyInterestCharged = parseFloat(s.penalty_interest_charged || 0);
      const lateFee =
        lateFeeCharged > 0 ? lateFeeCharged : computed.late_fee;
      const penaltyInterest =
        penaltyInterestCharged > 0
          ? penaltyInterestCharged
          : computed.penalty_interest;
      // "Interest earned" on this row to date — waiver-covered
      // interest + cash share of interest (by contract ratio), capped
      // at the installment's flat-share. A row whose interest is fully
      // covered by waiver reads as 500/500 even if subsequent cash
      // also lands — the cash slice goes to principal. This is the
      // pre-migration-042 "interest_portion" semantic; kept under a
      // new name so the row's true SCHEDULED interest_portion (from
      // the DB column, which carries the proper reducing-balance
      // amortization for those loans) can flow through untouched.
      const paidRatio = due > 0 ? Math.min(1, cashPaid / due) : 0;
      const interest_earned = Math.round(
        Math.min(
          interestPerInstallment,
          interestPaid + interestPerInstallment * paidRatio,
        ) * 100,
      ) / 100;
      return {
        ...s,
        balance_due: Math.round(Math.max(0, bal) * 100) / 100,
        interest_paid: interestPaid,
        ...computed,
        late_fee: lateFee,
        penalty_interest: penaltyInterest,
        penalty_total: penaltyTotal,
        penalty_paid: penaltyPaid,
        penalty_outstanding: outstanding,
        interest_earned,
      };
    });

    // Get transactions
    const transactionsResult = await query(
      `SELECT * FROM transactions 
       WHERE loan_id = $1 
       ORDER BY payment_date DESC`,
      [loanId],
    );

    const totalCashPaid = parseFloat(paidResult.rows[0].total_cash_paid);
    const totalCollected = parseFloat(paidResult.rows[0].total_collected);
    const totalPenaltyPaid = parseFloat(paidResult.rows[0].total_penalty_paid);
    const totalOverpayment = parseFloat(paidResult.rows[0].total_overpayment);
    const totalWaivedAmountDue = parseFloat(
      waiverResult.rows[0].total_waived_amount_due,
    );
    const totalWaivedPenalty = parseFloat(
      waiverResult.rows[0].total_waived_penalty,
    );
    // Settled = cash applied to amount_due + waivers applied to amount_due.
    // This is what the borrower no longer owes, regardless of source.
    const totalPaid = totalCashPaid + totalWaivedAmountDue;
    const totalDue = parseFloat(loan.total_amount_due);
    const overpayment = parseFloat(loan.overpayment_amount || 0);
    const balance = Math.max(0, totalDue - totalPaid);

    // Annotate each transaction with running balance / % complete. The
    // running tally starts at total_waived_amount_due so the receipt
    // reflects "already-settled via waivers" before the first real
    // payment lands — without this, a 16k waiver followed by a 50k
    // cash payment shows Balance After 16,325 instead of 325.
    const ascTxns = [...transactionsResult.rows].reverse();
    let running = totalWaivedAmountDue;
    const annotated = ascTxns.map((t) => {
      // Per-transaction overpayment comes straight from the row —
      // recordLoanPayment already capped it correctly (cash beyond
      // remaining principal balance + outstanding amount_due). The
      // OLD derivation (cash − (totalDue − running)) treated any
      // cash above the contractual residual as overpayment, which
      // double-counted reducing-balance knockdowns: cash that went
      // to extra principal would show up in BOTH principal_portion
      // on the schedule AND overpaidThis in the receipt.
      const overpaidThis = parseFloat(t.overpayment_portion || 0);
      const towardBalance = Math.max(
        0,
        parseFloat(t.amount_paid || 0)
          - parseFloat(t.penalty_portion || 0)
          - overpaidThis,
      );
      running += towardBalance;
      const remaining = Math.max(0, totalDue - running);
      return {
        ...t,
        receipt: {
          total_paid_after_this: running,
          remaining_balance_after_this: remaining,
          completion_percentage_after_this:
            totalDue > 0 ? ((running / totalDue) * 100).toFixed(1) : "0",
          overpayment_for_this: Math.round(overpaidThis * 100) / 100,
        },
      };
    });
    const transactionsWithReceipt = annotated.reverse(); // back to DESC

    // Next pending installment (used for the bottom summary card).
    const nextPayment = scheduleResult.rows.find((s) => s.status === "pending");

    res.json({
      success: true,
      data: {
        loan,
        summary: {
          total_due: totalDue,
          total_paid: totalPaid,           // settled against amount_due (cash + waivers)
          total_cash_paid: totalCashPaid,  // transactions only (gross of penalty + overpayment subtracted)
          total_waived_amount_due: totalWaivedAmountDue,
          total_waived_penalty: totalWaivedPenalty,
          total_collected: totalCollected, // kept by the lender (gross − overpayment)
          total_penalty_paid: totalPenaltyPaid,
          // Sum of per-installment penalty_outstanding — what the
          // borrower still owes in penalty right now after both
          // cash and waiver have been applied. Lets the Payments
          // panel show "Balance + Penalty = Total to pay" without
          // re-deriving from the schedule client-side.
          total_penalty_outstanding: scheduleWithPenalty.reduce(
            (acc, s) => acc + parseFloat(s.penalty_outstanding || 0),
            0,
          ),
          total_overpayment: totalOverpayment,
          balance: balance,
          overpayment: overpayment,
          refund_status: loan.refund_status,
          progress_percentage: (
            (Math.min(totalPaid, totalDue) / totalDue) *
            100
          ).toFixed(1),
        },
        // Same data shape the POST /payments receipt uses, lifted to
        // the loan-detail level so the frontend can render a single
        // "current status" card under the payment history.
        receipt_summary: {
          total_paid: totalPaid,
          remaining_balance: balance,
          is_fully_paid: balance === 0,
          next_payment_number: nextPayment?.payment_number || null,
          next_payment_amount: nextPayment
            ? Math.max(
                0,
                parseFloat(nextPayment.amount_due) -
                  parseFloat(nextPayment.amount_paid || 0),
              )
            : 0,
          next_payment_date: nextPayment?.due_date || null,
          completion_percentage:
            totalDue > 0
              ? ((Math.min(totalPaid, totalDue) / totalDue) * 100).toFixed(1)
              : "0",
        },
        schedule: scheduleWithPenalty,
        transactions: transactionsWithReceipt,
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
router.post("/refund/:loanId", authorize("admin", "manager"), async (req, res) => {
  try {
    const { loanId } = req.params;
    const { refund_method, refund_reference, refunded_date } = req.body;

    // Validation
    if (!refund_method || !refunded_date) {
      return res.status(400).json({
        error: "Refund method and date are required",
      });
    }

    // Get loan (tenant-scoped)
    const lt = tenantClause(req, 1);
    const loanResult = await query(
      `SELECT * FROM loans WHERE id = $1${lt.clause}`,
      [loanId, ...lt.params],
    );

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
       WHERE id = $4 AND tenant_id = $5`,
      [
        refund_method,
        refund_reference || null,
        refunded_date,
        loanId,
        loan.tenant_id,
      ],
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

    // Refund-processed email (mirrors the refund SMS above). Gated on
    // EMAIL_ENABLED as well so we don't write misleading "sent" log
    // rows when email delivery is switched off.
    if (
      process.env.EMAIL_ENABLED === "true" &&
      process.env.EMAIL_AUTO_CONFIRMATIONS === "true"
    ) {
      try {
        const refundEmailClient = await query(
          "SELECT email, first_name FROM clients WHERE id = $1",
          [loan.client_id],
        );
        const recipient = refundEmailClient.rows[0];

        if (recipient?.email) {
          const company = await getCompanySettings();
          const template = emailTemplates.refundProcessed({
            clientName: recipient.first_name,
            loanCode: loan.loan_code,
            refundAmount: loan.overpayment_amount,
            refundMethod: refund_method,
            refundReference: refund_reference,
            refundDate: refunded_date,
            company,
          });

          const emailResult = await sendEmail({
            to: recipient.email,
            subject: template.subject,
            html: template.html,
          });

          await query(
            `INSERT INTO email_logs (client_id, loan_id, recipient_email, subject, message_type, status, provider_response, sent_by)
             VALUES ($1, $2, $3, $4, 'refund_processed', $5, $6, $7)`,
            [
              loan.client_id,
              loanId,
              recipient.email,
              template.subject,
              emailResult.success ? "sent" : "failed",
              JSON.stringify(emailResult),
              req.user.id,
            ],
          );

          logger.info(`✓ Refund email logged for ${loan.loan_code}`);
        }
      } catch (err) {
        logger.error("Refund email error:", err);
      }
    }

    await logAudit({
      user: req.user,
      action: "refund_processed",
      entityType: "loan",
      entityId: loanId,
      entityCode: loan.loan_code,
      description: `Processed refund of KES ${parseFloat(
        loan.overpayment_amount,
      ).toLocaleString()} for loan ${loan.loan_code} via ${refund_method}`,
      newValues: { refund_method, refund_reference, refunded_date },
      req,
    });

    res.json({
      success: true,
      message: `Refund of KES ${loan.overpayment_amount} marked as paid`,
    });
  } catch (error) {
    logger.error("Process refund error:", error);
    res.status(500).json({ error: "Failed to process refund" });
  }
});

// ============================================================
// MARK MULTIPLE REFUNDS AS PAID — one method + date applies to every
// selected loan. SMS/email notifications fire per loan (fire-and-
// forget so the response returns quickly). Per-loan eligibility is
// re-checked: must be tenant-owned, refund_status='pending', and
// overpayment_amount > 0.
// ============================================================
router.post(
  "/bulk/refund",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { loan_ids, refund_method, refund_reference, refunded_date } =
        req.body || {};

      if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
        return res.status(400).json({ error: "No loans selected" });
      }
      if (!refund_method || !refunded_date) {
        return res
          .status(400)
          .json({ error: "Refund method and date are required" });
      }

      const lt = tenantClause(req, 1, "tenant_id");
      const loansResult = await query(
        `SELECT * FROM loans WHERE id = ANY($1)${lt.clause}`,
        [loan_ids, ...lt.params],
      );
      const loans = loansResult.rows;

      const processed = [];
      const skipped = [];

      for (const loan of loans) {
        if (loan.refund_status !== "pending") {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: `refund status ${loan.refund_status || "none"}`,
          });
          continue;
        }
        if (parseFloat(loan.overpayment_amount) <= 0) {
          skipped.push({
            id: loan.id,
            loan_code: loan.loan_code,
            reason: "no overpayment to refund",
          });
          continue;
        }

        await query(
          `UPDATE loans
             SET refund_status = 'refunded',
                 refund_method = $1,
                 refund_reference = $2,
                 refunded_date = $3,
                 updated_at = NOW()
           WHERE id = $4 AND tenant_id = $5`,
          [
            refund_method,
            refund_reference || null,
            refunded_date,
            loan.id,
            loan.tenant_id,
          ],
        );

        processed.push({ id: loan.id, loan_code: loan.loan_code });

        await logAudit({
          user: req.user,
          action: "refund_processed",
          entityType: "loan",
          entityId: loan.id,
          entityCode: loan.loan_code,
          description: `Processed refund of KES ${parseFloat(
            loan.overpayment_amount,
          ).toLocaleString()} for loan ${loan.loan_code} via ${refund_method} (bulk)`,
          newValues: { refund_method, refund_reference, refunded_date },
          req,
        });

        // Fire-and-forget customer SMS/email so the response returns
        // promptly even for large batches.
        (async () => {
          if (process.env.SMS_AUTO_CONFIRMATIONS === "true") {
            try {
              const r = await query(
                "SELECT phone_number, first_name FROM clients WHERE id = $1",
                [loan.client_id],
              );
              const c = r.rows[0];
              if (c?.phone_number) {
                const message = templates.refundProcessed(
                  c.first_name,
                  loan.overpayment_amount,
                  loan.loan_code,
                );
                const smsResult = await sendSMS(c.phone_number, message);
                await query(
                  `INSERT INTO sms_logs (client_id, loan_id, phone_number, message, message_type, status, provider_response, sent_by)
                   VALUES ($1, $2, $3, $4, 'refund_processed', $5, $6, $7)`,
                  [
                    loan.client_id,
                    loan.id,
                    c.phone_number,
                    message,
                    smsResult.success ? "sent" : "failed",
                    JSON.stringify(smsResult),
                    req.user.id,
                  ],
                );
              }
            } catch (err) {
              logger.error("Bulk refund SMS error:", err);
            }
          }
          if (
            process.env.EMAIL_ENABLED === "true" &&
            process.env.EMAIL_AUTO_CONFIRMATIONS === "true"
          ) {
            try {
              const r = await query(
                "SELECT email, first_name FROM clients WHERE id = $1",
                [loan.client_id],
              );
              const c = r.rows[0];
              if (c?.email) {
                const company = await getCompanySettings();
                const template = emailTemplates.refundProcessed({
                  clientName: c.first_name,
                  loanCode: loan.loan_code,
                  refundAmount: loan.overpayment_amount,
                  refundMethod: refund_method,
                  refundReference: refund_reference,
                  refundDate: refunded_date,
                  company,
                });
                const emailResult = await sendEmail({
                  to: c.email,
                  subject: template.subject,
                  html: template.html,
                });
                await query(
                  `INSERT INTO email_logs (client_id, loan_id, recipient_email, subject, message_type, status, provider_response, sent_by)
                   VALUES ($1, $2, $3, $4, 'refund_processed', $5, $6, $7)`,
                  [
                    loan.client_id,
                    loan.id,
                    c.email,
                    template.subject,
                    emailResult.success ? "sent" : "failed",
                    JSON.stringify(emailResult),
                    req.user.id,
                  ],
                );
              }
            } catch (err) {
              logger.error("Bulk refund email error:", err);
            }
          }
        })();
      }

      // Anything that wasn't returned by the SELECT (foreign tenant or
      // bad ids) shows up as a generic skip so the client knows the
      // totals add up.
      const seen = new Set(loans.map((l) => l.id));
      for (const id of loan_ids) {
        if (!seen.has(id)) {
          skipped.push({ id, reason: "not found" });
        }
      }

      logger.info(
        `✓ Bulk refund: ${processed.length} processed, ${skipped.length} skipped by user ${req.user.id}`,
      );

      res.json({
        success: true,
        processed: processed.length,
        skipped: skipped.length,
        details: skipped,
      });
    } catch (error) {
      logger.error("Bulk refund error:", error);
      res.status(500).json({ error: "Failed to process bulk refund" });
    }
  },
);

export default router;
