// Welfare member-loan engine — the chama analogue of the lender loan lifecycle,
// but funded from / repaid into the members' pool (member_pool_transactions).
//
// This module owns the application → disburse half: creating an application
// (totals computed via the shared loanMath, no money moves) and disbursing it
// (build the installment schedule, debit the pool by principal, keep the
// processing fee in the pool as group income). Repayment allocation lives in
// recordMemberLoanPayment (phase 3).
import { query, withTransaction } from "../config/database.js";
import { computeLoanTotals } from "../utils/loanMath.js";
import { computeInstallmentPenalty } from "../utils/penalty.js";
import { postPool, poolBalance, round2 } from "./welfarePoolService.js";

const n2 = (v) => parseFloat(v) || 0;

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
  const { schedule } = computeLoanTotals({
    principal, annualRatePct: parseFloat(loan.interest_rate) || 0, months, method: loan.interest_method || "flat",
  });

  // One transaction: loan activation + schedule + pool debit/fee commit together,
  // so a failure part-way leaves the loan untouched (no active loan without a
  // schedule, no debit without an active loan).
  return withTransaction(async (client) => {
    const updated = (await client.query(
      `UPDATE member_loans SET status='active', disbursed_by=$1, disbursed_at=$2::timestamp,
          start_date=$3::date, end_date=$4::date, due_date=$4::date, net_disbursed=$5, updated_at=NOW()
        WHERE id=$6 RETURNING *`,
      [userId || null, disbDate, effectiveStart, endObj.toISOString().split("T")[0], netDisbursed, loan.id],
    )).rows[0];

    const anchor = new Date(effectiveStart);
    for (let i = 1; i <= months; i++) {
      const due = new Date(anchor);
      due.setMonth(due.getMonth() + (i - 1));
      const row = schedule[i - 1];
      await client.query(
        `INSERT INTO member_loan_schedules
           (tenant_id, member_loan_id, payment_number, due_date, amount_due, interest_portion, principal_portion, balance_after, status)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,'pending')`,
        [welfare.tenant_id, loan.id, i, due.toISOString().split("T")[0], row.amountDue.toFixed(2), row.interestPortion.toFixed(2), row.principalPortion.toFixed(2), row.balanceAfter.toFixed(2)],
      );
    }

    // Pool: −principal (cash out), +processing fee (income retained).
    let poolTxn = await postPool({
      client, welfare, memberId: loan.member_id, type: "loan_disbursed", amount: principal, direction: -1,
      loanId: loan.id, txnDate: disbDate, description: `Loan ${loan.loan_code} disbursed`, userId,
    });
    if (processingFee > 0) {
      poolTxn = await postPool({
        client, welfare, memberId: loan.member_id, type: "loan_processing_fee", amount: processingFee, direction: 1,
        loanId: loan.id, txnDate: disbDate, description: `Processing fee on ${loan.loan_code}`, userId,
      });
    }
    return { loan: updated, poolTxn };
  });
}

