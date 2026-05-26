import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RotateCcw, PartyPopper, Search, X, Download, BarChart3, ChevronRight, ChevronDown } from "lucide-react";
import api from "../services/api";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import { bulkExport } from "../utils/bulkExport";
import { useSortableTable } from "../hooks/useSortableTable";
import SortableHeader from "../components/SortableHeader";

// Days-late badge colour, 4 severity tiers
function daysBadgeClass(days) {
  if (days > 90) return "bg-red-200 text-red-900";
  if (days >= 31) return "bg-red-100 text-red-700";
  if (days >= 8) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
}

// Loan-status badge for the overdue rows (so defaulted loans stand out).
const LOAN_STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  defaulted: "bg-red-100 text-red-700",
  suspended: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
};

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
  const [defaulting, setDefaulting] = useState(false);
  const [error, setError] = useState("");

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Which loans are expanded to reveal their overdue installments.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (loanId) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(loanId) ? next.delete(loanId) : next.add(loanId);
      return next;
    });

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
  const filteredPenalty = filtered.reduce(
    (s, p) =>
      s + parseFloat(p.penalty_outstanding ?? p.penalty_total ?? 0),
    0,
  );

  // Group overdue installments into ONE entry per loan, with its installments
  // nested for the expand view. Group-level fields (days_late = worst,
  // amount_due/balance_due = sums, oldest_due_date) drive sorting + display.
  const loanGroups = (() => {
    const map = new Map();
    for (const p of filtered) {
      let g = map.get(p.loan_id);
      if (!g) {
        g = {
          id: p.loan_id, // bulk-selection key (one selection per loan)
          loan_id: p.loan_id,
          loan_code: p.loan_code,
          client_id: p.client_id,
          first_name: p.first_name,
          last_name: p.last_name,
          phone_number: p.phone_number,
          client_code: p.client_code,
          loan_status: p.loan_status,
          installments: [],
          overdue_count: 0,
          amount_due: 0,
          balance_due: 0,
          penalty_outstanding: 0,
          days_late: 0,
          oldest_due_date: p.due_date,
        };
        map.set(p.loan_id, g);
      }
      g.installments.push(p);
      g.overdue_count += 1;
      g.amount_due += parseFloat(p.amount_due || 0);
      g.balance_due += parseFloat(p.balance_due || 0);
      // Group-level "Penalty" = sum of what each installment still owes in
      // penalty (penalty_total − penalty_paid). Shrinks as the borrower pays.
      g.penalty_outstanding += parseFloat(
        p.penalty_outstanding ?? p.penalty_total ?? 0,
      );
      const d = parseInt(p.days_late, 10) || 0;
      if (d > g.days_late) g.days_late = d;
      if (new Date(p.due_date) < new Date(g.oldest_due_date))
        g.oldest_due_date = p.due_date;
    }
    for (const g of map.values())
      g.installments.sort(
        (a, b) => new Date(a.due_date) - new Date(b.due_date),
      );
    return [...map.values()];
  })();

  const filteredLoans = loanGroups.length;

  // Sort then paginate the LOANS — default: most overdue first
  const {
    sortedData: sortedGroups,
    requestSort,
    getSortIndicator,
  } = useSortableTable(loanGroups, "days_late", "desc");

  // Pagination math (same pattern as Clients/Loans pages)
  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginated = sortedGroups.slice(startIndex, endIndex);

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

  // ── Bulk selection (keyed by loan id — one selection per loan) ──
  const bulk = useBulkSelection(paginated);
  const selectedGroups = loanGroups.filter((g) => bulk.isSelected(g.id));
  const selectedClientIds = [
    ...new Set(selectedGroups.map((g) => g.client_id)),
  ];
  const selectedLoanIds = selectedGroups.map((g) => g.loan_id);

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

  // Mark the distinct loans behind the selected overdue installments as
  // defaulted (only active loans are affected; the backend skips the rest).
  const handleBulkDefault = async () => {
    const n = selectedLoanIds.length;
    if (!n) return;
    if (
      !window.confirm(
        `Mark ${n} loan${n !== 1 ? "s" : ""} as defaulted? Their pending installments will be flagged overdue. This can't be auto-undone.`,
      )
    )
      return;
    setDefaulting(true);
    try {
      const res = await api.post("/loans/bulk/default", {
        loan_ids: selectedLoanIds,
      });
      bulk.clear();
      await fetchOverdueData();
      const { defaulted, skipped } = res.data;
      alert(
        `${defaulted} loan${defaulted !== 1 ? "s" : ""} marked defaulted` +
          (skipped ? ` · ${skipped} skipped (not active).` : "."),
      );
    } catch (err) {
      alert(
        "Failed: " + (err.response?.data?.error || err.message),
      );
    } finally {
      setDefaulting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle size={28} className="text-red-500" /> Overdue Payments
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
          {refreshing ? "Refreshing..." : <span className="inline-flex items-center gap-1.5"><RotateCcw size={16} /> Refresh</span>}
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
          <PartyPopper size={56} className="mx-auto mb-4 text-green-400" />
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

          {/* Penalty policy explainer */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">Late penalty:</span> a flat
              late-payment fee per missed installment plus a penalty interest
              charged per month on the overdue balance (default KES 500 + 5% per
              month). The <span className="font-semibold">Penalty</span> column
              shows the running charge per loan — expand a loan to see the
              breakdown per installment.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none flex items-center">
                    <Search size={16} />
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition"
                >
                  <X size={15} /> Clear
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
                      <X size={12} />
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
                      <X size={12} />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Mobile card list (desktop uses the table below) */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-3 mb-4">
              {paginated.map((g) => {
                const open = expanded.has(g.loan_id);
                return (
                  <div
                    key={g.loan_id}
                    className={`bg-white rounded-xl shadow-md p-4 ${
                      bulk.isSelected(g.id) ? "ring-2 ring-red-400" : ""
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={bulk.isSelected(g.id)}
                          onChange={() => bulk.toggle(g.id)}
                          className="w-5 h-5 mt-1 cursor-pointer flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-800 truncate">
                            {g.first_name} {g.last_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {g.phone_number}
                          </p>
                          <button
                            onClick={() => navigate(`/loans/${g.loan_id}`)}
                            className="font-mono text-xs font-semibold text-ocean-600 hover:underline"
                          >
                            {g.loan_code}
                          </button>
                          <span
                            className={`ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                              LOAN_STATUS_BADGE[g.loan_status] ||
                              "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {String(g.loan_status || "").replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 inline-block px-3 py-1 rounded-full text-xs font-bold ${daysBadgeClass(
                          g.days_late,
                        )}`}
                      >
                        {g.days_late}d late
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
                      <div>
                        <p className="text-xs text-gray-500">Overdue</p>
                        <p className="font-semibold">
                          {g.overdue_count} payment
                          {g.overdue_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Oldest Due</p>
                        <p className="font-semibold">
                          {new Date(g.oldest_due_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Amount Due</p>
                        <p className="font-semibold">{KES(g.amount_due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Balance</p>
                        <p className="font-bold text-red-600">
                          {KES(g.balance_due)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Penalty</p>
                        <p className="font-semibold text-amber-700">
                          {KES(g.penalty_outstanding)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpand(g.loan_id)}
                      className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-ocean-600"
                    >
                      {open ? (
                        <>
                          <ChevronDown size={14} /> Hide payments
                        </>
                      ) : (
                        <>
                          <ChevronRight size={14} /> Show {g.overdue_count} overdue
                          payment{g.overdue_count !== 1 ? "s" : ""}
                        </>
                      )}
                    </button>
                    {open && (
                      <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                        {g.installments.map((s) => {
                          const d = parseInt(s.days_late, 10) || 0;
                          return (
                            <div
                              key={s.schedule_id || s.id}
                              className="text-xs"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600">
                                  #{s.payment_number} ·{" "}
                                  {new Date(s.due_date).toLocaleDateString()}
                                </span>
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded-full font-bold ${daysBadgeClass(
                                      d,
                                    )}`}
                                  >
                                    {d}d
                                  </span>
                                  <span className="font-semibold text-red-600">
                                    {KES(s.balance_due)}
                                  </span>
                                </span>
                              </div>
                              <div className="flex justify-end text-[11px] text-amber-700">
                                + {KES(s.penalty_outstanding ?? s.penalty_total)} penalty
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <Search size={56} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-xl font-semibold text-gray-600 mb-2">
                No payments match your filters
              </h3>
              <p className="text-gray-500 mb-4">
                Try a different severity range or clear your search
              </p>
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
              >
                <X size={15} /> Clear Filters
              </button>
            </div>
          ) : (
            <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden">
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
                      {[
                        ["Client", "first_name", "left"],
                        ["Loan Code", "loan_code", "left"],
                        ["Overdue", "overdue_count", "left"],
                        ["Oldest Due", "oldest_due_date", "left"],
                        ["Days Late", "days_late", "center"],
                        ["Amount Due", "amount_due", "right"],
                        ["Balance", "balance_due", "right"],
                        ["Penalty", "penalty_outstanding", "right"],
                        ["Status", "loan_status", "center"],
                      ].map(([label, key, align], i) => (
                        <SortableHeader
                          key={`${key}-${i}`}
                          label={label}
                          sortKey={key}
                          requestSort={requestSort}
                          getSortIndicator={getSortIndicator}
                          align={align}
                          className={`px-4 py-4 text-${align} text-xs font-semibold text-gray-600 uppercase`}
                        />
                      ))}
                      <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((g) => {
                      const open = expanded.has(g.loan_id);
                      return (
                        <React.Fragment key={g.loan_id}>
                          <tr
                            className={`border-b border-gray-100 hover:bg-red-50 transition ${
                              bulk.isSelected(g.id) ? "bg-red-50" : ""
                            }`}
                          >
                            <td className="px-4 py-4">
                              <input
                                type="checkbox"
                                checked={bulk.isSelected(g.id)}
                                onChange={() => bulk.toggle(g.id)}
                                className="w-4 h-4 cursor-pointer"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleExpand(g.loan_id)}
                                  className="text-gray-400 hover:text-gray-700 shrink-0"
                                  aria-label={open ? "Collapse" : "Expand"}
                                >
                                  {open ? (
                                    <ChevronDown size={16} />
                                  ) : (
                                    <ChevronRight size={16} />
                                  )}
                                </button>
                                <div>
                                  <p className="font-semibold text-gray-800 text-sm">
                                    {g.first_name} {g.last_name}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {g.phone_number}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <button
                                onClick={() => navigate(`/loans/${g.loan_id}`)}
                                className="font-mono text-sm font-semibold text-ocean-600 hover:text-ocean-800 hover:underline"
                              >
                                {g.loan_code}
                              </button>
                            </td>
                            <td className="px-4 py-4 text-sm">
                              <button
                                onClick={() => toggleExpand(g.loan_id)}
                                className="font-semibold text-gray-800 hover:text-ocean-600"
                              >
                                {g.overdue_count} payment
                                {g.overdue_count !== 1 ? "s" : ""}
                              </button>
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-700">
                              {new Date(g.oldest_due_date).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span
                                className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${daysBadgeClass(
                                  g.days_late,
                                )}`}
                              >
                                {g.days_late} {g.days_late === 1 ? "day" : "days"}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm font-semibold text-gray-700">
                              {KES(g.amount_due)}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <p className="font-bold text-red-600 text-sm">
                                {KES(g.balance_due)}
                              </p>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <p
                                className="font-semibold text-amber-700 text-sm"
                                title="Late fee per missed payment + penalty interest on the overdue balance"
                              >
                                {KES(g.penalty_outstanding)}
                              </p>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span
                                className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
                                  LOAN_STATUS_BADGE[g.loan_status] ||
                                  "bg-gray-100 text-gray-700"
                                }`}
                              >
                                {String(g.loan_status || "").replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button
                                onClick={() => navigate(`/loans/${g.loan_id}`)}
                                className="px-3 py-1.5 bg-ocean-gradient text-white text-xs font-semibold rounded-lg hover:shadow-lg transition"
                              >
                                View Loan
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/70">
                              <td colSpan="11" className="px-6 pb-4 pt-1">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                                      <th className="text-left py-1 font-semibold">
                                        Payment
                                      </th>
                                      <th className="text-left py-1 font-semibold">
                                        Due Date
                                      </th>
                                      <th className="text-center py-1 font-semibold">
                                        Days Late
                                      </th>
                                      <th className="text-right py-1 font-semibold">
                                        Amount Due
                                      </th>
                                      <th className="text-right py-1 font-semibold">
                                        Balance
                                      </th>
                                      <th className="text-right py-1 font-semibold">
                                        Late Fee
                                      </th>
                                      <th className="text-right py-1 font-semibold">
                                        Penalty Interest
                                      </th>
                                      <th className="text-right py-1 font-semibold">
                                        Penalty Total
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.installments.map((s) => {
                                      const d = parseInt(s.days_late, 10) || 0;
                                      const total =
                                        s.total_payments_in_loan ||
                                        s.total_payments ||
                                        "?";
                                      const months = s.months_late || 1;
                                      const rate = Number(s.penalty_rate || 0);
                                      return (
                                        <tr
                                          key={s.schedule_id || s.id}
                                          className="border-t border-gray-200/70"
                                        >
                                          <td className="py-1.5 text-gray-700">
                                            Payment {s.payment_number} of {total}
                                          </td>
                                          <td className="py-1.5 text-gray-700">
                                            {new Date(
                                              s.due_date,
                                            ).toLocaleDateString()}
                                          </td>
                                          <td className="py-1.5 text-center">
                                            <span
                                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${daysBadgeClass(
                                                d,
                                              )}`}
                                            >
                                              {d}d
                                            </span>
                                          </td>
                                          <td className="py-1.5 text-right text-gray-700">
                                            {KES(s.amount_due)}
                                          </td>
                                          <td className="py-1.5 text-right font-semibold text-red-600">
                                            {KES(s.balance_due)}
                                          </td>
                                          <td className="py-1.5 text-right text-gray-700">
                                            {KES(s.late_fee)}
                                          </td>
                                          <td
                                            className="py-1.5 text-right text-gray-700"
                                            title={`${rate}% per month × ${months} month${months !== 1 ? "s" : ""} on the overdue balance`}
                                          >
                                            {KES(s.penalty_interest)}
                                          </td>
                                          <td className="py-1.5 text-right font-semibold text-amber-700">
                                            {KES(s.penalty_total)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
                        <span className="inline-flex items-center gap-1.5"><BarChart3 size={15} /> TOTALS — {filtered.length} overdue • {filteredLoans} loans</span>
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-gray-800 text-sm">
                        {KES(filteredAmountDue)}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-red-700 text-sm">
                        {KES(filteredBalance)}
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-amber-700 text-sm">
                        {KES(filteredPenalty)}
                      </td>
                      <td className="px-4 py-4" colSpan="2"></td>
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
        totalCount={filteredLoans}
        onClear={bulk.clear}
      >
        <button
          onClick={handleBulkExport}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          <Download size={15} /> Export
        </button>

        <BulkMessaging
          clientIds={selectedClientIds}
          onComplete={bulk.clear}
        />

        <button
          onClick={handleBulkDefault}
          disabled={defaulting}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-semibold disabled:opacity-50"
          title="Mark the selected loans as defaulted"
        >
          <AlertTriangle size={15} />
          {defaulting ? "Marking…" : "Mark Defaulted"}
        </button>
      </BulkActionBar>
    </div>
  );
}

export default Overdue;
