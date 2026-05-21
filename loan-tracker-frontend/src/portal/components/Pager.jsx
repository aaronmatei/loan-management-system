import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Client-side pagination control shared by the portal tables. Renders a
// windowed set of page numbers (±2 around the current page) with first/last
// shortcuts and prev/next arrows. Renders nothing for a single page.
export default function Pager({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;
  const span = 2;
  const from = Math.max(1, page - span);
  const to = Math.min(pageCount, page + span);
  const pages = [];
  for (let i = from; i <= to; i++) pages.push(i);
  const num = "w-9 h-9 rounded-lg text-sm font-semibold";

  return (
    <div className="flex items-center justify-center gap-1 mt-5">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      {from > 1 && (
        <>
          <button
            onClick={() => onChange(1)}
            className={`${num} text-slate-600 hover:bg-slate-50`}
          >
            1
          </button>
          {from > 2 && <span className="px-1 text-slate-400">…</span>}
        </>
      )}
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`${num} ${
            p === page
              ? "bg-ocean-gradient text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {p}
        </button>
      ))}
      {to < pageCount && (
        <>
          {to < pageCount - 1 && <span className="px-1 text-slate-400">…</span>}
          <button
            onClick={() => onChange(pageCount)}
            className={`${num} text-slate-600 hover:bg-slate-50`}
          >
            {pageCount}
          </button>
        </>
      )}
      <button
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
