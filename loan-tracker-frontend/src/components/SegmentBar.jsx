import React from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";

// Saved-segments bar — presentational chips for the named filter snapshots
// managed by useFilterSegments. Pairs with that hook on any list page.
// localStorage-only; no server involvement.
export default function SegmentBar({
  segments,
  onApply,
  onDelete,
  onSave,
  canSave,
  className = "",
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Bookmark size={14} /> Segments
      </span>
      {segments.length === 0 && (
        <span className="text-xs text-slate-400 dark:text-slate-500">
          None saved yet — set filters, then save this view.
        </span>
      )}
      {segments.map((seg) => (
        <span
          key={seg.id}
          className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 bg-ocean-50 dark:bg-ocean-900/40 text-ocean-700 dark:text-ocean-200 rounded-full text-xs font-semibold"
        >
          <button
            type="button"
            onClick={() => onApply(seg)}
            className="hover:text-ocean-900 dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 rounded"
          >
            {seg.name}
          </button>
          <button
            type="button"
            onClick={() => onDelete(seg.id)}
            aria-label={`Delete segment ${seg.name}`}
            className="text-ocean-400 hover:text-rose-600"
          >
            <Trash2 size={12} />
          </button>
        </span>
      ))}
      {canSave && (
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-1 px-3 py-1 border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-full text-xs font-semibold hover:border-ocean-400 hover:text-ocean-700 dark:hover:text-ocean-300 transition"
        >
          <Plus size={12} /> Save current
        </button>
      )}
    </div>
  );
}
