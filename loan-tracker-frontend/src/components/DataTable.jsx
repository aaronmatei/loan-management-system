import React from "react";
import { ChevronDown, ChevronRight, ArrowRight, SlidersHorizontal } from "lucide-react";
import SortableHeader from "./SortableHeader";
import Skeleton from "./Skeleton";
import { formatKES } from "../utils/money";

// Shared accessible data table — promoted from the Loans pilot. Owns the
// PRESENTATION (sticky pinned column, column presets, expandable detail
// rows, sticky header, totals footer, skeleton, scroll affordance, a11y
// rows). The page owns the DATA (sorting, pagination, filtering, bulk
// selection) and passes already-prepared rows in.
//
// Column shape:
//   { key, label, align: "left"|"right", cell: (row) => node,
//     money?: bool, total?: (rows) => number, totalClass?: string,
//     footer?: (rows) => node }        // custom footer cell (overrides total)
//
// Pinned column (sticky first content column):
//   pinned = { label, sortKey?, cell: (row) => node }
//
// Presets (optional): { key: { label, keys: [...] } } + preset/onPresetChange.
// When a preset hides columns, each row gets an expand toggle that reveals
// the hidden columns in a detail panel — so nothing is ever truly hidden.

export default function DataTable({
  columns,
  rows,
  rowKey,
  pinned,
  presets,
  preset,
  onPresetChange,
  expandedRows,
  onToggleRow,
  selection,
  sort,
  onRowClick,
  onOpen,
  openLabel,
  totals,
  totalsLabel,
  loading = false,
  skeletonRows = 8,
  skeletonCols = 6,
  empty = null,
  maxHeight = "calc(100vh - 400px)",
  className = "",
}) {
  if (loading) {
    return <TableSkeleton rows={skeletonRows} cols={skeletonCols} />;
  }
  if (!rows || rows.length === 0) {
    return empty;
  }

  const visibleKeys = presets && preset ? presets[preset].keys : null;
  const visibleColumns = visibleKeys
    ? columns.filter((c) => visibleKeys.includes(c.key))
    : columns;
  const hiddenColumns = visibleKeys
    ? columns.filter((c) => !visibleKeys.includes(c.key))
    : [];

  const hasSelect = !!selection;
  const hasOpen = !!(onOpen || onRowClick);
  // sticky offsets: select(w-10)=left-0, pinned=left-10 (or left-0 if no select)
  const pinnedLeft = hasSelect ? "left-10" : "left-0";
  // colSpan for the expanded detail row
  const totalColCount =
    visibleColumns.length + 1 + (hasSelect ? 1 : 0) + (hasOpen ? 1 : 0);

  const open = onOpen || onRowClick;

  return (
    <div
      className={`bg-white dark:bg-slate-800 rounded-xl shadow-card overflow-hidden ${className}`}
    >
      {presets && preset && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex-wrap">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <SlidersHorizontal size={15} /> Columns
          </span>
          <div
            className="inline-flex rounded-lg bg-gray-100 dark:bg-slate-700 p-0.5"
            role="group"
            aria-label="Column preset"
          >
            {Object.entries(presets).map(([key, p]) => (
              <button
                key={key}
                type="button"
                aria-pressed={preset === key}
                onClick={() => onPresetChange(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 ${
                  preset === key
                    ? "bg-white dark:bg-slate-800 text-ocean-700 dark:text-ocean-300 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <div
          className="overflow-auto"
          style={{ maxHeight }}
          role="region"
          aria-label="Data table — scroll horizontally for more columns"
          tabIndex={0}
        >
          <table className="w-full whitespace-nowrap [&_tbody_td]:align-top">
            <thead className="bg-gray-50 dark:bg-slate-900/60 border-b-2 border-gray-200 dark:border-slate-700 sticky top-0 z-20 shadow-sm">
              <tr>
                {hasSelect && (
                  <th className="px-4 py-4 w-10 sticky left-0 z-30 bg-gray-50 dark:bg-slate-900">
                    <input
                      type="checkbox"
                      checked={selection.allSelected}
                      onChange={selection.toggleAll}
                      className="w-4 h-4 cursor-pointer"
                      aria-label="Select all rows on this page"
                    />
                  </th>
                )}
                {pinned &&
                  (pinned.sortKey && sort ? (
                    <SortableHeader
                      label={pinned.label}
                      sortKey={pinned.sortKey}
                      requestSort={sort.requestSort}
                      getSortIndicator={sort.getSortIndicator}
                      align="left"
                      className={`px-4 py-4 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase sticky ${pinnedLeft} z-30 bg-gray-50 dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700`}
                    />
                  ) : (
                    <th
                      className={`px-4 py-4 text-left text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase sticky ${pinnedLeft} z-30 bg-gray-50 dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700`}
                    >
                      {pinned.label}
                    </th>
                  ))}
                {visibleColumns.map((col) =>
                  col.sortable !== false && sort ? (
                    <SortableHeader
                      key={col.key}
                      label={col.label}
                      sortKey={col.key}
                      requestSort={sort.requestSort}
                      getSortIndicator={sort.getSortIndicator}
                      align={col.align}
                      className={`px-4 py-4 text-${col.align} text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase`}
                    />
                  ) : (
                    <th
                      key={col.key}
                      className={`px-4 py-4 text-${col.align} text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase`}
                    >
                      {col.label}
                    </th>
                  ),
                )}
                {hasOpen && (
                  <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase">
                    View
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const id = rowKey(row);
                const isSel = selection?.isSelected(id) || false;
                const expanded = expandedRows?.has(id) || false;
                const canExpand =
                  hiddenColumns.length > 0 && !!onToggleRow;
                const stickyBg = isSel
                  ? "bg-ocean-50 dark:bg-ocean-900/30"
                  : "bg-white dark:bg-slate-800 group-hover:bg-ocean-50 dark:group-hover:bg-slate-700/60";

                return (
                  <React.Fragment key={id}>
                    <tr
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`group border-b border-gray-100 dark:border-slate-700 transition ${
                        onRowClick ? "cursor-pointer" : ""
                      } ${
                        isSel
                          ? "bg-ocean-50 dark:bg-ocean-900/30"
                          : "hover:bg-ocean-50 dark:hover:bg-slate-700/60"
                      }`}
                    >
                      {hasSelect && (
                        <td
                          className={`px-4 py-4 sticky left-0 z-10 ${stickyBg}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => selection.toggle(id)}
                            className="w-4 h-4 cursor-pointer"
                            aria-label="Select row"
                          />
                        </td>
                      )}
                      {pinned && (
                        <td
                          className={`px-4 py-4 sticky ${pinnedLeft} z-10 border-r border-gray-100 dark:border-slate-700 ${stickyBg}`}
                        >
                          <div className="flex items-start gap-2">
                            {canExpand && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleRow(id);
                                }}
                                aria-expanded={expanded}
                                aria-label={
                                  expanded ? "Hide details" : "Show details"
                                }
                                className="mt-0.5 text-gray-400 hover:text-ocean-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400"
                              >
                                {expanded ? (
                                  <ChevronDown size={16} />
                                ) : (
                                  <ChevronRight size={16} />
                                )}
                              </button>
                            )}
                            <div className="min-w-0">{pinned.cell(row)}</div>
                          </div>
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-4 text-${col.align} text-slate-700 dark:text-slate-200`}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                      {hasOpen && (
                        <td
                          className="px-4 py-4 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => open(row)}
                            aria-label={
                              openLabel ? openLabel(row) : "Open row"
                            }
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-ocean-600 hover:bg-ocean-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 transition"
                          >
                            <ArrowRight size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                    {expanded && canExpand && (
                      <tr className="bg-ocean-50/40 dark:bg-slate-700/30 border-b border-gray-100 dark:border-slate-700">
                        <td colSpan={totalColCount} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 pl-12">
                            {hiddenColumns.map((col) => (
                              <div
                                key={col.key}
                                className={col.fullSpan ? "col-span-full" : undefined}
                              >
                                {col.label && (
                                  <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 font-semibold mb-0.5">
                                    {col.label}
                                  </p>
                                )}
                                {col.cell(row)}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>

            {totals && (
              <tfoot className="bg-ocean-gradient-soft dark:bg-slate-900/70 border-t-2 border-ocean-200 dark:border-slate-700">
                <tr>
                  {hasSelect && (
                    <td className="px-4 py-4 sticky left-0 z-10 bg-ocean-50 dark:bg-slate-900" />
                  )}
                  {pinned && (
                    <td
                      className={`px-4 py-4 font-bold text-gray-800 dark:text-slate-100 text-sm sticky ${pinnedLeft} z-10 bg-ocean-50 dark:bg-slate-900 border-r border-ocean-200 dark:border-slate-700`}
                    >
                      {totalsLabel || `TOTALS (${totals.length})`}
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-4 text-${col.align}`}
                    >
                      {col.footer ? (
                        col.footer(totals)
                      ) : col.money && col.total ? (
                        <p
                          className={`font-bold text-sm ${col.totalClass || "text-gray-800 dark:text-slate-100"}`}
                        >
                          {formatKES(col.total(totals))}
                        </p>
                      ) : null}
                    </td>
                  ))}
                  {hasOpen && <td className="px-4 py-4" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {/* horizontal-scroll affordance */}
        <div className="pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l from-slate-900/5 dark:from-black/30 to-transparent" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows, cols }) {
  return (
    <div
      className="bg-white dark:bg-slate-800 rounded-xl shadow-card overflow-hidden"
      aria-busy="true"
    >
      <div className="px-4 py-4 border-b border-gray-100 dark:border-slate-700 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="px-4 py-4 border-b border-gray-50 dark:border-slate-700/60 flex gap-4"
        >
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
