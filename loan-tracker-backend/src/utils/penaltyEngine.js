// Configurable per-chama penalty calculation. A rule has a calc_type and a
// rate/amount; this turns it into a money figure given the context (the basis
// it applies to, and how many days late). Shared by the penalty routes and the
// (later) accrual jobs so the maths lives in one place.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const PENALTY_TRIGGERS = [
  "contribution_late",
  "loan_late",
  "attendance_absent",
  "attendance_late",
  "meeting_missed",
];
export const PENALTY_CALC_TYPES = [
  "fixed",
  "percentage",
  "daily_fixed",
  "daily_percentage",
];

// `basis` is the amount a percentage applies to (e.g. the contribution due or
// the loan balance). `daysLate` drives the daily types. Result is capped by
// rule.cap when set.
export function computePenaltyAmount(rule, { basis = 0, daysLate = 0 } = {}) {
  const amount = Number(rule.amount) || 0;
  const rate = Number(rule.rate) || 0;
  const b = Number(basis) || 0;
  const days = Math.max(0, parseInt(daysLate, 10) || 0);

  let value = 0;
  switch (rule.calc_type) {
    case "fixed":
      value = amount;
      break;
    case "percentage":
      value = b * (rate / 100);
      break;
    case "daily_fixed":
      value = amount * days;
      break;
    case "daily_percentage":
      value = b * (rate / 100) * days;
      break;
    default:
      value = 0;
  }
  value = round2(value);
  if (rule.cap != null && rule.cap !== "" && value > Number(rule.cap)) {
    value = round2(Number(rule.cap));
  }
  return value;
}
