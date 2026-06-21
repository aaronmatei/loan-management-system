// Applies a confirmed welfare M-Pesa payment to its target (a contribution
// schedule, a member loan, or a penalty), posting the cash into the pool — the
// same effects as the manual flows. Idempotent via mpesa_transactions.allocated,
// so the Daraja callback and manual reconciliation can each run safely.
import { query } from "../config/database.js";
import * as mpesa from "./mpesaService.js";
import { postEventsPool } from "./welfareEventsService.js";
import { postBenefitPool } from "./welfareBenefitPoolService.js";
import { postPool as postSavingsPool } from "./welfarePoolService.js";
import { recordMemberLoanPayment } from "./memberLoanService.js";
import logger from "../config/logger.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Push a Daraja STK and record the pending welfare transaction. Shared by the
// admin M-Pesa routes (routes/welfareMpesa.js) and the member self-service
// portal (routes/portal/member.js) so both initiate identically — the only
// difference is initiatedByUserId (a staff user, or null for a member). Throws
// Error with a `.status` on validation/provider failure; returns
// { checkoutRequestId, message } on success.
export async function initiateWelfareSTK({
  welfare,
  member,
  amount,
  targetType,
  targetId,
  purpose,
  desc,
  phone,
  initiatedByUserId = null,
}) {
  const payPhone = phone || member.phone_number;
  if (!payPhone) throw Object.assign(new Error("No phone number for this member"), { status: 400 });
  if (!(amount > 0)) throw Object.assign(new Error("Nothing outstanding to pay"), { status: 400 });

  const ref = (member.member_no || `M${member.id}`).substring(0, 12);
  let result;
  try {
    result = await mpesa.initiateSTKPush({
      phone: payPhone,
      amount,
      accountReference: ref,
      transactionDesc: desc,
    });
  } catch (err) {
    logger.error("welfare STK error:", err.message);
    throw Object.assign(new Error(err.message || "M-Pesa is not available right now"), { status: 502 });
  }

  await query(
    `INSERT INTO mpesa_transactions (
       tenant_id, purpose, welfare_id, member_id, target_type, target_id,
       initiated_by_user_id, phone_number, amount, account_reference, transaction_desc,
       merchant_request_id, checkout_request_id, status, request_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)`,
    [
      welfare.tenant_id, purpose, welfare.id, member.id, targetType, targetId,
      initiatedByUserId, result.normalizedPhone, result.amount, ref, desc,
      result.merchantRequestId, result.checkoutRequestId, JSON.stringify(result.raw),
    ],
  );
  return {
    checkoutRequestId: result.checkoutRequestId,
    message: result.customerMessage || "STK sent — enter the M-Pesa PIN",
  };
}

// M-Pesa receipts are always pool INCOME (direction +1). Delegate to the single
// canonical, atomic, race-safe savings-pool writer instead of duplicating the
// ledger insert here (this used to hardcode the balance math independently).
async function postPool(tx, type, amount, description) {
  await postSavingsPool({
    welfare: { id: tx.welfare_id, tenant_id: tx.tenant_id },
    memberId: tx.member_id, type, amount, direction: 1,
    description, userId: tx.initiated_by_user_id || null,
  });
}

