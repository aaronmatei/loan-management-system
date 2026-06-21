// Canonical money rounding for the welfare subsystem: round to 2 decimals with
// an epsilon nudge so values like 1.005 round up (plain Math.round(1.005*100)
// gives 100 due to float error → 1.00). Single source of truth — import this
// rather than re-declaring it.
//
// NOTE: some legacy LENDER files (paymentService, billing, penaltyEngine,
// waiverService, …) carry their OWN round2 that does NOT epsilon-correct
// (`Math.round(n*100)/100`). They are intentionally left alone here because
// switching them would change results in those paths; unifying them is a
// separate, behavior-affecting decision.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
