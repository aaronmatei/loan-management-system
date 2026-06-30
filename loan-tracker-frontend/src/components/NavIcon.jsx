import React from "react";

// Round, accent-tinted nav icon circle — the sidebar icon treatment from the
// LenderFest "Loan Console" design. One hue per nav group:
//   inactive → 15%-alpha accent fill, accent-colored icon (inherits currentColor)
//   active   → solid accent fill, white icon
// Replaces the square gradient IconTile inside the dark sidebars only. KPI
// cards / section headers still use IconTile.
const NAV_ACCENTS = {
  ocean: "#16a37a", // green — Loans / Dashboard / Clients
  emerald: "#2f9e6b", // forest — Collateral
  indigo: "#5b6ef0", // Insights
  teal: "#0fb6c4", // Communications
  rose: "#ef4d77", // Growth / Penalties
  amber: "#e6a23a", // Account
  sky: "#3aa6e6", // misc (portal)
};

export const accentOf = (variant) => NAV_ACCENTS[variant] || NAV_ACCENTS.ocean;

export default function NavIcon({
  icon: Icon,
  variant = "ocean",
  active = false,
  size = 30,
}) {
  const accent = accentOf(variant);
  return (
    <span
      className="flex items-center justify-center rounded-full shrink-0 transition-colors"
      style={{
        width: size,
        height: size,
        // accent + "26" = ~15% alpha tint on the dark sidebar.
        background: active ? accent : accent + "26",
        color: active ? "#fff" : accent,
      }}
    >
      {Icon ? <Icon size={Math.round(size * 0.52)} strokeWidth={2.1} /> : null}
    </span>
  );
}

export { NAV_ACCENTS };
