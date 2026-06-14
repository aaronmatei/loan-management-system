// Loan TYPE registry — the category that drives a loan's structure and
// workflow, distinct from a package (a priced product within a type).
// Phase 1: the concept + validation; everything defaults to "personal".
// Pawn/logbook gain their collateral + valuation + redeem/forfeit workflow
// in Phase 2.
export const LOAN_TYPES = {
  personal: {
    key: "personal",
    label: "Personal",
    description: "Unsecured loan repaid in installments.",
    security: "none",
  },
  pawn: {
    key: "pawn",
    label: "Pawn / Collateral",
    description:
      "Secured by a pledged item the lender values and holds; redeem to reclaim, or forfeit on default.",
    security: "item",
  },
  logbook: {
    key: "logbook",
    label: "Logbook / Vehicle",
    description: "Secured by a vehicle logbook; the vehicle stays with the borrower.",
    security: "vehicle",
  },
  group: {
    key: "group",
    label: "Group / Chama",
    description: "Group-guaranteed loan (joint liability).",
    security: "group",
  },
};

export const LOAN_TYPE_KEYS = Object.keys(LOAN_TYPES);
export const DEFAULT_LOAN_TYPE = "personal";

// Normalize + validate; returns a valid type key, falling back to default.
export const resolveLoanType = (t) => {
  const k = String(t || "").toLowerCase();
  return LOAN_TYPE_KEYS.includes(k) ? k : DEFAULT_LOAN_TYPE;
};
export const isLoanType = (t) =>
  LOAN_TYPE_KEYS.includes(String(t || "").toLowerCase());
