// Package eligibility — mirror of the backend evaluator so the
// staff/portal apply forms can show a live "eligible / not eligible"
// banner the moment the client + package are picked, instead of
// letting the customer hit submit and bounce off a 400.
//
// Keep the rules identical to backend/src/utils/packageEligibility.js
// — drift here = a misleading badge.

export function evaluatePackageEligibility(pkg, client) {
  const reasons = [];
  if (!pkg) {
    return { eligible: false, reasons: ["Package not found"], recommended: false };
  }
  const c = client || {};

  const minScore = pkg.min_credit_score;
  if (minScore != null) {
    const score = c.credit_score;
    if (score == null) {
      reasons.push("Build credit history with a first loan to qualify");
    } else if (Number(score) < Number(minScore)) {
      reasons.push(
        `Credit score must be ≥ ${minScore} (theirs: ${Math.round(score)})`,
      );
    }
  }

  const allowedTypes = pkg.allowed_client_types || [];
  if (allowedTypes.length > 0) {
    const type = (c.client_type || "individual").toLowerCase();
    if (!allowedTypes.includes(type)) {
      reasons.push(`Only available to ${allowedTypes.join(", ")} clients`);
    }
  }

  const allowedBranches = (pkg.allowed_branch_ids || []).map((id) => Number(id));
  if (allowedBranches.length > 0) {
    const b = c.branch_id;
    if (!b || !allowedBranches.includes(Number(b))) {
      reasons.push("Not offered at this client's branch");
    }
  }

  const eligible = reasons.length === 0;

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
