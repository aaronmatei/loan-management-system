// Loan TYPE registry (mirrors the backend). The type is the category that
// drives a loan's structure/workflow; a package is a priced product within a
// type. Phase 1: pick the type on a package; everything defaults to personal.
export const LOAN_TYPES = [
  {
    key: "personal",
    label: "Personal",
    description: "Unsecured loan repaid in installments.",
  },
  {
    key: "pawn",
    label: "Pawn / Collateral",
    description: "Secured by a pledged item that's valued and held; redeem to reclaim.",
  },
  {
    key: "logbook",
    label: "Logbook / Vehicle",
    description: "Secured by a vehicle logbook; the vehicle stays with the borrower.",
  },
  {
    key: "group",
    label: "Group / Chama",
    description: "Group-guaranteed loan (joint liability).",
  },
];

export const loanTypeLabel = (key) =>
  (LOAN_TYPES.find((t) => t.key === key) || LOAN_TYPES[0]).label;
