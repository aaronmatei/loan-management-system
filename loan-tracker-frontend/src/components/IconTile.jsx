import React from "react";

// Rounded gradient tile holding a lucide icon — the signature visual of
// the ocean design system. Used in the sidebar nav, KPI cards, and
// section headers/empty states so the icon language is consistent.
//
// This is LendFest product chrome (ocean gradients). It is NOT for
// tenant-facing surfaces — those stay driven by the tenant brand_color.

const GRADIENTS = {
  ocean: "linear-gradient(135deg, #22b488 0%, #0e8a6e 100%)",
  teal: "linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)",
  emerald: "linear-gradient(135deg, #34d399 0%, #059669 100%)",
  indigo: "linear-gradient(135deg, #818cf8 0%, #0a5c4c 100%)",
  rose: "linear-gradient(135deg, #fb7185 0%, #e11d48 100%)",
  amber: "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)",
};

export default function IconTile({
  icon: Icon,
  variant = "ocean",
  size = 40,
  className = "",
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl shadow-sm shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: GRADIENTS[variant] || GRADIENTS.ocean,
      }}
    >
      {Icon ? <Icon size={size * 0.5} color="#fff" strokeWidth={2.2} /> : null}
    </div>
  );
}

export { GRADIENTS };
