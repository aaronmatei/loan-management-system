// Loan math — same shape as the backend utils/loanMath.js but only
// the totals (no per-installment schedule) since the frontend just
// powers the live-preview tile on the Apply Loan form.
//
// Keep the formulas identical to the backend or staff will see the
// preview drift from what the loan actually books at create-time.

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Compute totals for a loan given the method.
 * @returns { totalInterest, totalAmountDue, monthlyPayment }
 */
export function computeLoanTotals({
  principal,
  annualRatePct,
  months,
  method = "flat",
}) {
  const p = Number(principal) || 0;
  const annual = Number(annualRatePct) || 0;
  const n = Math.max(0, Math.round(Number(months) || 0));
  if (p <= 0 || n <= 0) {
    return { totalInterest: 0, totalAmountDue: 0, monthlyPayment: 0 };
  }
  if (method === "reducing") {
    const r = annual / 100 / 12;
    if (r <= 0) {
      const mp = round2(p / n);
      return { totalInterest: 0, totalAmountDue: round2(p), monthlyPayment: mp };
    }
    const pow = Math.pow(1 + r, n);
    const emi = round2((p * r * pow) / (pow - 1));
    const totalAmountDue = round2(emi * n);
    return {
      totalInterest: round2(totalAmountDue - p),
      totalAmountDue,
      monthlyPayment: emi,
    };
  }
  // flat (default)
  const years = n / 12;
  const totalInterest = round2(p * (annual / 100) * years);
  const totalAmountDue = round2(p + totalInterest);
  return {
    totalInterest,
    totalAmountDue,
    monthlyPayment: round2(totalAmountDue / n),
  };
}
