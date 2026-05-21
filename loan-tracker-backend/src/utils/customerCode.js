// A platform customer's LoanFix ID. The customer belongs to LoanFix (one
// stable LFX code), distinct from the per-lender client_code they get at each
// lender. Derived from the platform_customers id so it's stable and unique.
export const lfxCode = (id) => `LFX-${String(id).padStart(6, "0")}`;

export default { lfxCode };
