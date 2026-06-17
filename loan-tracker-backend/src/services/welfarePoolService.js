// Shared welfare-pool helpers — the single source of truth for reading the
// pool/savings ledger, used by both the admin members routes (routes/members.js)
// and the member self-service portal (routes/portal/member.js). The pool's
// running balance (member_pool_transactions.balance_after) must only ever be
// computed one way, so keep these here rather than duplicating per route.
// (Phase D will add the write helpers — issueMemberLoan / recordWithdrawal — so
// the admin and approval paths post to the pool identically.)
import { query } from "../config/database.js";

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Savings principal = contributions net of withdrawals/adjustments. Dividends
// are profit PAID OUT of the pool (migration 063), not savings, so excluded.
export const SAVINGS_TYPES = "('contribution','withdrawal','adjustment')";

// The welfare pool's current balance (last ledger row's running balance).
export async function poolBalance(welfareId) {
  const r = await query(
    `SELECT balance_after FROM member_pool_transactions
      WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfareId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// One member's savings balance (net of their savings-type ledger rows).
export async function memberSavings(memberId) {
  const r = await query(
    `SELECT COALESCE(SUM(direction * amount), 0) AS bal
       FROM member_pool_transactions
      WHERE member_id = $1 AND type IN ${SAVINGS_TYPES}`,
    [memberId],
  );
  return parseFloat(r.rows[0].bal);
}