// Apply a successful welfare M-Pesa transaction. `cb` is the parsed callback
// (we trust cb.amount as the amount actually paid; fall back to the requested).
export async function allocateWelfarePayment(tx, cb = {}) {
  if (tx.allocated) return { applied: false, reason: "already allocated" };
  const paid = round2(cb.amount != null ? Number(cb.amount) : Number(tx.amount));
  if (!(paid > 0)) return { applied: false, reason: "no amount" };

  let applied = false;
  if (tx.target_type === "contribution_schedule") {
    const s = (await query(`SELECT s.*, c.pool_key, c.name AS cycle_name FROM contribution_schedules s JOIN contribution_cycles c ON c.id=s.cycle_id WHERE s.id = $1`, [tx.target_id])).rows[0];
    if (s) {
      const amt = Math.min(paid, round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(s.amount_paid) + amt);
        const status = newPaid >= parseFloat(s.amount_due) ? "paid" : "partial";
        await query(
          `UPDATE contribution_schedules
              SET amount_paid=$2, status=$3,
                  paid_at = CASE WHEN $4 AND paid_at IS NULL THEN NOW() ELSE paid_at END,
                  updated_at=NOW()
            WHERE id=$1`,
          [s.id, newPaid, status, status === "paid"],
        );
        // Route to the cycle's pool — benefit cycles don't touch the savings pool.
        if (s.pool_key && s.pool_key !== "savings") {
          await postBenefitPool({ welfare: { id: tx.welfare_id, tenant_id: tx.tenant_id }, poolKey: s.pool_key, memberId: tx.member_id, type: "contribution", cycleId: s.cycle_id, amount: amt, direction: 1, description: `Contribution via M-Pesa (${tx.mpesa_receipt_number || "STK"})` });
        } else {
          await postPool(tx, "contribution", amt, `Contribution via M-Pesa (${tx.mpesa_receipt_number || "STK"})`);
        }
        applied = true;
      }
    }
  } else if (tx.target_type === "member_loan") {
    const l = (await query(`SELECT * FROM member_loans WHERE id = $1`, [tx.target_id])).rows[0];
    if (l && ["active", "defaulted"].includes(l.status)) {
      // Single allocation path: penalty → interest → principal, posting the
      // split to the pool. cap:true so an STK over-payment applies what's owed
      // instead of rejecting.
      const r = await recordMemberLoanPayment({
        welfare: { id: tx.welfare_id, tenant_id: tx.tenant_id }, loan: l, amount: paid,
        paymentDate: tx.txn_date, method: "mpesa", reference: tx.mpesa_receipt_number, userId: tx.initiated_by_user_id, cap: true,
      });
      const a = r.allocation;
      if (a.penalty + a.interest + a.principal > 0) applied = true;
    }
  } else if (tx.target_type === "penalty_assessment") {
    const a = (await query(`SELECT * FROM penalty_assessments WHERE id = $1`, [tx.target_id])).rows[0];
    if (a && a.status === "outstanding") {
      const amt = Math.min(paid, round2(parseFloat(a.amount) - parseFloat(a.paid_amount)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(a.paid_amount) + amt);
        const status = newPaid >= parseFloat(a.amount) ? "paid" : "outstanding";
        await query(`UPDATE penalty_assessments SET paid_amount=$2, status=$3 WHERE id=$1`, [a.id, newPaid, status]);
        await postPool(tx, "penalty", amt, `Penalty via M-Pesa (${tx.mpesa_receipt_number || "STK"})`);
        applied = true;
      }
    }
  } else if (tx.target_type === "welfare_event_share") {
    // Event shares fund the SEPARATE events pool, not savings — route to the
    // events ledger, not postPool.
    const s = (await query(`SELECT * FROM welfare_event_shares WHERE id = $1`, [tx.target_id])).rows[0];
    if (s && s.status !== "paid") {
      const amt = Math.min(paid, round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(s.amount_paid) + amt);
        const status = newPaid >= parseFloat(s.amount_due) ? "paid" : "partial";
        await query(`UPDATE welfare_event_shares SET amount_paid=$2, status=$3, updated_at=NOW() WHERE id=$1`, [s.id, newPaid, status]);
        await postEventsPool({
          welfare: { id: tx.welfare_id, tenant_id: tx.tenant_id }, eventId: s.event_id, memberId: tx.member_id,
          type: "contribution", amount: amt, direction: 1,
          description: `Event share via M-Pesa (${tx.mpesa_receipt_number || "STK"})`,
        });
        applied = true;
      }
    }
  }

  await query(`UPDATE mpesa_transactions SET allocated = true, updated_at = NOW() WHERE id = $1`, [tx.id]);
  return { applied, amount: paid };
}

export default { allocateWelfarePayment };
