import React from "react";

// Small pill for a welfare officer role (chair / treasurer / secretary).
// Renders nothing for an ordinary 'member', so it can be dropped in anywhere a
// member is shown without guarding the caller.
const STYLES = {
  chair: "bg-amber-100 text-amber-800",
  treasurer: "bg-emerald-100 text-emerald-800",
  secretary: "bg-sky-100 text-sky-800",
};

export default function OfficerBadge({ role, className = "" }) {
  const r = (role || "").toLowerCase();
  if (!STYLES[r]) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STYLES[r]} ${className}`}>
      {r}
    </span>
  );
}
