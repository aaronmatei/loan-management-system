// Stub CRB provider — the default until a real bureau is wired.
//
// It is NOT a live bureau. Two modes:
//   • officer override: when the lender pulls a report from the bureau's own
//     portal and keys the result in, we store it verbatim (source="manual").
//   • internal estimate: with no override, derive an indicative score from the
//     lender's OWN repayment data (source="estimate") so the underwriting
//     worksheet is usable on day one. Clearly labelled as an estimate.
//
// Swap to a real bureau by setting CRB_PROVIDER=metropol (+ credentials).
const name = "manual";
const isConnected = () => false;

export function gradeForScore(score) {
  if (score == null) return null;
  if (score >= 740) return "A";
  if (score >= 670) return "B";
  if (score >= 580) return "C";
  if (score >= 500) return "D";
  return "E";
}

async function getCreditReport({ client, override }) {
  // Officer keyed the bureau result in by hand.
  if (override && (override.score != null || override.status)) {
    const score = override.score != null ? Math.round(Number(override.score)) : null;
    return {
      provider: "manual",
      source: "manual",
      reference: override.reference || null,
      score,
      grade: override.grade || gradeForScore(score),
      status: override.status || "unknown",
      accounts: [],
      raw: { entered_by_officer: true, ...override },
    };
  }

  // Internal estimate from the tenant's own credit score.
  const score =
    client?.credit_score != null ? Math.round(Number(client.credit_score)) : 600;
  return {
    provider: "manual",
    source: "estimate",
    reference: null,
    score,
    grade: gradeForScore(score),
    status: "unknown",
    accounts: [],
    raw: {
      note:
        "Internal estimate — no live CRB connected. Set CRB_PROVIDER + bureau credentials for a real pull, or enter the bureau result manually.",
    },
  };
}

export default { name, isConnected, getCreditReport };
