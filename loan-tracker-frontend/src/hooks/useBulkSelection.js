import { useState, useMemo, useCallback } from "react";

/**
 * Multi-select state for paginated tables. Selection is a Set of ids
 * kept across pagination (per the spec). `pageItems` is the rows
 * currently rendered (for the select-all-on-page checkbox).
 *
 * @param {Array}  pageItems - rows on the current page
 * @param {string} idKey     - id field on each row (default "id")
 */
export function useBulkSelection(pageItems = [], idKey = "id") {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const allOnPageSelected = useMemo(
    () =>
      pageItems.length > 0 &&
      pageItems.every((it) => selectedIds.has(it[idKey])),
    [pageItems, selectedIds, idKey],
  );

  const togglePage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected =
        pageItems.length > 0 &&
        pageItems.every((it) => next.has(it[idKey]));
      pageItems.forEach((it) =>
        everySelected ? next.delete(it[idKey]) : next.add(it[idKey]),
      );
      return next;
    });
  }, [pageItems, idKey]);

  return {
    selectedIds,
    selectedArray: Array.from(selectedIds),
    count: selectedIds.size,
    isSelected: (id) => selectedIds.has(id),
    toggle,
    togglePage,
    clear,
    allOnPageSelected,
  };
}

export default useBulkSelection;
