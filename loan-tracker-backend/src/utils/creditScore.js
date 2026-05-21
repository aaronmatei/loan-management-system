// Credit profile helpers shared by the staff client profile (routes/clients.js)
// and the customer portal analytics (routes/portal/customer.js). Pure
// functions over a `metrics` object so both callers can reuse identical
// scoring/risk/eligibility logic.

export function calculateCreditScore(metrics) {
  let score = 100;

  // Deduct for defaulted loans
  score -= metrics.defaulted_loans_count * 30;

  // Deduct for current overdue
  if (metrics.current_overdue_count > 0) {
    score -= 15;
    score -= Math.min(metrics.current_overdue_count * 5, 25);
  }

  // Deduct for late payments
  const latePaymentRate =
    metrics.late_payments / Math.max(metrics.total_payments, 1);
  score -= latePaymentRate * 20;

  // Boost for completed loans
  score += Math.min(metrics.completed_loans_count * 3, 15);

  // Boost for high on-time rate
  if (metrics.on_time_rate >= 95) score += 10;
  else if (metrics.on_time_rate >= 80) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getRiskLevel(score, hasDefault, hasOverdue) {
  if (hasDefault)
    return { level: "very_high", label: "🔴 Blacklisted", color: "red" };
  if (hasOverdue)
    return { level: "high", label: "🟠 At Risk", color: "orange" };
  if (score >= 80)
    return { level: "low", label: "🟢 Excellent", color: "green" };
  if (score >= 60)
    return { level: "medium", label: "🟡 Good", color: "yellow" };
  return { level: "high", label: "🟠 Caution", color: "orange" };
}

export function checkEligibility(metrics, creditScore) {
  const blockers = [];

  if (metrics.defaulted_loans_count > 0) {
    blockers.push("Has defaulted loans - must resolve first");
  }

  if (metrics.current_overdue_count > 0) {
    blockers.push(
      `Has ${metrics.current_overdue_count} overdue payment(s) - must clear first`,
    );
  }

  if (metrics.active_loans_count >= 3) {
    blockers.push("Maximum 3 active loans allowed");
  }

  // Recommended max based on history
  let maxRecommended = 0;
  if (creditScore >= 80) {
    maxRecommended = Math.max(metrics.total_borrowed * 1.5, 100000);
  } else if (creditScore >= 60) {
    maxRecommended = Math.max(metrics.total_borrowed * 1.0, 50000);
  } else {
    maxRecommended = 30000;
  }

  // Recommended rate based on credit score
  let recommendedRate = 15;
  if (creditScore >= 90) recommendedRate = 10;
  else if (creditScore >= 75) recommendedRate = 12;
  else if (creditScore >= 60) recommendedRate = 15;
  else recommendedRate = 20;

  return {
    can_borrow: blockers.length === 0,
    reason:
      blockers.length === 0
        ? `Score: ${creditScore}/100`
        : "Has issues that need resolution",
    max_recommended_amount: Math.round(maxRecommended),
    recommended_interest_rate: recommendedRate,
    blockers,
  };
}
