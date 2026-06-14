// Late-payment penalty for a single overdue installment, matching the loan
// agreement: a late fee plus penalty interest of `penaltyRate`% per month on
// the overdue balance. Both accrue PER DAY — the monthly figures are spread
// across a 30-day month and charged only for the days actually late. So a
// KES 3,000/month late fee that's 5 days late costs 3000 * 5/30 = KES 500,
// not the full month. Returns zeros when the installment isn't overdue.
//
// A 30-day-month convention (rather than the calendar month's real length) is
// used so every surface — the overdue list, a payment quote, the portal — agrees
// on the same number, and so lateness spanning month boundaries stays linear.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const DAYS_IN_MONTH = 30;

export function computeInstallmentPenalty({
  balance,
  daysLate,
  lateFee,
  penaltyRate,
  daysInMonth = DAYS_IN_MONTH,
}) {
  const bal = Number(balance) || 0;
  const fee = Number(lateFee) || 0;
  const rate = Number(penaltyRate) || 0;
  const days = Number(daysLate) || 0;
  const perMonth = Number(daysInMonth) || DAYS_IN_MONTH;

  if (bal <= 0 || days <= 0) {
    return {
      late_fee: 0,
      penalty_rate: rate,
      days_late: 0,
      months_late: 0,
      penalty_interest: 0,
      penalty_total: 0,
      total_with_penalty: round2(bal),
    };
  }

  // Fraction of a month the payment is late — accrues daily, no rounding up,
  // and grows past 1 for lateness beyond a month (45 days late = 1.5 months).
  const monthsLate = days / perMonth;
  const lateFeeCharged = fee * monthsLate;
  const penaltyInterest = (rate / 100) * bal * monthsLate;
  const penaltyTotal = lateFeeCharged + penaltyInterest;

  return {
    late_fee: round2(lateFeeCharged),
    penalty_rate: rate,
    days_late: days,
    months_late: round2(monthsLate),
    penalty_interest: round2(penaltyInterest),
    penalty_total: round2(penaltyTotal),
    total_with_penalty: round2(bal + penaltyTotal),
  };
}
