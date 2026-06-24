// Books of Accounts for a welfare/chama — derived from the pool ledger
// (member_pool_transactions), member loans and the benefit/events fund, on a
// cash basis. Reuses buildSummary's definitions so figures reconcile with the
// dashboard. Because loan_repayment carries PRINCIPAL only and interest posts as
// its own loan_interest row, the statements balance EXACTLY:
//
//   members_savings      = Σ dir·amount over (contribution, withdrawal, adjustment)
//   outstanding_principal= Σ loan_disbursed − Σ loan_repayment
//   accumulated_surplus  = loan_interest + fines − expenses − dividends
//   ⇒ pool_cash + outstanding_principal ≡ members_savings + accumulated_surplus
//
// Financial-year scoping: when a `year` is given, the performance statements
// (Income & Expenditure, Receipts & Payments) cover that calendar year, and the
// position statements (Balance Sheet, Trial Balance) are AS AT that year-end
// with opening balances brought forward. With no year → all-time.
import { query } from "../config/database.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The per-type breakdown of a set of pool rows. Reused for the period window and
// the as-at-end (cumulative) window.
const TYPE_SUMS = `
  COALESCE(SUM(direction*amount) FILTER (WHERE type IN ('contribution','withdrawal','adjustment')),0) AS savings,
  COALESCE(SUM(direction*amount),0) AS pool_cash,
  COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS contributions,
  COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS withdrawals,
  COALESCE(SUM(amount) FILTER (WHERE type='adjustment' AND direction=1),0)  AS adj_in,
  COALESCE(SUM(amount) FILTER (WHERE type='adjustment' AND direction=-1),0) AS adj_out,
  COALESCE(SUM(amount) FILTER (WHERE type='loan_disbursed'),0)  AS loan_disbursed,
  COALESCE(SUM(amount) FILTER (WHERE type='loan_repayment'),0)  AS loan_principal_repaid,
  COALESCE(SUM(amount) FILTER (WHERE type='loan_interest'),0)   AS loan_interest,
  COALESCE(SUM(direction*amount) FILTER (WHERE type IN ('penalty','loan_penalty')),0) AS fines,
  COALESCE(SUM(amount) FILTER (WHERE type='expense'),0)  AS expenses,
  COALESCE(SUM(amount) FILTER (WHERE type='dividend'),0) AS dividends`;

