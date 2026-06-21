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
import { query } from "../config/database.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function computeWelfareBooks(welfareId) {
  const sums = (await query(
    `SELECT
       COALESCE(SUM(direction*amount) FILTER (WHERE type IN ('contribution','withdrawal','adjustment')),0) AS savings,
       COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS contributions,
       COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS withdrawals,
       COALESCE(SUM(amount) FILTER (WHERE type='adjustment' AND direction=1),0)  AS adj_in,
       COALESCE(SUM(amount) FILTER (WHERE type='adjustment' AND direction=-1),0) AS adj_out,
       COALESCE(SUM(amount) FILTER (WHERE type='loan_disbursed'),0)  AS loan_disbursed,
       COALESCE(SUM(amount) FILTER (WHERE type='loan_repayment'),0)  AS loan_principal_repaid,
       COALESCE(SUM(amount) FILTER (WHERE type='loan_interest'),0)   AS loan_interest,
       COALESCE(SUM(amount) FILTER (WHERE type IN ('penalty','loan_penalty')),0) AS fines,
       COALESCE(SUM(amount) FILTER (WHERE type='expense'),0)  AS expenses,
       COALESCE(SUM(amount) FILTER (WHERE type='dividend'),0) AS dividends
     FROM member_pool_transactions WHERE welfare_id=$1`,
    [welfareId],
  )).rows[0];

  const poolRow = (await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1`, [welfareId])).rows[0];
  const poolCash = poolRow ? round2(poolRow.balance_after) : 0;

  // Benefit/events fund = sum of the latest running balance across pool keys.
  const benefit = round2((await query(
    `SELECT COALESCE(SUM(bal),0) AS total FROM (
       SELECT DISTINCT ON (pool_key) balance_after AS bal
         FROM benefit_pool_ledger WHERE welfare_id=$1 ORDER BY pool_key, id DESC) t`,
    [welfareId],
  )).rows[0].total);

  const savings = round2(sums.savings);
  const contributions = round2(sums.contributions);
  const withdrawals = round2(sums.withdrawals);
  const loanDisbursed = round2(sums.loan_disbursed);
  const loanPrincipalRepaid = round2(sums.loan_principal_repaid);
  const loanInterest = round2(sums.loan_interest);
  const fines = round2(sums.fines);
  const expenses = round2(sums.expenses);
  const dividends = round2(sums.dividends);
  const adjIn = round2(sums.adj_in), adjOut = round2(sums.adj_out);

  const outstandingPrincipal = round2(loanDisbursed - loanPrincipalRepaid);
  const accumulatedSurplus = round2(loanInterest + fines - expenses - dividends);

  // Member loan portfolio.
  const port = (await query(
    `SELECT status, COUNT(*)::int AS n,
            COALESCE(SUM(principal),0)::float AS principal,
            COALESCE(SUM(total_amount_due - amount_paid),0)::float AS outstanding
       FROM member_loans WHERE member_id IN (SELECT id FROM members WHERE welfare_id=$1)
      GROUP BY status`,
    [welfareId],
  )).rows;
  const byStatus = Object.fromEntries(port.map((r) => [r.status, { count: r.n, principal: round2(r.principal), outstanding: round2(r.outstanding) }]));

  const totalReceipts = round2(contributions + loanPrincipalRepaid + loanInterest + fines + adjIn);
  const totalPayments = round2(withdrawals + loanDisbursed + dividends + expenses + adjOut);

  return {
    // Receipts & Payments (cash book of the savings pool)
    receipts_payments: {
      receipts: [
        { label: "Member contributions", amount: contributions },
        { label: "Loan principal repaid", amount: loanPrincipalRepaid },
        { label: "Loan interest", amount: loanInterest },
        { label: "Fines / penalties", amount: fines },
        ...(adjIn ? [{ label: "Adjustments in", amount: adjIn }] : []),
      ],
      payments: [
        { label: "Member withdrawals", amount: withdrawals },
        { label: "Loans disbursed", amount: loanDisbursed },
        { label: "Dividends paid", amount: dividends },
        { label: "Expenses", amount: expenses },
        ...(adjOut ? [{ label: "Adjustments out", amount: adjOut }] : []),
      ],
      total_receipts: totalReceipts,
      total_payments: totalPayments,
      closing_balance: poolCash,
    },
    // Income & Expenditure (a chama is mutual — surplus, not "profit")
    income_expenditure: {
      income: { loan_interest: loanInterest, fines, total: round2(loanInterest + fines) },
      expenditure: { expenses, total: expenses },
      surplus: round2(loanInterest + fines - expenses),
      dividends_appropriated: dividends, // distribution of surplus to members
      accumulated_surplus: accumulatedSurplus,
    },
    // Balance Sheet / Statement of Affairs — balances exactly
    balance_sheet: {
      assets: { pool_cash: poolCash, member_loans_receivable: outstandingPrincipal, benefit_fund_cash: benefit, total: round2(poolCash + outstandingPrincipal + benefit) },
      members_funds: { members_savings: savings, accumulated_surplus: accumulatedSurplus, benefit_fund: benefit, total: round2(savings + accumulatedSurplus + benefit) },
    },
    // Trial balance — debits == credits
    trial_balance: {
      debits: [
        { account: "Pool cash", amount: poolCash },
        { account: "Member loans receivable", amount: outstandingPrincipal },
        { account: "Benefit / events fund cash", amount: benefit },
        { account: "Expenses", amount: expenses },
        { account: "Dividends paid", amount: dividends },
      ],
      credits: [
        { account: "Members' savings", amount: savings },
        { account: "Loan interest income", amount: loanInterest },
        { account: "Fines income", amount: fines },
        { account: "Benefit / events fund", amount: benefit },
      ],
      debit_total: round2(poolCash + outstandingPrincipal + benefit + expenses + dividends),
      credit_total: round2(savings + loanInterest + fines + benefit),
    },
    loan_portfolio: { by_status: byStatus },
  };
}
