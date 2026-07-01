import React from "react";

// Guided empty state — illustration + one-line explanation + a CTA to the
// relevant existing action. Promoted from the Loans pilot so every "no data
// yet" surface reads the same. The illustration is static UI; it never
// renders DB rows.
//
// <EmptyState
//   icon={Coins}
//   title="No loans issued yet"
//   description="When you issue a loan it shows up here…"
//   action={<button onClick={…}>Create Loan</button>}
// />

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "ocean",
  className = "",
}) {
  const tile =
    tone === "muted"
      ? "bg-slate-100 dark:bg-slate-700"
      : "bg-ocean-gradient-soft";
  const iconColor =
    tone === "muted"
      ? "text-slate-400 dark:text-slate-300"
      : "text-ocean-600";
  return (
    <div
      className={`bg-surface rounded-2xl shadow-card p-10 lg:p-14 text-center max-w-xl mx-auto ${className}`}
    >
      <div
        className={`mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center ${tile}`}
      >
        {Icon && <Icon size={30} className={iconColor} />}
      </div>
      <h3 className="text-xl font-bold text-navy-900 dark:text-slate-100 mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-slate-500 dark:text-slate-400 mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
