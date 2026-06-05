import React from "react";

// Light KPI card for the platform admin — a white surface with a soft, faded
// accent glow and a small colour dot, replacing the old full-colour gradient
// tiles. Pass `accent` to tint: ocean / green / amber / rose / violet / slate.
const ACCENTS = {
  ocean: { glow: "bg-ocean-400/20", dot: "bg-ocean-500", val: "text-ocean-700" },
  green: { glow: "bg-emerald-400/20", dot: "bg-emerald-500", val: "text-emerald-700" },
  amber: { glow: "bg-amber-400/25", dot: "bg-amber-500", val: "text-amber-600" },
  rose: { glow: "bg-rose-400/20", dot: "bg-rose-500", val: "text-rose-600" },
  violet: { glow: "bg-violet-400/20", dot: "bg-violet-500", val: "text-violet-700" },
  slate: { glow: "bg-slate-400/15", dot: "bg-slate-400", val: "text-slate-800" },
};

export default function StatCard({
  label,
  value,
  sub,
  accent = "ocean",
  className = "",
}) {
  const a = ACCENTS[accent] || ACCENTS.ocean;
  return (
    <div
      className={`relative overflow-hidden bg-white rounded-xl border border-slate-100 shadow-sm p-4 ${className}`}
    >
      <div
        className={`pointer-events-none absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl ${a.glow}`}
      />
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${a.dot}`} />
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        </div>
        <p className={`text-2xl font-bold mt-1 ${a.val}`}>{value}</p>
        {sub != null && sub !== "" && (
          <p className="text-xs text-slate-400 mt-1">{sub}</p>
        )}
      </div>
    </div>
  );
}
