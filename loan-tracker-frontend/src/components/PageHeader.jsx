import React from "react";
import IconTile from "./IconTile";
import { abbreviateKES, exactKES } from "../utils/money";

// Canonical page header — the single header pattern used across the staff
// app: title → contextual KPIs → primary action → filters. Promoted from
// the Dashboard/Loans pilot so every page reads the same way.
//
// <PageHeader
//   icon={Users}
//   title="Clients"
//   subtitle="Everyone you lend to"
//   kpis={[{ label: "Total", value: 1280 },
//          { label: "Outstanding", value: 4200000, money: true }]}
//   actions={<button>…</button>}
// >
//   {/* filter bar goes here as children */}
// </PageHeader>

function KpiChip({ label, value, money = false, hint, tone }) {
  const display = money
    ? abbreviateKES(value)
    : typeof value === "number"
      ? value.toLocaleString()
      : value;
  const toneClass =
    tone === "pos"
      ? "text-money-pos"
      : tone === "neg"
        ? "text-money-neg"
        : tone === "warn"
          ? "text-money-warn"
          : "text-navy-900 dark:text-slate-100";
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700 px-4 py-3">
      <p className="text-[11px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`text-xl font-bold mt-0.5 ${toneClass}`}
        title={money ? exactKES(value) : undefined}
      >
        {display}
      </p>
      {hint && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  kpis = [],
  actions,
  children,
  className = "",
}) {
  return (
    <div className={`mb-6 ${className}`}>
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && <IconTile icon={Icon} size={44} className="mt-0.5" />}
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 dark:text-slate-100">
              {title}
            </h1>
            {subtitle && (
              <p className="text-slate-500 dark:text-slate-400 mt-1">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>

      {kpis.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {kpis.map((k, i) => (
            <KpiChip key={i} {...k} />
          ))}
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
