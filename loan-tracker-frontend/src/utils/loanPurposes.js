// Canonical list of loan purposes — shared by the staff Apply Loan
// form, the portal ApplyLoan flow, and the Settings → Loan Packages
// allowed-purposes chip selector, so the dropdown stays consistent
// across the app.
//
// Order matters — it's the order the dropdown shows.
export const LOAN_PURPOSES = [
  "Business expansion",
  "Stock purchase",
  "Equipment purchase",
  "School fees",
  "Medical emergency",
  "Home improvement",
  "Vehicle purchase",
  "Farming inputs",
  "Working capital",
  "Wedding expenses",
  "Funeral expenses",
  "Other",
];

// Given a package's allowed_purposes array, return the dropdown
// options to show. Empty array (or null) means "no restriction" —
// surface the full list. Otherwise filter to the package's set,
// preserving the LOAN_PURPOSES order so the UI is stable.
export function purposesForPackage(pkg) {
  const allowed = pkg?.allowed_purposes || [];
  if (allowed.length === 0) return LOAN_PURPOSES;
  return LOAN_PURPOSES.filter((p) => allowed.includes(p));
}
