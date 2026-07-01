import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Small bordered chip wrapping a <input type="month"> with prev/next
// arrows on either side. value/onChange are "YYYY-MM" strings; empty
// string means no period selected. When disableFuture is true, the
// → button is disabled once value reaches the current calendar month
// — there's no point picking a billing period that hasn't happened yet.
//
// Used by the Platform Admin Billing page and the Platform Reports
// page so the navigation feels identical on both surfaces.

export default function MonthNavigator({
  value,
  onChange,
  disableFuture = true,
  clearable = true,
  className = "",
}) {
  const currentYm = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const baseYm = value || currentYm();

  const step = (delta) => {
    const [y, m] = baseYm.split("-").map((s) => parseInt(s, 10));
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    onChange(next);
  };

  const isAtCurrent = baseYm >= currentYm();
  const forwardDisabled = disableFuture && isAtCurrent;

  return (
    <div
      className={`inline-flex items-center gap-1 bg-surface rounded-lg border border-gray-200 dark:border-slate-700 px-1.5 py-1 ${className}`}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-400 hover:text-gray-900 transition"
        title="Previous month"
        aria-label="Previous month"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase pl-1">
        Month
      </span>
      <input
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm focus:outline-none bg-transparent dark:text-slate-100 px-1"
      />
      <button
        type="button"
        onClick={() => step(+1)}
        disabled={forwardDisabled}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-400 hover:text-gray-900 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title={
          forwardDisabled
            ? "Already at the current month"
            : "Next month"
        }
        aria-label="Next month"
      >
        <ChevronRight size={16} />
      </button>
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-800 underline pr-1"
          title="Show all months"
        >
          clear
        </button>
      )}
    </div>
  );
}
