import React from "react";

// Small presentational row of summary tiles. Pass an array of
// { label, value, sub?, tone? }; falsy entries are skipped.
const TONES = {
  emerald: "text-emerald-700 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  sky: "text-sky-700 dark:text-sky-300",
  indigo: "text-indigo-700 dark:text-indigo-300",
  amber: "text-amber-700 dark:text-amber-300",
  slate: "text-slate-800 dark:text-slate-100",
};

export default function StatTiles({ tiles = [] }) {
  const items = tiles.filter(Boolean);
  if (!items.length) return null;
  const cols = items.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div className={`grid grid-cols-2 ${cols} gap-3 mb-5`}>
      {items.map((t, i) => (
        <div key={i} className="rounded-xl bg-surface border border-slate-200 dark:border-slate-700 px-4 py-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-400">{t.label}</p>
          <p className={`text-lg font-bold ${TONES[t.tone] || TONES.slate}`}>{t.value}</p>
          {t.sub && <p className="text-xs text-slate-500 dark:text-slate-400">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}
