import React from "react";

/**
 * Floating bottom bar shown when rows are selected. `left-64` matches
 * the Layout sidebar width (w-64).
 */
function BulkActionBar({ selectedCount, totalCount, onClear, children }) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-64 right-0 bg-gradient-to-r from-indigo-600 to-purple-700 text-white shadow-2xl z-40">
      <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{selectedCount}</span>
            <span className="text-indigo-100">
              {selectedCount === 1 ? "item" : "items"} selected
              {totalCount ? ` of ${totalCount}` : ""}
            </span>
          </div>
          <button
            onClick={onClear}
            className="text-indigo-100 hover:text-white text-sm underline"
          >
            Clear selection
          </button>
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export default BulkActionBar;
