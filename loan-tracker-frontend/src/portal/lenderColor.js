// A lender's display color for multi-lender lists (directory, My Loans).
//
// Honors a CUSTOMIZED brand_color, but lenders that never set one keep the
// tenants table default (#0E8A6E) — so they'd all look identical. For those
// we derive a stable, distinct color from the lender's id so rows are
// visually distinguishable. (Single-lender white-label surfaces — receipts,
// the widget, loan details — still use the real brand_color via getPortalBrand.)
const DEFAULT_BRAND = "#0e8a6e"; // tenants.brand_color column default

const PALETTE = [
  "#0086cc", "#0d9488", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#0891b2", "#9333ea", "#dc2626", "#ca8a04",
  "#2563eb", "#059669", "#c026d3", "#e11d48", "#65a30d",
];

export function lenderColor(brand, key) {
  const hex = String(brand || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex) && hex !== DEFAULT_BRAND) return brand;
  const s = String(key ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
