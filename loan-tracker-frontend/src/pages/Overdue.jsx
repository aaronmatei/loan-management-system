import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import { bulkExport } from "../utils/bulkExport";

// Days-late badge colour, 4 severity tiers
function daysBadgeClass(days) {
  if (days > 90) return "bg-red-200 text-red-900";
  if (days >= 31) return "bg-red-100 text-red-700";
  if (days >= 8) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
}

const RANGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "1-7", label: "1-7 days late" },
  { key: "8-30", label: "8-30 days late" },
  { key: "31-90", label: "31-90 days late" },
  { key: "90+", label: "90+ days late" },
];

function inRange(days, range) {
  if (range === "1-7") return days >= 1 && days <= 7;
  if (range === "8-30") return days >= 8 && days <= 30;
  if (range === "31-90") return days >= 31 && days <= 90;
  if (range === "90+") return days > 90;
  return true; // "all"
}

const KES = (n) => `KES ${Number(n || 0).toLocaleString()}`;

function Overdue() {
  const navigate = useNavigate();
  const [overdueList, setOverdueList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
    fetchOverdueData();
  }, []);

  // Reset to first page whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, severityFilter]);

  const fetchOverdueData = async () => {
    try {
      setLoading(true);
      setError("");
      // Default limit is large so we can paginate client-side
      const response = await api.get("/overdue");
      setOverdueList(response.data.data || []);
      setSummary(response.data.summary || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load overdue payments");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError("");
      await api.post("/overdue/refresh");
      await fetchOverdueData();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  // Client-side filtering: severity range + search
  const filtered = overdueList.filter((p) => {
    const days = parseInt(p.days_late, 10) || 0;
    if (!inRange(days, severityFilter)) return false;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const haystack = [
        p.first_name,
        p.last_name,
        p.phone_number,
        p.loan_code,
        p.client_code,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Totals for the currently-displayed (filtered) set
  const filteredAmountDue = filtered.reduce(
    (s, p) => s + parseFloat(p.amount_due || 0),
    0,
  );
  const filteredBalance = filtered.reduce(
    (s, p) => s + parseFloat(p.balance_due || 0),
    0,
  );
  const filteredLoans = new Set(filtered.map((p) => p.loan_id)).size;

  // Pagination math (same pattern as Clients/Loans pages)
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginated = filtered.slice(startIndex, endIndex);

  // Severity counts for the dropdown — from the API summary so they
  // reflect the full data set, not the current page
  const sb = summary?.severity_breakdown;
  const rangeCounts = {
    all: summary?.total_overdue_count ?? overdueList.length,
    "1-7": sb?.days_1_to_7?.count ?? 0,
    "8-30": sb?.days_8_to_30?.count ?? 0,
    "31-90": sb?.days_31_to_90?.count ?? 0,
    "90+": sb?.days_over_90?.count ?? 0,
  };

  const totalOverdueAmount = summary?.total_overdue_amount ?? 0;
  const totalOverdueCount = summary?.total_overdue_count ?? overdueList.length;

  // "30+ days" summary card combines 31-90 and 90+
  const card30PlusCount =
    (sb?.days_31_to_90?.count ?? 0) + (sb?.days_over_90?.count ?? 0);
  const card30PlusAmount =
    (sb?.days_31_to_90?.amount ?? 0) + (sb?.days_over_90?.amount ?? 0);

  const filtersActive =
    searchQuery.trim() !== "" || severityFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setSeverityFilter("all");
  };

  // ── Bulk selection (keyed by schedule id) ───────────────────
  const bulk = useBulkSelection(paginated);
  const selectedRows = overdueList.filter((p) => bulk.isSelected(p.id));
  const selectedClientIds = [
    ...new Set(selectedRows.map((p) => p.client_id)),
  ];
  const selectedLoanIds = [...new Set(selectedRows.map((p) => p.loan_id))];

  const handleBulkExport = async () => {
    try {
      // Reuse the loans bulk export for the distinct loans behind the
      // selected overdue installments (no overdue-specific endpoint).
      await bulkExport(
        "/loans/bulk/export",
        { loan_ids: selectedLoanIds },
        `selected_overdue_loans_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      bulk.clear();
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            ⚠️ Overdue Payments
          </h1>
          <p className="text-gray-600 mt-1">
            Total:{" "}
            <span className="font-semibold">{totalOverdueCount}</span> overdue
            payments • <span className="font-semibold">
              {KES(totalOverdueAmount)}
            </span>{" "}
            outstanding
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshing ? "⏳ Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading overdue payments...
        </div>
      ) : overdueList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No overdue payments! Great job!
          </h3>
          <p className="text-gray-500">
            Every scheduled installment is on track.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-red-500 to-rose-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-red-100 text-sm uppercase font-semibold">
                Total Overdue
              </p>
              <p className="text-3xl font-bold mt-2">{totalOverdueCount}</p>
              <p className="text-red-100 text-sm mt-2">
                {KES(totalOverdueAmount)}
              </p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-xl shadow-md p-6">
              <p className="text-yellow-700 text-sm uppercase font-semibold">
                1-7 Days Late
              </p>
              <p className="text-3xl font-bold mt-2 text-yellow-800">
                {sb?.days_1_to_7?.count ?? 0}
              </p>
              <p className="text-yellow-700 text-sm mt-2">
                {KES(sb?.days_1_to_7?.amount)}
              </p>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl shadow-md p-6">
              <p className="text-orange-700 text-sm uppercase font-semibold">
                8-30 Days Late
              </p>
              <p className="text-3xl font-bold mt-2 text-orange-800">
                {sb?.days_8_to_30?.count ?? 0}
              </p>
              <p className="text-orange-700 text-sm mt-2">
                {KES(sb?.days_8_to_30?.amount)}
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl shadow-md p-6">
              <p className="text-red-700 text-sm uppercase font-semibold">
                30+ Days Late
              </p>
              <p className="text-3xl font-bold mt-2 text-red-800">
                {card30PlusCount}
              </p>
              <p className="text-red-700 text-sm mt-2">
                {KES(card30PlusAmount)}
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by client name, phone, or loan code..."
                    className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none bg-white font-semibold text-gray-700"
              >
                {RANGE_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({rangeCounts[f.key]})
                  </option>
                ))}
              </select>

              {filtersActive && (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition"
                >
                  ✖ Clear
                </button>
              )}
            </div>

            {/* Active filter tags */}
            {filtersActive && (
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                <span className="text-sm text-gray-500">
                  Showing{" "}
                  <span className="font-semibold text-gray-800">
                    {filtered.length}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-gray-800">
                    {overdueList.length}
                  </span>
                </span>
                {searchQuery.trim() && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                    Search: "{searchQuery.trim()}"
                    <button
                      onClick={() => setSearchQuery("")}
                      className="hover:text-red-900"
                      aria-label="Clear search"
                    >
                      ✖
                    </button>
                  </span>
                )}
                {severityFilter !== "all" && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">
                    {
                      RANGE_FILTERS.find((f) => f.key === severityFilter)
                        ?.label
                    }
                    <button
                      onClick={() => setSeverityFilter("all")}
                      className="hover:text-orange-900"
                      aria-label="Clear severity filter"
                    >
                      ✖
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-gray-600 mb-2">
                No payments match your filters
              </h3>
              <p className="text-gray-500 mb-4">
                Try a different severity range or clear your search
              </p>
              <button
                onClick={clearFilters}
                className="px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
              >
                ✖ Clear Filters
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-auto max-h-[calc(100vh-400px)]">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-4 w-10">
                        <input
                          type="checkbox"
                          checked={bulk.allOnPageSelected}
                          onChange={bulk.togglePage}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Client
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Loan Code
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Payment #
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Due Date
                      </th>
                      <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                        Days Late
                      </th>
                      <th className="px-4 py-4 text-right text-xs font-semibold text-gray-600 uppercase">
                        Amount Due
                      </th>
                      <th className="px-4 py-4 text-right text-xs font-semibold text-gray-600 uppercase">
                        Balance
                      </th>
                      <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((p) => {
                      const days = parseInt(p.days_late, 10) || 0;
                      const totalInLoan =
                        p.total_payments_in_loan || p.total_payments || "?";
                      return (
                        <tr
                          key={p.schedule_id || p.id}
                          className={`border-b border-gray-100 hover:bg-red-50 transition ${
                            bulk.isSelected(p.id) ? "bg-red-50" : ""
                          }`}
                        >
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={bulk.isSelected(p.id)}
                              onChange={() => bulk.toggle(p.id)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-gray-800 text-sm">
                              {p.first_name} {p.last_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {p.phone_number}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <button
                              onClick={() => navigate(`/loans/${p.loan_id}`)}
                              className="font-mono text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                              {p.loan_code}
                            </button>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            Payment {p.payment_number} of {totalInLoan}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {new Date(p.due_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${daysBadgeClass(
                                days,
                              )}`}
                            >
                              {days} {days === 1 ? "day" : "days"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-semibold text-gray-700">
                            {KES(p.amount_due)}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="font-bold text-red-600 text-sm">
                              {KES(p.balance_due)}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() => navigate(`/loans/${p.loan_id}`)}
                              className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-700 text-white text-xs font-semibold rounded-lg hover:shadow-lg transition"
                            >
                              View Loan
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* TOTALS ROW */}
                  <tfoot className="bg-gradient-to-r from-red-50 to-rose-50 border-t-2 border-red-200">
                    <tr>
                      <td
                        colSpan="6"
                        className="px-4 py-4 font-bold text-gray-800 text-sm"
                      >
                        📊 TOTALS — {filtered.length} overdue •{" "}
                        {filteredLoans} loans
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-gray-800 text-sm">
                        {KES(filteredAmountDue)}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-red-700 text-sm">
                        {KES(filteredBalance)}
                      </td>
                      <td className="px-4 py-4"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Pagination (same component as Clients/Loans) */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 border-t border-gray-200">
                  <div className="text-sm text-gray-600">
                    Showing{" "}
                    <span className="font-semibold">{startIndex + 1}</span> to{" "}
                    <span className="font-semibold">
                      {Math.min(endIndex, filtered.length)}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold">{filtered.length}</span>{" "}
                    results
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      ← Previous
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(
                          (page) =>
                            page === 1 ||
                            page === totalPages ||
                            (page >= currentPage - 2 &&
                              page <= currentPage + 2),
                        )
                        .map((page, idx, arr) => {
                          const showEllipsisBefore =
                            idx > 0 && page - arr[idx - 1] > 1;
                          return (
                            <React.Fragment key={page}>
                              {showEllipsisBefore && (
                                <span className="px-2 text-gray-400">...</span>
                              )}
                              <button
                                onClick={() => setCurrentPage(page)}
                                className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                                  currentPage === page
                                    ? "bg-red-600 text-white"
                                    : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                                }`}
                              >
                                {page}
                              </button>
                            </React.Fragment>
                          );
                        })}
                    </div>

                    <button
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <BulkActionBar
        selectedCount={bulk.count}
        totalCount={filtered.length}
        onClear={bulk.clear}
      >
        <button
          onClick={handleBulkExport}
          className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          ⬇️ Export
        </button>

        <BulkMessaging
          clientIds={selectedClientIds}
          onComplete={bulk.clear}
        />
      </BulkActionBar>
    </div>
  );
}

export default Overdue;
