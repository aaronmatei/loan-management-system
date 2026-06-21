// Books of Accounts for a lender tenant — derived from the existing ledgers
// (capital_pool, loans, transactions, payment_schedules, expenses, loan_waivers)
// on a cash basis, reusing the SAME formulas as routes/capital.js so every
// figure reconciles with the capital dashboard. The accounting identity that
// makes the statements balance exactly:
//
//   available_pool          = initial − disbursed + collected + interest − expenses
//   outstanding_principal   = (disbursed − collected) − principal_written_off
//   net_profit_lifetime     = interest − expenses − principal_written_off
//   ⇒ available_pool + outstanding_principal ≡ initial_capital + net_profit_lifetime
//
// (capital.js is the source of truth for these formulas — keep them in sync.)
import { query } from "../config/database.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function computeLenderBooks(tid) {
  const pool = (await query(`SELECT * FROM capital_pool WHERE tenant_id = $1`, [tid])).rows[0];
  if (!pool) return null;

  const initial = round2(pool.initial_capital);
  const disbursed = round2(pool.total_disbursed);
  const collected = round2(pool.total_collected);
  const interest = round2(pool.total_interest_earned); // gross income kept: loan interest + fees + penalties

  // Income decomposition + operating expenses (same queries as capital.js).
  const breakdown = (await query(
    `SELECT
       COALESCE((
         SELECT SUM(LEAST(LEAST(ps.amount_paid, ps.amount_due),
                          GREATEST(0, COALESCE(ps.interest_portion,0) - COALESCE(ps.interest_paid,0))))
           FROM payment_schedules ps JOIN loans l2 ON l2.id = ps.loan_id
          WHERE l2.tenant_id = $1 AND l2.status IN ('active','completed','defaulted')), 0)::float AS loan_interest,
       (SELECT COALESCE(SUM(COALESCE(t.penalty_portion,0)),0)::float FROM transactions t
         WHERE t.tenant_id = $1 AND t.payment_status = 'completed' AND t.voided_at IS NULL) AS fines,
       (SELECT COALESCE(SUM(processing_fee),0)::float FROM loans
         WHERE tenant_id = $1 AND status IN ('active','completed','defaulted')) AS fees,
       (SELECT COALESCE(SUM(amount),0)::float FROM expenses WHERE tenant_id = $1) AS expenses`,
    [tid],
  )).rows[0];
  const loanInterest = round2(breakdown.loan_interest);
  const fines = round2(breakdown.fines);
  const fees = round2(breakdown.fees);
  const expenses = round2(breakdown.expenses);

  // Principal written off via approved waivers (verbatim from capital.js).
  const writeOff = (await query(
    `SELECT COALESCE(SUM(
       COALESCE((w.allocation->>'principal_total')::float,
         COALESCE((w.allocation->>'amount_total')::float,0)
           * GREATEST(0, l.total_amount_due - COALESCE(l.total_interest,0)) / NULLIF(l.total_amount_due,0))
     ),0)::float AS p
     FROM loan_waivers w JOIN loans l ON l.id = w.loan_id
    WHERE l.tenant_id = $1 AND w.status = 'approved'`,
    [tid],
  )).rows[0];
  const principalWrittenOff = round2(writeOff.p);

  const available = round2(initial - disbursed + collected + interest - expenses);
  const outstandingPrincipal = round2(disbursed - collected - principalWrittenOff);
  const netProfit = round2(interest - expenses - principalWrittenOff);

  // Loan portfolio by status + a simple PAR (defaulted share of outstanding).
  const port = (await query(
    `SELECT l.status,
            COUNT(*)::int AS n,
            COALESCE(SUM(l.principal_amount),0)::float AS principal,
            COALESCE(SUM(l.total_amount_due - COALESCE(p.amt,0)),0)::float AS outstanding
       FROM loans l
       LEFT JOIN (SELECT loan_id, SUM(amount_paid) AS amt FROM transactions
                   WHERE tenant_id = $1 AND payment_status = 'completed' AND voided_at IS NULL
                   GROUP BY loan_id) p ON p.loan_id = l.id
      WHERE l.tenant_id = $1
      GROUP BY l.status`,
    [tid],
  )).rows;
  const byStatus = Object.fromEntries(port.map((r) => [r.status, { count: r.n, principal: round2(r.principal), outstanding: round2(r.outstanding) }]));
  const totalOutstanding = round2(port.filter((r) => ["active", "defaulted"].includes(r.status)).reduce((a, r) => a + Number(r.outstanding), 0));
  const atRisk = round2(Number(byStatus.defaulted?.outstanding || 0));

  const incomeOther = round2(interest - loanInterest - fines - fees); // residual so the decomposition ties to the pool total

  return {
    // Statement of capital (receipts & payments of the lending pool)
    capital: {
      opening_capital: initial,
      principal_collected: collected,
      income_earned: interest,
      principal_disbursed: disbursed,
      operating_expenses: expenses,
      available_capital: available,
    },
    // Income statement (cash basis)
    income_statement: {
      income: { loan_interest: loanInterest, penalties: fines, processing_fees: fees, other: incomeOther, total: interest },
      expenses: { operating: expenses, bad_debts_written_off: principalWrittenOff, total: round2(expenses + principalWrittenOff) },
      net_profit: netProfit,
    },
    // Balance sheet — balances by the identity above
    balance_sheet: {
      assets: { cash_available_capital: available, loans_receivable: outstandingPrincipal, total: round2(available + outstandingPrincipal) },
      financed_by: { owners_capital: initial, retained_earnings: netProfit, total: round2(initial + netProfit) },
    },
    // Trial balance — pre-closing, debits == credits
    trial_balance: {
      debits: [
        { account: "Cash / available capital", amount: available },
        { account: "Loans receivable", amount: outstandingPrincipal },
        { account: "Operating expenses", amount: expenses },
        { account: "Bad debts written off", amount: principalWrittenOff },
      ],
      credits: [
        { account: "Owner's capital", amount: initial },
        { account: "Income (interest, fees, penalties)", amount: interest },
      ],
      debit_total: round2(available + outstandingPrincipal + expenses + principalWrittenOff),
      credit_total: round2(initial + interest),
    },
    portfolio: {
      by_status: byStatus,
      total_outstanding: totalOutstanding,
      at_risk: atRisk,
      par_pct: totalOutstanding > 0 ? round2((atRisk / totalOutstanding) * 100) : 0,
    },
  };
}
