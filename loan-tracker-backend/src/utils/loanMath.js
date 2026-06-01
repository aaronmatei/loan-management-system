// Loan math — shared between staff loans.js POST, customer portal
// apply route, and the disburse schedule generator. Two methods:
//
//   flat
//     Interest is principal × annualRate × years, spread evenly across
//     every installment. Each installment amount = total_amount_due /
//     months. This is the legacy default and is still what nearly all
//     informal Kenyan lenders quote.
//
//   reducing
//     Amortized (EMI). Each installment is the same dollar amount but
//     the split shifts: early periods are mostly interest, late
//     periods are mostly principal, because interest is computed on
//     the remaining balance each period. Standard for SACCOs / banks.
//     EMI = P × r × (1+r)^n / ((1+r)^n − 1)   for r > 0
//     EMI = P / n                              for r = 0
//
// Both methods return identical shape so callers don't branch on the
// method — they just pass it through:
//   { totalInterest, totalAmountDue, monthlyPayment, schedule }
// where schedule is an array of { dueIndex, amountDue, interestPortion,
// principalPortion, balanceAfter }. For flat, interestPortion is the
// same on every row (total_interest / n).

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Compute totals + per-installment schedule for a loan.
 *
 * @param {object} args
 * @param {number} args.principal       Loan principal (KES).
 * @param {number} args.annualRatePct   Annual interest rate as a percent (e.g. 18 = 18%).
 * @param {number} args.months          Loan duration in months (≥ 1).
 * @param {'flat'|'reducing'} args.method
 * @returns {{
 *   totalInterest: number,
 *   totalAmountDue: number,
 *   monthlyPayment: number,
 *   schedule: Array<{ dueIndex: number, amountDue: number,
 *                     interestPortion: number, principalPortion: number,
 *                     balanceAfter: number }>
 * }}
 */
export function computeLoanTotals({
  principal,
  annualRatePct,
  months,
  method = "flat",
}) {
  if (!(principal > 0)) {
    throw new Error("principal must be positive");
  }
  if (!(months > 0)) {
    throw new Error("months must be positive");
  }
  const annualRate = Number(annualRatePct) || 0;
  const monthlyRate = annualRate / 100 / 12;
  const n = Math.round(months);

  if (method === "reducing") {
    return computeReducing(principal, monthlyRate, n);
  }
  // default = flat
  return computeFlat(principal, annualRate, n);
}

function computeFlat(principal, annualRatePct, n) {
  const years = n / 12;
  const totalInterest = round2(principal * (annualRatePct / 100) * years);
  const totalAmountDue = round2(principal + totalInterest);
  const monthlyPayment = round2(totalAmountDue / n);
  const interestPerInstallment = round2(totalInterest / n);
  const principalPerInstallment = round2(monthlyPayment - interestPerInstallment);
  const schedule = [];
  let remaining = totalAmountDue;
  for (let i = 1; i <= n; i++) {
    // Pin the final row to whatever is left so rounding never leaves
    // an off-by-one cent on the last installment.
    const amountDue = i === n ? round2(remaining) : monthlyPayment;
    schedule.push({
      dueIndex: i,
      amountDue,
      interestPortion: interestPerInstallment,
      principalPortion: round2(amountDue - interestPerInstallment),
      balanceAfter: round2(remaining - amountDue),
    });
    remaining = round2(remaining - amountDue);
  }
  return { totalInterest, totalAmountDue, monthlyPayment, schedule };
}

function computeReducing(principal, monthlyRate, n) {
  // Zero-rate edge case: EMI = principal / n, no interest at all.
  if (monthlyRate <= 0) {
    const monthlyPayment = round2(principal / n);
    const schedule = [];
    let balance = principal;
    for (let i = 1; i <= n; i++) {
      const amountDue = i === n ? round2(balance) : monthlyPayment;
      schedule.push({
        dueIndex: i,
        amountDue,
        interestPortion: 0,
        principalPortion: amountDue,
        balanceAfter: round2(balance - amountDue),
      });
      balance = round2(balance - amountDue);
    }
    return {
      totalInterest: 0,
      totalAmountDue: round2(principal),
      monthlyPayment,
      schedule,
    };
  }

  const r = monthlyRate;
  const pow = Math.pow(1 + r, n);
  const emi = round2((principal * r * pow) / (pow - 1));

  const schedule = [];
  let balance = principal;
  let totalInterest = 0;
  for (let i = 1; i <= n; i++) {
    const interestPortion = round2(balance * r);
    // Last row pins to "whatever's left" so the schedule sums cleanly
    // back to the EMI table — no rounding-drift cent on the tail.
    const amountDue =
      i === n ? round2(balance + interestPortion) : emi;
    const principalPortion = round2(amountDue - interestPortion);
    balance = round2(balance - principalPortion);
    totalInterest = round2(totalInterest + interestPortion);
    schedule.push({
      dueIndex: i,
      amountDue,
      interestPortion,
      principalPortion,
      balanceAfter: balance,
    });
  }

  const totalAmountDue = round2(principal + totalInterest);
  return { totalInterest, totalAmountDue, monthlyPayment: emi, schedule };
}

/**
 * Validate amount + duration against a package's allowed ranges.
 * Returns null if OK, or an error message string if out of bounds.
 *
 * Callers respond 400 with the returned string.
 */
export function validateAgainstPackage(pkg, principal, months) {
  if (!pkg) return null;
  const amt = Number(principal);
  const dur = Number(months);
  if (amt < parseFloat(pkg.min_amount)) {
    return `Amount below this package's minimum (KES ${pkg.min_amount})`;
  }
  if (amt > parseFloat(pkg.max_amount)) {
    return `Amount above this package's maximum (KES ${pkg.max_amount})`;
  }
  if (dur < pkg.min_duration_months) {
    return `Duration below this package's minimum (${pkg.min_duration_months} months)`;
  }
  if (dur > pkg.max_duration_months) {
    return `Duration above this package's maximum (${pkg.max_duration_months} months)`;
  }
  return null;
}
