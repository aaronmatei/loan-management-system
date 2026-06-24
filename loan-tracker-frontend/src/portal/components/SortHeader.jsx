import React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

// Sortable table-header cell shared by the portal tables. `sort` is
// { key, dir }; clicking calls onToggle(sortKey). Every header shows an icon
// so it reads as clickable — a faded up/down when inactive, the active
// direction when it's the current sort.
export default function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
  align = "right",
}) {
  const activeCol = sort.key === sortKey;
  const Icon = !activeCol
    ? ChevronsUpDown
    : sort.dir === "asc"
      ? ChevronUp
      : ChevronDown;
  return (
    <th
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 font-semibold cursor-pointer select-none hover:text-navy-900 dark:hover:text-slate-100 ${
          activeCol ? "text-navy-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"
        }`}
      >
        {label}
        <Icon size={13} className={activeCol ? "" : "opacity-40"} />
      </button>
    </th>
  );
}
