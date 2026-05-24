// Lender categories (tenants.business_type) with a human-readable label and a
// stable colour, so a customer can recognise a lender's TYPE at a glance in the
// directory — and the row's colour reflects that type. Keys match the values
// set at tenant signup (microfinance / sacco / chama / individual / other).
const TYPES = {
  microfinance: { label: "Microfinance", color: "#0086cc" }, // ocean blue
  sacco: { label: "SACCO", color: "#16a34a" }, // green
  chama: { label: "Chama", color: "#7c3aed" }, // purple
  individual: { label: "Individual", color: "#ea580c" }, // orange
  other: { label: "Other", color: "#64748b" }, // slate
};

// Resolve a lender's type → { label, color }. Unknown/empty values fall back
// to a capitalised label on a neutral colour.
export function lenderType(businessType) {
  const key = String(businessType || "").trim().toLowerCase();
  if (TYPES[key]) return TYPES[key];
  return {
    label: businessType
      ? businessType.charAt(0).toUpperCase() + businessType.slice(1)
      : "Lender",
    color: "#64748b",
  };
}

export const LENDER_TYPES = TYPES;
