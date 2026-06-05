// Brand theming for the tenant-facing customer portal. The portal is
// white-labeled: every accent/gradient derives from the CURRENT lender's
// brand_color (read from the same localStorage key PortalLayout uses),
// never LenderFest ocean. Falls back to a neutral blue if unset/invalid.
//
// Usage:
//   const { brand, gradient, rgba } = getPortalBrand();
//   <span style={{ color: brand }} />        // accent text
//   <button style={{ background: gradient }} // primary CTA / tile
//   style={{ backgroundColor: rgba(0.07) }}  // soft tint panel
export function getPortalBrand() {
  let hex = "#0e8a6e";
  try {
    const t = JSON.parse(localStorage.getItem("portal_current_tenant") || "{}");
    if (/^#[0-9a-fA-F]{6}$/.test(t?.brand_color || "")) hex = t.brand_color;
  } catch {
    /* ignore malformed storage */
  }
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const shift = (amt) =>
    `rgb(${clamp(((n >> 16) & 255) + amt)}, ${clamp(((n >> 8) & 255) + amt)}, ${clamp((n & 255) + amt)})`;
  const rgba = (a) =>
    `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  return {
    brand: hex,
    gradient: `linear-gradient(135deg, ${shift(25)} 0%, ${shift(-40)} 100%)`,
    softBg: rgba(0.07),
    shift,
    rgba,
  };
}
