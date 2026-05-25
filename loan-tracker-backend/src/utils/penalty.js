// Late-payment penalty for a single overdue installment, matching the loan
// agreement: a flat late fee per missed payment, plus penalty interest of
// `penaltyRate`% per month on the overdue balance. Part-months round up, so
// any portion of a month counts as a full month. Returns zeros when the
// installment isn't actually overdue (nothing owed, or not yet past due).
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function computeInstallmentPenalty({
  balance,
  daysLate,
  lateFee,
  penaltyRate,
}) {
  const bal = Number(balance) || 0;
  const fee = Number(lateFee) || 0;
  const rate = Number(penaltyRate) || 0;
  const days = Number(daysLate) || 0;

  if (bal <= 0 || days <= 0) {
    return {
      late_fee: 0,
      penalty_rate: rate,
      months_late: 0,
      penalty_interest: 0,
      penalty_total: 0,
      total_with_penalty: round2(bal),
    };
  }

  const monthsLate = Math.max(1, Math.ceil(days / 30));
  const penaltyInterest = (rate / 100) * bal * monthsLate;
  const penaltyTotal = fee + penaltyInterest;

  return {
    late_fee: fee,
    penalty_rate: rate,
    months_late: monthsLate,
    penalty_interest: round2(penaltyInterest),
    penalty_total: round2(penaltyTotal),
    total_with_penalty: round2(bal + penaltyTotal),
  };
}
