// Package eligibility — shared between the staff loan-apply route,
// the portal customer apply route, and the portal packages-list
// endpoint (which annotates each row so the UI can show badges and
// reasons up front).
//
// A package's three gates default to "no restriction":
//   min_credit_score      NULL → no minimum
//   allowed_client_types  []   → any type
//   allowed_branch_ids    []   → any branch
//
// Unrated clients (credit_score === null) FAIL any min_credit_score
// check by design — admins who want products available to first-time
// borrowers should leave min_credit_score NULL. The frontend surfaces
// "needs first loan" as the reason so the customer understands.

/**
 * Evaluate whether `client` is eligible for `pkg`.
 *
 * @param {object} pkg     loan_packages row (DB shape; arrays already
 *                          deserialized by pg into JS arrays).
 * @param {object} client  minimal client row — needs credit_score,
 *                          client_type, branch_id (all may be null).
 * @returns {{
 *   eligible: boolean,
 *   reasons:  string[],   // empty when eligible
 *   recommended: boolean, // eligible AND score comfortably above min
 * }}
 */
export function evaluatePackageEligibility(pkg, client) {
  const reasons = [];
  if (!pkg) return { eligible: false, reasons: ["Package not found"], recommended: false };
  const c = client || {};

  // Credit score gate.
  const minScore = pkg.min_credit_score;
  if (minScore != null) {
    const score = c.credit_score;
    if (score == null) {
      reasons.push("Build credit history with a first loan to qualify");
    } else if (Number(score) < Number(minScore)) {
      reasons.push(
        `Credit score must be ≥ ${minScore} (yours: ${Math.round(score)})`,
      );
    }
  }

  // Client type gate.
  const allowedTypes = pkg.allowed_client_types || [];
  if (allowedTypes.length > 0) {
    const type = (c.client_type || "individual").toLowerCase();
    if (!allowedTypes.includes(type)) {
      reasons.push(
        `Only available to ${allowedTypes.join(", ")} clients`,
      );
    }
  }

  // Branch gate.
  const allowedBranches = pkg.allowed_branch_ids || [];
  if (allowedBranches.length > 0) {
    const b = c.branch_id;
    if (!b || !allowedBranches.includes(Number(b))) {
      reasons.push("Not offered at this client's branch");
    }
  }

  const eligible = reasons.length === 0;

  // "Recommended" = eligible AND credit score is comfortably above
  // the minimum (≥20 pts), OR no min_credit_score is set and the
  // client is rated (so this isn't their first loan). Used to surface
  // a positive badge in the portal product list rather than just
  // "Eligible vs Not".
  let recommended = false;
  if (eligible) {
    const score = c.credit_score;
    if (minScore == null) {
      recommended = score != null && Number(score) >= 70;
    } else {
      recommended = score != null && Number(score) >= Number(minScore) + 20;
    }
  }

  return { eligible, reasons, recommended };
}
