// Shared welfare-pool helpers — the single source of truth for reading the
// pool/savings ledger, used by both the admin members routes (routes/members.js)
// and the member self-service portal (routes/portal/member.js). The pool's
// running balance (member_pool_transactions.balance_after) must only ever be
// computed one way, so keep these here rather than duplicating per route.
// (Phase D will add the write helpers — issueMemberLoan / recordWithdrawal — so
// the admin and approval paths post to the pool identically.)
import { query, withTransaction } from "../config/database.js";

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

// Append a row to the pool ledger, carrying the running balance forward. The
// ONLY place balance_after is computed — every contribution/withdrawal/loan
// movement goes through here.
// Atomic + serialized per welfare: the advisory lock blocks any concurrent post
// for this pool until the transaction commits, so two simultaneous movements
// can't read the same prior balance and clobber balance_after. Runs on the
// given transaction client.
async function postPoolTx(client, { welfare, memberId, type, amount, direction, loanId, txnDate, description, userId }) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`welfare-pool-${welfare.id}`]);
  const prevRow = await client.query(
    `SELECT balance_after FROM member_pool_transactions WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfare.id],
  );
  const prev = prevRow.rows.length ? parseFloat(prevRow.rows[0].balance_after) : 0;
  const balanceAfter = round2(prev + direction * amount);
  const r = await client.query(
    `INSERT INTO member_pool_transactions
       (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, member_loan_id, txn_date, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),$10,$11)
     RETURNING *`,
    [
      welfare.tenant_id, welfare.id, memberId || null, type, amount, direction,
      balanceAfter, loanId || null, txnDate || null, description || null, userId || null,
    ],
  );
  return r.rows[0];
}

// Post a pool movement. Pass `client` to join a caller's transaction so an
// entire money operation (disburse / repayment) commits atomically; omit it to
// run as its own standalone transaction.
export async function postPool(args) {
  return args.client
    ? postPoolTx(args.client, args)
    : withTransaction((client) => postPoolTx(client, args));
}

// Issue a loan from the welfare pool to a member (flat interest, single bullet).
// Shared by the admin issue endpoint and the member loan-request approval.
// Throws Error{status:400} if the pool can't cover the principal.
export async function issueMemberLoan({ welfare, member, principal, rate, months, notes, userId }) {
  const pool = await poolBalance(welfare.id);
  if (principal > pool) {
    throw Object.assign(
      new Error(`Pool only holds KES ${pool.toLocaleString()} — can't lend KES ${principal.toLocaleString()}`),
      { status: 400 },
    );
  }
  const interest = round2(principal * (rate / 100) * (months / 12));
  const totalDue = round2(principal + interest);
  const countRes = await query(`SELECT COUNT(*)::int AS n FROM member_loans WHERE tenant_id = $1`, [welfare.tenant_id]);
  const loanCode = `MBL-${String(countRes.rows[0].n + 1).padStart(5, "0")}`;
  const due = new Date();
  due.setMonth(due.getMonth() + months);
  const dueISO = due.toISOString().split("T")[0];

  const loanRes = await query(
    `INSERT INTO member_loans
       (tenant_id, member_id, loan_code, principal, interest_rate, duration_months,
        total_interest, total_amount_due, status, disbursed_at, due_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW(),$9::date,$10,$11) RETURNING *`,
    [welfare.tenant_id, member.id, loanCode, principal, rate, months, interest, totalDue, dueISO, notes || null, userId || null],
  );
  const loan = loanRes.rows[0];
  const poolTxn = await postPool({
    welfare, memberId: member.id, type: "loan_disbursed", amount: principal, direction: -1,
    loanId: loan.id, description: `Loan ${loanCode} to ${member.first_name} ${member.last_name}`, userId,
  });
  return { loan, poolTxn };
}

// Pay a member's savings out of the pool. Validates amount > 0, within savings,
// and within the pool. Throws Error{status:400} on any breach. Shared by the
// admin withdrawal endpoint and the member withdrawal-request approval.
export async function recordWithdrawal({ welfare, member, amount, txnDate, description, userId }) {
  const amt = round2(parseFloat(amount));
  if (!(amt > 0)) throw Object.assign(new Error("Amount must be positive"), { status: 400 });
  const savings = await memberSavings(member.id);
  if (amt > savings) {
    throw Object.assign(new Error(`Member only has KES ${savings.toLocaleString()} in savings`), { status: 400 });
  }
  const pool = await poolBalance(welfare.id);
  if (amt > pool) {
    throw Object.assign(new Error(`Pool only holds KES ${pool.toLocaleString()}`), { status: 400 });
  }
  const poolTxn = await postPool({
    welfare, memberId: member.id, type: "withdrawal", amount: amt, direction: -1,
    txnDate, description, userId,
  });
  return { poolTxn, savingsAfter: await memberSavings(member.id) };
}