// Re-amortize a reducing-balance member loan after a principal knockdown: walk
// the paid/waived rows to derive the current principal, then recompute every
// unpaid row off that lower balance (holding the original EMI), zeroing tail
// rows once principal hits zero. Ported from the lender
// recomputeReducingBalanceSchedule, against the member tables. NOTE: member
// loans store an ANNUAL rate, so monthlyRate = annual / 100 / 12.
async function recomputeReducingMemberSchedule(client, loanId) {
  const loan = (await client.query(`SELECT * FROM member_loans WHERE id=$1`, [loanId])).rows[0];
  if (!loan || loan.interest_method !== "reducing") return;
  const monthlyRate = n2(loan.interest_rate) / 100 / 12;
  const originalPrincipal = n2(loan.principal);
  const months = parseInt(loan.duration_months, 10);
  const r = monthlyRate;
  const plannedEMI = r > 0
    ? round2((originalPrincipal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1))
    : round2(originalPrincipal / months);

  const rows = (await client.query(`SELECT * FROM member_loan_schedules WHERE member_loan_id=$1 ORDER BY payment_number`, [loanId])).rows;
  if (!rows.length) return;

  let balance = originalPrincipal, firstUnpaid = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.status === "paid" || row.status === "waived") {
      balance = round2(balance - n2(row.principal_portion));
      if (balance < 0) balance = 0;
      await client.query(`UPDATE member_loan_schedules SET balance_after=$1, updated_at=NOW() WHERE id=$2`, [balance, row.id]);
    } else { firstUnpaid = i; break; }
  }
  if (firstUnpaid !== -1) {
    for (let i = firstUnpaid; i < rows.length; i++) {
      const row = rows[i];
      if (balance <= 0.005) {
        await client.query(`UPDATE member_loan_schedules SET amount_due=0, interest_portion=0, principal_portion=0, balance_after=0, status='paid', amount_paid=0, actual_payment_date=COALESCE(actual_payment_date,CURRENT_DATE), updated_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }
      const interest = round2(balance * monthlyRate);
      let principal = round2(plannedEMI - interest);
      let amountDue = plannedEMI, balanceAfter;
      if (principal >= balance) { principal = balance; amountDue = round2(interest + principal); balanceAfter = 0; }
      else balanceAfter = round2(balance - principal);
      await client.query(`UPDATE member_loan_schedules SET amount_due=$1, interest_portion=$2, principal_portion=$3, balance_after=$4, updated_at=NOW() WHERE id=$5`, [amountDue, interest, principal, balanceAfter, row.id]);
      balance = balanceAfter;
    }
  }
  await client.query(
    `UPDATE member_loans l SET total_amount_due=COALESCE(t.total_due,l.total_amount_due),
        total_interest=COALESCE(t.total_int,l.total_interest), updated_at=NOW()
       FROM (SELECT SUM(amount_due) AS total_due, SUM(interest_portion) AS total_int
               FROM member_loan_schedules WHERE member_loan_id=$1) t
      WHERE l.id=$1`,
    [loanId],
  );
}

// Record a repayment on a member loan. Allocates penalty → interest → principal
// (oldest overdue first), posting to the pool: principal RESTORES the pool,
// interest + penalty GROW it as group profit (member savings untouched).
// Reducing loans knock principal down with early excess and re-amortize. Bullet
// (legacy, schedule-less) loans split by the loan's interest ratio. Overpayment
// is rejected (no refund queue). Throws Error{status:400} on bad input.
// The single allocation path shared by the admin route, the M-Pesa callback and
// the portal.
export async function recordMemberLoanPayment({ welfare, loan, amount, paymentDate, method, reference, userId, cap = false }) {
  if (!["active", "defaulted"].includes(loan.status)) {
    throw Object.assign(new Error(`Can't record payment on a ${loan.status} loan`), { status: 400 });
  }
  let pay = round2(parseFloat(amount));
  if (!(pay > 0)) throw Object.assign(new Error("Amount must be positive"), { status: 400 });
  const txnDate = paymentDate || new Date().toISOString().split("T")[0];
  const isReducing = loan.interest_method === "reducing";
  const lateFee = n2(loan.late_fee), penaltyRate = n2(loan.penalty_rate);

  const schedRows = (await query(`SELECT * FROM member_loan_schedules WHERE member_loan_id=$1 ORDER BY payment_number`, [loan.id])).rows;

  // Outstanding penalty across overdue rows (or charged-but-unpaid snapshots).
  const penaltyRows = [];
  for (const s of schedRows) {
    const bal = round2(n2(s.amount_due) - n2(s.amount_paid));
    const overdue = (s.status === "overdue" || (s.status === "pending" && new Date(s.due_date) < new Date(txnDate))) && bal > 0.005;
    const chargedUnpaid = round2(n2(s.late_fee_charged) + n2(s.penalty_interest_charged) - n2(s.penalty_paid)) > 0.005;
    if (!overdue && !chargedUnpaid) continue;
    const daysLate = Math.max(0, Math.round((new Date(txnDate) - new Date(s.due_date)) / 86400000));
    const p = computeInstallmentPenalty({ balance: Math.max(0, bal), daysLate, lateFee, penaltyRate });
    const live = n2(p.penalty_total);
    const snap = round2(n2(s.late_fee_charged) + n2(s.penalty_interest_charged));
    const total = bal > 0.005 ? live : Math.max(live, snap);
    const outstanding = Math.max(0, round2(total - n2(s.penalty_paid)));
    if (outstanding > 0) penaltyRows.push({ id: s.id, outstanding, lateFee: n2(p.late_fee), penaltyInterest: n2(p.penalty_interest) });
  }
  const totalPenalty = round2(penaltyRows.reduce((a, r) => a + r.outstanding, 0));

  const currentBalance = round2(n2(loan.total_amount_due) - n2(loan.amount_paid));
  const effectiveOwed = round2(currentBalance + totalPenalty);
  if (pay > effectiveOwed + 0.01) {
    // cap:true (M-Pesa over-payment via STK) applies only what's owed rather
    // than rejecting; admin/explicit callers get a 400 so they can correct.
    if (cap) pay = effectiveOwed;
    else throw Object.assign(new Error(`Loan only owes KES ${effectiveOwed.toLocaleString()} (incl. penalties)`), { status: 400 });
  }
  if (pay <= 0) return { loan, completed: loan.status === "completed", allocation: { penalty: 0, interest: 0, principal: 0 }, pool_balance: await poolBalance(welfare.id) };

  // All the writes below commit together — penalty + schedule allocation + the
  // reducing re-amortization + pool postings + the loan update are atomic.
  return withTransaction(async (client) => {
    // 1) Penalty first, oldest overdue first.
    let penaltyAllocated = 0, toPenalty = Math.min(pay, totalPenalty);
    for (const r of penaltyRows) {
      if (toPenalty <= 0.005) break;
      const apply = round2(Math.min(toPenalty, r.outstanding));
      if (apply > 0) {
        await client.query(
          `UPDATE member_loan_schedules SET penalty_paid=COALESCE(penalty_paid,0)+$1,
              late_fee_charged=GREATEST(COALESCE(late_fee_charged,0),$2),
              penalty_interest_charged=GREATEST(COALESCE(penalty_interest_charged,0),$3), updated_at=NOW()
            WHERE id=$4`,
          [apply, r.lateFee, r.penaltyInterest, r.id],
        );
        penaltyAllocated = round2(penaltyAllocated + apply);
        toPenalty = round2(toPenalty - apply);
      }
    }

    // 2) The rest reduces the schedule — interest then principal per row.
    let remaining = round2(pay - penaltyAllocated);
    let interestAllocated = 0, principalAllocated = 0;

    if (schedRows.length === 0) {
      // Bullet (legacy) loan: split by the loan's interest ratio.
      const totalDue = n2(loan.total_amount_due), totalInt = n2(loan.total_interest);
      interestAllocated = round2(remaining * (totalDue > 0 ? totalInt / totalDue : 0));
      principalAllocated = round2(remaining - interestAllocated);
      remaining = 0;
    } else {
      const rows = (await client.query(`SELECT * FROM member_loan_schedules WHERE member_loan_id=$1 AND status IN ('pending','overdue') ORDER BY payment_number`, [loan.id])).rows;
      for (const row of rows) {
        if (remaining <= 0.005) break;
        const intPortion = n2(row.interest_portion), prinPortion = n2(row.principal_portion);
        const intPaid = n2(row.interest_paid), amtPaid = n2(row.amount_paid);
        const prinPaid = round2(amtPaid - intPaid);
        const intApply = round2(Math.min(remaining, Math.max(0, round2(intPortion - intPaid))));
        remaining = round2(remaining - intApply);
        const prinApply = round2(Math.min(remaining, Math.max(0, round2(prinPortion - prinPaid))));
        remaining = round2(remaining - prinApply);
        let newIntPaid = round2(intPaid + intApply);
        let newAmtPaid = round2(amtPaid + intApply + prinApply);
        let newPrinPortion = prinPortion;
        interestAllocated = round2(interestAllocated + intApply);
        principalAllocated = round2(principalAllocated + prinApply);
        const amountDue = n2(row.amount_due);
        // Reducing prepay: once the row's EMI is settled, extra cash knocks down
        // principal (capped at the remaining loan principal); re-amort follows.
        if (isReducing && remaining > 0.005 && newAmtPaid >= amountDue - 0.005) {
          const room = parseFloat((await client.query(
            `SELECT GREATEST(0, l.principal
                - COALESCE((SELECT SUM(principal_portion) FROM member_loan_schedules
                             WHERE member_loan_id=$1 AND status IN ('paid','waived') AND id<>$2),0)
                - $3) AS room
               FROM member_loans l WHERE l.id=$1`,
            [loan.id, row.id, prinPortion],
          )).rows[0]?.room || 0);
          const knock = round2(Math.min(remaining, room));
          if (knock > 0) {
            newPrinPortion = round2(prinPortion + knock);
            newAmtPaid = round2(newAmtPaid + knock);
            principalAllocated = round2(principalAllocated + knock);
            remaining = round2(remaining - knock);
          }
        }
        const fullyPaid = newAmtPaid >= amountDue - 0.005;
        await client.query(
          `UPDATE member_loan_schedules SET amount_paid=$1, interest_paid=$2, principal_portion=$3,
              status=$4, actual_payment_date=COALESCE(actual_payment_date,$5::date), updated_at=NOW()
            WHERE id=$6`,
          [newAmtPaid, newIntPaid, newPrinPortion, fullyPaid ? "paid" : row.status, txnDate, row.id],
        );
      }
      if (isReducing) await recomputeReducingMemberSchedule(client, loan.id);
    }

    // 3) Post to the pool: principal restores it, interest + penalty are profit.
    let last = null;
    if (principalAllocated > 0.005) last = await postPool({ client, welfare, memberId: loan.member_id, type: "loan_repayment", amount: principalAllocated, direction: 1, loanId: loan.id, txnDate, description: `Principal on ${loan.loan_code}`, userId });
    if (interestAllocated > 0.005) last = await postPool({ client, welfare, memberId: loan.member_id, type: "loan_interest", amount: interestAllocated, direction: 1, loanId: loan.id, txnDate, description: `Interest on ${loan.loan_code}`, userId });
    if (penaltyAllocated > 0.005) last = await postPool({ client, welfare, memberId: loan.member_id, type: "loan_penalty", amount: penaltyAllocated, direction: 1, loanId: loan.id, txnDate, description: `Penalty on ${loan.loan_code}`, userId });

    // 4) Update the loan (amount_paid excludes penalty; complete when cleared).
    const newAmountPaid = round2(n2(loan.amount_paid) + interestAllocated + principalAllocated);
    const totalDueNow = n2((await client.query(`SELECT total_amount_due FROM member_loans WHERE id=$1`, [loan.id])).rows[0].total_amount_due);
    const completed = newAmountPaid >= totalDueNow - 0.005;
    const updated = (await client.query(
      `UPDATE member_loans SET amount_paid=$1, status=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [newAmountPaid, completed ? "completed" : (loan.status === "defaulted" ? "active" : loan.status), loan.id],
    )).rows[0];

    const poolAfter = last ? Number(last.balance_after) : await poolBalance(welfare.id);
    return { loan: updated, completed, allocation: { penalty: penaltyAllocated, interest: interestAllocated, principal: principalAllocated }, pool_balance: poolAfter };
  });
}
