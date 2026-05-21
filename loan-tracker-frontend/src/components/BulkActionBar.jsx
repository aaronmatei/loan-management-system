import React from "react";

/**
 * Floating bottom bar shown when rows are selected. Full-width on
 * mobile (sidebar is off-canvas); offset by the w-64 sidebar on lg+.
 */
function BulkActionBar({ selectedCount, totalCount, onClear, children }) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-ocean-gradient text-white shadow-2xl z-40">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-3 lg:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center justify-between sm:justify-start gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xl lg:text-2xl font-bold">
                {selectedCount}
              </span>
              <span className="text-ocean-100 text-sm lg:text-base">
                selected
                {totalCount ? (
                  <span className="hidden sm:inline"> of {totalCount}</span>
                ) : null}
              </span>
            </div>
            <button
              onClick={onClear}
              className="text-ocean-100 hover:text-white text-xs lg:text-sm underline"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-1 lg:gap-2 overflow-x-auto pb-1 sm:pb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BulkActionBar;
