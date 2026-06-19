// Benefit pools — the ledger for contributions that pay out to a member
// beneficiary (quarterly dowry, one-off emergencies), kept SEPARATE from the
// savings pool (member_pool_transactions) so member equity is never touched.
// Each pool is identified by a pool_key per welfare:
//   'savings'      → NOT here; that's the savings pool (monthly).
//   'plan-<id>'    → a recurring benefit plan (e.g. Quarterly).
//   'oneoff'       → the shared pool for all one-off emergencies.
import { query } from "../config/database.js";

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// The pool a plan's cycles collect into.
export function poolKeyForPlan(plan) {
  return plan?.pool_kind === "benefit" ? `plan-${plan.id}` : "savings";
}

export async function benefitPoolBalance(welfareId, poolKey) {
  const r = await query(
    `SELECT balance_after FROM benefit_pool_ledger WHERE welfare_id=$1 AND pool_key=$2 ORDER BY id DESC LIMIT 1`,
    [welfareId, poolKey],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// Append a benefit-pool ledger row, carrying the running balance forward. The
// ONLY place balance_after is computed for benefit pools.
export async function postBenefitPool({ welfare, poolKey, memberId, type, cycleId, meetingId, amount, direction, txnDate, description, userId }) {
  const prev = await benefitPoolBalance(welfare.id, poolKey);
  const balanceAfter = round2(prev + direction * amount);
  const r = await query(
    `INSERT INTO benefit_pool_ledger
       (tenant_id, welfare_id, pool_key, member_id, type, cycle_id, meeting_id, amount, direction, balance_after, txn_date, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::date, CURRENT_DATE),$12,$13)
     RETURNING *`,
    [welfare.tenant_id, welfare.id, poolKey, memberId || null, type, cycleId || null, meetingId || null, amount, direction, balanceAfter, txnDate || null, description || null, userId || null],
  );
  return r.rows[0];
}

// Disburse a lump sum from a benefit pool to a member beneficiary. May be linked
// to the gathering (meeting) where it was handed out.
export async function recordPayout({ welfare, poolKey, beneficiaryId, amount, cycleId, meetingId, txnDate, description, userId }) {
  const amt = round2(parseFloat(amount));
  if (!(amt > 0)) throw Object.assign(new Error("Payout amount must be positive"), { status: 400 });
  if (!beneficiaryId) throw Object.assign(new Error("A beneficiary is required"), { status: 400 });
  const ledger = await postBenefitPool({
    welfare, poolKey, memberId: beneficiaryId, type: "payout", cycleId, meetingId,
    amount: amt, direction: -1, txnDate, description: description || "Benefit payout", userId,
  });
  return { ledger, balance: await benefitPoolBalance(welfare.id, poolKey) };
}

// A pool's payouts (most recent first) with beneficiary + the linked gathering's
// attendance, if any.
export async function poolPayouts(welfareId, poolKey) {
  return (await query(
    `SELECT l.id, l.amount, l.txn_date, l.description, l.cycle_id, l.member_id AS beneficiary_id,
            m.first_name, m.last_name, l.meeting_id, gm.title AS meeting_title, gm.meeting_date,
            (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=l.meeting_id AND a.status IN ('present','late'))::int AS attended,
            (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=l.meeting_id)::int AS recorded
       FROM benefit_pool_ledger l
       LEFT JOIN members m ON m.id = l.member_id
       LEFT JOIN group_meetings gm ON gm.id = l.meeting_id
      WHERE l.welfare_id=$1 AND l.pool_key=$2 AND l.type='payout'
      ORDER BY l.txn_date DESC, l.id DESC`,
    [welfareId, poolKey],
  )).rows;
}
