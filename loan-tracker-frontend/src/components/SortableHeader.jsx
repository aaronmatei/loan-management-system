import React from "react";

/**
 * Clickable <th> wired to a `useSortableTable` hook.
 *
 * Padding-agnostic by default — pass the same className you would on
 * a plain <th> (e.g. "px-6 py-4 text-xs font-semibold text-gray-600
 * uppercase") and it'll slot in next to existing headers without
 * changing the row height. Adds cursor-pointer + hover bg + an
 * indicator (⇅ / ↑ / ↓).
 */
function SortableHeader({
  label,
  sortKey,
  requestSort,
  getSortIndicator,
  align = "left",
  className = "p-3",
}) {
  const indicator = getSortIndicator(sortKey);
  const isActive = indicator !== "⇅";
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "";

  return (
    <th
      onClick={() => requestSort(sortKey)}
      className={`cursor-pointer hover:bg-gray-100 transition select-none ${className}`}
    >
      <div className={`flex items-center gap-1 ${justify}`}>
        <span>{label}</span>
        <span
          className={`text-xs ${
            isActive ? "text-indigo-600 font-bold" : "text-gray-400"
          }`}
        >
          {indicator}
        </span>
      </div>
    </th>
  );
}

export default SortableHeader;
