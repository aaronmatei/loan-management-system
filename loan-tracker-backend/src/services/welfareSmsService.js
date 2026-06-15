// Welfare/chama SMS. Messages are branded with the chama's own name (not the
// platform COMPANY_NAME) since each welfare is its own group. Reuses the shared
// Africa's Talking sendSMS + sms_logs table. All sends are best-effort: SMS is a
// side-effect of money/meeting events and must never break the primary action.
import { query } from "../config/database.js";
import { sendSMS } from "./smsService.js";
import logger from "../config/logger.js";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE");
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "");

export const welfareTemplates = {
  contributionDue: (name, welfare, amount, dueDate) =>
    `Hi ${name}, your ${welfare} contribution of ${money(amount)} is due ${fmtDate(dueDate)}. Kindly pay on time to avoid penalties.`,

  contributionReceipt: (name, welfare, amount, savings) =>
    `Hi ${name}, ${welfare} has received your contribution of ${money(amount)}. Total savings: ${money(savings)}. Thank you!`,

  loanRepaymentReceipt: (name, welfare, amount, balance) =>
    `Hi ${name}, ${welfare} has received your loan repayment of ${money(amount)}. Loan balance: ${money(balance)}. Thank you!`,

  penaltyNotice: (name, welfare, amount, reason) =>
    `Hi ${name}, a penalty of ${money(amount)} has been applied to your ${welfare} account${reason ? ` (${reason})` : ""}. Kindly clear it at the next meeting.`,

  penaltyReceipt: (name, welfare, amount) =>
    `Hi ${name}, ${welfare} has received your penalty payment of ${money(amount)}. Thank you.`,

  withdrawalReceipt: (name, welfare, amount, savings) =>
    `Hi ${name}, ${welfare} has paid out ${money(amount)} from your savings. Remaining savings: ${money(savings)}.`,

  memberExit: (name, welfare, payout) =>
    `Hi ${name}, your ${welfare} membership has been closed and your net savings of ${money(payout)} paid out. Thank you for being a member.`,

  meetingReminder: (name, welfare, title, date, location) =>
    `Hi ${name}, reminder: ${welfare} ${title || "meeting"} on ${fmtDate(date)}${location ? ` at ${location}` : ""}. Your attendance is expected.`,

  broadcast: (welfare, message) => `${welfare}: ${message}`,
};

// Send to one member and log it (client_id stays null — welfare members aren't
// clients). Never throws; returns the provider result.
export async function sendWelfareSms({ tenantId, phone, message, type = "welfare_custom", sentBy = null }) {
  if (!phone) return { success: false, error: "No phone number" };
  let result;
  try {
    result = await sendSMS(phone, message);
  } catch (e) {
    result = { success: false, error: e.message };
  }
  try {
    await query(
      `INSERT INTO sms_logs (tenant_id, client_id, phone_number, message, message_type, status, provider_response, sent_by)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
      [tenantId, phone, message, type, result.success ? "sent" : "failed", JSON.stringify(result), sentBy],
    );
  } catch (e) {
    logger.error("welfare SMS log error:", e.message);
  }
  return result;
}

// Net savings = contribution/withdrawal/dividend/adjustment (matches members route).
const SAVINGS_TYPES = "('contribution','withdrawal','dividend','adjustment')";

async function loadMember(welfareId, memberId) {
  const r = await query(`SELECT id, first_name, last_name, phone_number FROM members WHERE id = $1 AND welfare_id = $2`, [memberId, welfareId]);
  return r.rows[0] || null;
}

// Fire-and-forget contribution receipt (after a contribution is recorded).
export async function notifyContributionReceipt({ welfare, memberId, amount, sentBy = null }) {
  try {
    const m = await loadMember(welfare.id, memberId);
    if (!m?.phone_number) return;
    const savings = parseFloat(
      (await query(`SELECT COALESCE(SUM(direction * amount),0) AS s FROM member_pool_transactions WHERE member_id = $1 AND type IN ${SAVINGS_TYPES}`, [memberId])).rows[0].s,
    );
    await sendWelfareSms({ tenantId: welfare.tenant_id, phone: m.phone_number, message: welfareTemplates.contributionReceipt(m.first_name, welfare.name, amount, savings), type: "welfare_contribution_receipt", sentBy });
  } catch (e) {
    logger.error("contribution receipt SMS error:", e.message);
  }
}

// Fire-and-forget penalty notice (after a penalty is assessed).
export async function notifyPenalty({ welfare, member, amount, reason, sentBy = null }) {
  try {
    if (!member?.phone_number) return;
    await sendWelfareSms({ tenantId: welfare.tenant_id, phone: member.phone_number, message: welfareTemplates.penaltyNotice(member.first_name, welfare.name, amount, reason), type: "welfare_penalty_notice", sentBy });
  } catch (e) {
    logger.error("penalty notice SMS error:", e.message);
  }
}

// Fire-and-forget withdrawal/exit receipt.
export async function notifyWithdrawal({ welfare, member, amount, savings, exited = false, sentBy = null }) {
  try {
    if (!member?.phone_number) return;
    const msg = exited
      ? welfareTemplates.memberExit(member.first_name, welfare.name, amount)
      : welfareTemplates.withdrawalReceipt(member.first_name, welfare.name, amount, savings);
    await sendWelfareSms({ tenantId: welfare.tenant_id, phone: member.phone_number, message: msg, type: exited ? "welfare_member_exit" : "welfare_withdrawal_receipt", sentBy });
  } catch (e) {
    logger.error("withdrawal receipt SMS error:", e.message);
  }
}

export default { welfareTemplates, sendWelfareSms, notifyContributionReceipt, notifyPenalty, notifyWithdrawal };
