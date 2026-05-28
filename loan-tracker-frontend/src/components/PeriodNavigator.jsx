// Unified time-window picker used across Dashboard, Reports and
// Analytics. Two modes — Month or Year — with arrow steppers on
// either side of a native picker. Forward stepper disables once the
// current calendar month/year is reached (no future data to show).
//
// Companion helpers:
//   periodToRange(period)  → { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
//   periodLabel(period)    → "March 2026" / "2026"
//   usePersistentPeriod()  → React hook with localStorage + URL sync
//
// Period shape:
//   { mode: 'month' | 'year', value: 'YYYY-MM' | 'YYYY' }

import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

// ─── Pure helpers ──────────────────────────────────────────────

export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const currentYear = () => String(new Date().getFullYear());

export function periodToRange(period) {
  if (!period) return { from: null, to: null };
  if (period.mode === "year") {
    const y = parseInt(period.value, 10);
    if (!y) return { from: null, to: null };
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  // month mode
  const [y, m] = (period.value || "").split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return { from: null, to: null };
  // Last day of the month: day 0 of the NEXT month.
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function periodLabel(period) {
  if (!period) return "";
  if (period.mode === "year") return period.value || "";
  const [y, m] = (period.value || "").split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
}

// Step ±1 month or ±1 year on the current value.
export function steppedPeriod(period, delta) {
  if (period.mode === "year") {
    const y = (parseInt(period.value, 10) || new Date().getFullYear()) + delta;
    return { mode: "year", value: String(y) };
  }
  const [y, m] = (period.value || currentMonth())
    .split("-")
    .map((s) => parseInt(s, 10));
  const d = new Date(y, m - 1 + delta, 1);
  return {
    mode: "month",
    value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
  };
}

const isAtOrPastCurrent = (period) => {
  if (period.mode === "year") {
    return (parseInt(period.value, 10) || 0) >= new Date().getFullYear();
  }
  return (period.value || "") >= currentMonth();
};

// ─── usePersistentPeriod hook ──────────────────────────────────
// localStorage key + URL ?period= sync. URL takes precedence on load
// so shared links open the same window; subsequent changes write
// back to both.

const STORAGE_KEY = "loanfix:period";

function readFromUrl(search) {
  const sp = new URLSearchParams(search);
  const periodParam = sp.get("period");
  if (!periodParam) return null;
  // YYYY-MM → month, YYYY → year
  if (/^\d{4}-\d{2}$/.test(periodParam)) {
    return { mode: "month", value: periodParam };
  }
  if (/^\d{4}$/.test(periodParam)) {
    return { mode: "year", value: periodParam };
  }
  return null;
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && (p.mode === "month" || p.mode === "year") && p.value) return p;
  } catch {
    /* ignore */
  }
  return null;
}

export function usePersistentPeriod() {
  const navigate = useNavigate();
  const location = useLocation();

  const initial =
    readFromUrl(location.search) ||
    readFromStorage() || { mode: "month", value: currentMonth() };

  const [period, setPeriod] = React.useState(initial);

  // Push changes to both localStorage and the URL query string. The
  // URL update uses replace: true so back-button navigation doesn't
  // accumulate one entry per arrow click.
  const update = React.useCallback(
    (next) => {
      setPeriod(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      const sp = new URLSearchParams(location.search);
      sp.set("period", next.value);
      navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  // Sync the URL on mount if the location lacks a ?period= but we
  // restored one from storage — keeps the URL self-describing.
  React.useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (!sp.get("period")) {
      sp.set("period", period.value);
      navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [period, update];
}

// ─── PeriodNavigator component ─────────────────────────────────

export default function PeriodNavigator({
  value,
  onChange,
  disableFuture = true,
  className = "",
}) {
  const forwardDisabled = disableFuture && isAtOrPastCurrent(value);

  const switchMode = (mode) => {
    if (mode === value.mode) return;
    // Carry the year over when switching modes so the user keeps context.
    if (mode === "year") {
      const y = value.value?.split("-")[0] || currentYear();
      onChange({ mode: "year", value: y });
    } else {
      const y = value.value || currentYear();
      onChange({
        mode: "month",
        // Default to month 1 of that year, then user can step.
        value: `${y}-01`,
      });
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-2 py-1.5 shadow-sm ${className}`}
    >
      {/* Mode toggle */}
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {[
          { v: "month", l: "Month" },
          { v: "year", l: "Year" },
        ].map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => switchMode(t.v)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
              value.mode === t.v
                ? "bg-white text-ocean-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-slate-200" />

      {/* Backward arrow */}
      <button
        type="button"
        onClick={() => onChange(steppedPeriod(value, -1))}
        className="p-1 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition"
        title={value.mode === "year" ? "Previous year" : "Previous month"}
      >
        <ChevronLeft size={16} />
      </button>

      {/* Native picker — month or year */}
      <div className="inline-flex items-center gap-1.5">
        <Calendar size={14} className="text-slate-400" />
        {value.mode === "year" ? (
          <input
            type="number"
            min="2000"
            max={new Date().getFullYear() + (disableFuture ? 0 : 5)}
            value={value.value}
            onChange={(e) =>
              e.target.value &&
              onChange({ mode: "year", value: e.target.value })
            }
            className="w-16 text-sm font-semibold text-slate-800 bg-transparent focus:outline-none"
          />
        ) : (
          <input
            type="month"
            value={value.value}
            onChange={(e) =>
              e.target.value &&
              onChange({ mode: "month", value: e.target.value })
            }
            className="text-sm font-semibold text-slate-800 bg-transparent focus:outline-none"
          />
        )}
      </div>

      {/* Forward arrow */}
      <button
        type="button"
        onClick={() => onChange(steppedPeriod(value, +1))}
        disabled={forwardDisabled}
        className="p-1 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title={
          forwardDisabled
            ? "Already at the current period"
            : value.mode === "year"
              ? "Next year"
              : "Next month"
        }
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
