import { useState, useMemo } from "react";

/**
 * Client-side sort for list tables.
 *
 * Usage:
 *   const { sortedData, requestSort, getSortIndicator } =
 *     useSortableTable(rows, "created_at", "desc");
 *   <SortableHeader label="Date" sortKey="created_at" ... />
 *
 * - `sortedData` is a *new* sorted array (input not mutated).
 * - Nested keys via dot notation: "client.first_name".
 * - Date columns (keys containing "date" or "_at") are parsed via
 *   `new Date(...).getTime()`.
 * - Numeric strings ("12500") compare as numbers; pure strings are
 *   compared case-insensitively.
 * - null/undefined sort to the end regardless of direction.
 */
export function useSortableTable(
  data = [],
  defaultKey = null,
  defaultDirection = "asc",
) {
  const [sortConfig, setSortConfig] = useState({
    key: defaultKey,
    direction: defaultDirection,
  });

  const sortedData = useMemo(() => {
    if (!sortConfig.key || !data || data.length === 0) return data;

    const keyPath = sortConfig.key.split(".");
    const isDateLike =
      sortConfig.key.includes("date") || sortConfig.key.includes("_at");

    return [...data].sort((a, b) => {
      let aVal = keyPath.reduce((o, k) => (o == null ? o : o[k]), a);
      let bVal = keyPath.reduce((o, k) => (o == null ? o : o[k]), b);

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (isDateLike) {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      } else if (!isNaN(parseFloat(aVal)) && !isNaN(parseFloat(bVal))) {
        aVal = parseFloat(aVal);
        bVal = parseFloat(bVal);
      } else if (typeof aVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = String(bVal).toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  const requestSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key && prev.direction === "asc"
        ? { key, direction: "desc" }
        : { key, direction: "asc" },
    );
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return "⇅";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  return { sortedData, requestSort, sortConfig, getSortIndicator };
}
