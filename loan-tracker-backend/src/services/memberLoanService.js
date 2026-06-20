// Welfare member-loan engine — the chama analogue of the lender loan lifecycle,
// but funded from / repaid into the members' pool (member_pool_transactions).
//
// This module owns the application → disburse half: creating an application
// (totals computed via the shared loanMath, no money moves) and disbursing it
// (build the installment schedule, debit the pool by principal, keep the
// processing fee in the pool as group income). Repayment allocation lives in
// recordMemberLoanPayment (phase 3).
import { query } from "../config/database.js";
import { computeLoanTotals } from "../utils/loanMath.js";
import { postPool, poolBalance, round2 } from "./welfarePoolService.js";

// MBL-00001 … sequential per tenant (matches the legacy quick-issue code).
export async function nextMemberLoanCode(tenantId) {
  const n = (await query(`SELECT COUNT(*)::int AS n FROM member_loans WHERE tenant_id = $1`, [tenantId])).rows[0].n;
  return `MBL-${String(n + 1).padStart(5, "0")}`;
}

// Create a loan application. Computes total_interest / total_amount_due from the
// chosen method so the application already shows the figures. Does NOT touch the
// pool — funds move only at disburse. Defaults to status 'pending'.
export async function createMemberLoanApplication({
  welfare, member, product, principal, rate, months, method,
  processingFeeRate = 0, lateFee = 0, penaltyRate = 0, purpose, notes, userId, status = "pending",
}) {
  const { totalInterest, totalAmountDue } = computeLoanTotals({ principal, annualRatePct: rate, months, method });
  const processingFee = round2(principal * (Number(processingFeeRate) || 0) / 100);
  const code = await nextMemberLoanCode(welfare.tenant_id);
  const r = await query(
    `INSERT INTO member_loans
       (tenant_id, welfare_id, member_id, loan_code, product_id, principal, interest_rate,
        interest_method, duration_months, total_interest, total_amount_due,
        processing_fee_rate, processing_fee, late_fee, penalty_rate, purpose, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [
      welfare.tenant_id, welfare.id, member.id, code, product?.id || null, principal, rate, method, months,
      totalInterest, totalAmountDue, Number(processingFeeRate) || 0, processingFee,
      Number(lateFee) || 0, Number(penaltyRate) || 0, purpose || null, notes || null, status, userId || null,
    ],
  );
  return r.rows[0];
}

// Disburse an approved loan: build the installment schedule (mirrors the lender
// performDisburse — reducing gets a real EMI amortization, flat the even split,
// last row pinned to the residual), debit the pool by principal and credit the
// processing fee as group income, and set the loan 'active'. The pool-cover gate
// fires HERE (not at application). Throws Error{status:400} if the pool can't
// cover the principal or the dates are invalid.
export async function disburseMemberLoan({ welfare, loan, startDate, disbursementDate, userId }) {
  const principal = parseFloat(loan.principal);
  const pool = await poolBalance(welfare.id);
  if (principal > pool) {
    throw Object.assign(new Error(`Pool only holds KES ${pool.toLocaleString()} — can't disburse KES ${principal.toLocaleString()}`), { status: 400 });
  }

  const months = parseInt(loan.duration_months, 10);
  const disbDate = disbursementDate || new Date().toISOString().split("T")[0];
  let effectiveStart;
  if (startDate) {
    const sd = new Date(startDate);
    if (Number.isNaN(sd.getTime())) throw Object.assign(new Error("Invalid start date"), { status: 400 });
    if (sd < new Date(disbDate)) throw Object.assign(new Error("Start date cannot be before the disbursement date."), { status: 400 });
    effectiveStart = sd.toISOString().split("T")[0];
  } else {
    const s = new Date(disbDate);
    s.setMonth(s.getMonth() + 1); // first installment a month after disbursement
    effectiveStart = s.toISOString().split("T")[0];
  }
  const endObj = new Date(effectiveStart);
  endObj.setMonth(endObj.getMonth() + months - 1);
  const processingFee = round2(parseFloat(loan.processing_fee) || 0);
  const netDisbursed = round2(principal - processingFee);

  const updated = (await query(
    `UPDATE member_loans SET status='active', disbursed_by=$1, disbursed_at=$2::timestamp,
        start_date=$3::date, end_date=$4::date, due_date=$4::date, net_disbursed=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *`,
    [userId || null, disbDate, effectiveStart, endObj.toISOString().split("T")[0], netDisbursed, loan.id],
  )).rows[0];

  const { schedule } = computeLoanTotals({
    principal, annualRatePct: parseFloat(loan.interest_rate) || 0, months, method: loan.interest_method || "flat",
  });
  const anchor = new Date(effectiveStart);
  for (let i = 1; i <= months; i++) {
    const due = new Date(anchor);
    due.setMonth(due.getMonth() + (i - 1));
    const row = schedule[i - 1];
    await query(
      `INSERT INTO member_loan_schedules
         (tenant_id, member_loan_id, payment_number, due_date, amount_due, interest_portion, principal_portion, balance_after, status)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,'pending')`,
      [welfare.tenant_id, loan.id, i, due.toISOString().split("T")[0], row.amountDue.toFixed(2), row.interestPortion.toFixed(2), row.principalPortion.toFixed(2), row.balanceAfter.toFixed(2)],
    );
  }

  // Pool: −principal (cash out), +processing fee (income retained). Net pool
  // drop = net disbursed; the fee stays as group profit.
  let poolTxn = await postPool({
    welfare, memberId: loan.member_id, type: "loan_disbursed", amount: principal, direction: -1,
    loanId: loan.id, txnDate: disbDate, description: `Loan ${loan.loan_code} disbursed`, userId,
  });
  if (processingFee > 0) {
    // Track the latest ledger row so callers report the final pool balance.
    poolTxn = await postPool({
      welfare, memberId: loan.member_id, type: "loan_processing_fee", amount: processingFee, direction: 1,
      loanId: loan.id, txnDate: disbDate, description: `Processing fee on ${loan.loan_code}`, userId,
    });
  }
  return { loan: updated, poolTxn };
}