export async function computeWelfareBooks(welfareId, { year } = {}) {
  const y = parseInt(year, 10);
  const scoped = Number.isInteger(y);
  const start = scoped ? `${y}-01-01` : null;
  const end = scoped ? `${y}-12-31` : null;

  // Performance window (this year, or all-time) and position window (as-at year-end).
  const period = scoped
    ? await sums(`welfare_id=$1 AND txn_date BETWEEN $2 AND $3`, [welfareId, start, end])
    : await sums(`welfare_id=$1`, [welfareId]);
  const asAt = scoped
    ? await sums(`welfare_id=$1 AND txn_date <= $2`, [welfareId, end])
    : period;

  const opening = scoped
    ? round2((await query(`SELECT COALESCE(SUM(direction*amount),0) AS b FROM member_pool_transactions WHERE welfare_id=$1 AND txn_date < $2`, [welfareId, start])).rows[0].b)
    : 0;

  // Benefit/events fund as at the period end (latest balance per pool key).
  const benefit = round2((await query(
    `SELECT COALESCE(SUM(bal),0) AS total FROM (
       SELECT DISTINCT ON (pool_key) balance_after AS bal
         FROM benefit_pool_ledger WHERE welfare_id=$1 ${scoped ? "AND txn_date <= $2" : ""}
        ORDER BY pool_key, id DESC) t`,
    scoped ? [welfareId, end] : [welfareId],
  )).rows[0].total);

  const years = (await query(
    `SELECT DISTINCT EXTRACT(YEAR FROM txn_date)::int AS y FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY y DESC`,
    [welfareId],
  )).rows.map((r) => r.y);

  // Member loan portfolio (current snapshot).
  const port = (await query(
    `SELECT status, COUNT(*)::int AS n,
            COALESCE(SUM(principal),0)::float AS principal,
            COALESCE(SUM(total_amount_due - amount_paid),0)::float AS outstanding
       FROM member_loans WHERE member_id IN (SELECT id FROM members WHERE welfare_id=$1)
      GROUP BY status`,
    [welfareId],
  )).rows;
  const byStatus = Object.fromEntries(port.map((r) => [r.status, { count: r.n, principal: round2(r.principal), outstanding: round2(r.outstanding) }]));

  // Position figures (as at end).
  const poolCash = asAt.pool_cash;
  const savings = asAt.savings;
  const outstandingPrincipal = round2(asAt.loan_disbursed - asAt.loan_principal_repaid);
  const accumulatedSurplus = round2(asAt.loan_interest + asAt.fines - asAt.expenses - asAt.dividends);

  // Performance figures (the period).
  const totalReceipts = round2(period.contributions + period.loan_principal_repaid + period.loan_interest + period.fines + period.adj_in);
  const totalPayments = round2(period.withdrawals + period.loan_disbursed + period.dividends + period.expenses + period.adj_out);

  return {
    period: { year: scoped ? y : null, label: scoped ? `FY ${y}` : "All time", available_years: years },
    receipts_payments: {
      opening_balance: opening,
      receipts: [
        { label: "Member contributions", amount: period.contributions },
        { label: "Loan principal repaid", amount: period.loan_principal_repaid },
        { label: "Loan interest", amount: period.loan_interest },
        { label: "Fines / penalties", amount: period.fines },
        ...(period.adj_in ? [{ label: "Adjustments in", amount: period.adj_in }] : []),
      ],
      payments: [
        { label: "Member withdrawals", amount: period.withdrawals },
        { label: "Loans disbursed", amount: period.loan_disbursed },
        { label: "Dividends paid", amount: period.dividends },
        { label: "Expenses", amount: period.expenses },
        ...(period.adj_out ? [{ label: "Adjustments out", amount: period.adj_out }] : []),
      ],
      total_receipts: totalReceipts,
      total_payments: totalPayments,
      closing_balance: round2(opening + totalReceipts - totalPayments),
    },
    income_expenditure: {
      income: { loan_interest: period.loan_interest, fines: period.fines, total: round2(period.loan_interest + period.fines) },
      expenditure: { expenses: period.expenses, total: period.expenses },
      surplus: round2(period.loan_interest + period.fines - period.expenses),
      dividends_appropriated: period.dividends,
      accumulated_surplus: accumulatedSurplus, // cumulative, as at end
    },
    balance_sheet: {
      assets: { pool_cash: poolCash, member_loans_receivable: outstandingPrincipal, benefit_fund_cash: benefit, total: round2(poolCash + outstandingPrincipal + benefit) },
      members_funds: { members_savings: savings, accumulated_surplus: accumulatedSurplus, benefit_fund: benefit, total: round2(savings + accumulatedSurplus + benefit) },
    },
    trial_balance: {
      debits: [
        { account: "Pool cash", amount: poolCash },
        { account: "Member loans receivable", amount: outstandingPrincipal },
        { account: "Benefit / events fund cash", amount: benefit },
        { account: "Expenses (cumulative)", amount: asAt.expenses },
        { account: "Dividends paid (cumulative)", amount: asAt.dividends },
      ],
      credits: [
        { account: "Members' savings", amount: savings },
        { account: "Loan interest income (cumulative)", amount: asAt.loan_interest },
        { account: "Fines income (cumulative)", amount: asAt.fines },
        { account: "Benefit / events fund", amount: benefit },
      ],
      debit_total: round2(poolCash + outstandingPrincipal + benefit + asAt.expenses + asAt.dividends),
      credit_total: round2(savings + asAt.loan_interest + asAt.fines + benefit),
    },
    loan_portfolio: { by_status: byStatus },
  };
}

// Run the TYPE_SUMS breakdown over a window, returning rounded numbers.
async function sums(where, params) {
  const r = (await query(`SELECT ${TYPE_SUMS} FROM member_pool_transactions WHERE ${where}`, params)).rows[0];
  const out = {};
  for (const k of Object.keys(r)) out[k] = round2(r[k]);
  return out;
}
