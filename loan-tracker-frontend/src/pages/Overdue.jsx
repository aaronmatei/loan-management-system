import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RotateCcw, PartyPopper, Search, X, Download, BarChart3, ChevronRight, ChevronDown, Handshake, Clock } from "lucide-react";
import api from "../services/api";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import { bulkExport } from "../utils/bulkExport";
import { useSortableTable } from "../hooks/useSortableTable";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import DataTable from "../components/DataTable";
import SegmentBar from "../components/SegmentBar";
import { useColumnPreset, useFilterSegments } from "../hooks/useTablePrefs";
import { formatKES } from "../utils/money";

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
  completed: "bg-ocean-100 text-ocean-700",
};

const fmtDate = (v) =>
  new Date(v).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

// ── Overdue table column model (shared DataTable) ─────────────────────
// One row per loan (grouped overdue installments). The borrower identity
// (name + phone) is the pinned column and is rendered separately, so it
// is NOT part of this list. `money` columns also feed the totals row.
// The trailing `_installments` column is never part of any preset, so it
// always drops into the expandable detail row — that is where the
// per-installment penalty breakdown lives.
const num = (v) => parseFloat(v || 0);

const OVERDUE_COLUMNS = [
  {
    key: "loan_code",
    label: "Loan Code",
    align: "left",
    cell: (g) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          g.__navigate(`/loans/${g.loan_id}`);
        }}
        className="font-mono text-sm font-semibold text-ocean-600 hover:text-ocean-800 hover:underline"
      >
        {g.loan_code}
      </button>
    ),
  },
  {
    key: "overdue_count",
    label: "Overdue",
    align: "left",
    cell: (g) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          g.__toggleExpand(g.loan_id);
        }}
        className="font-semibold text-gray-800 dark:text-slate-100 hover:text-ocean-600 text-sm"
      >
        {g.overdue_count} payment
        {g.overdue_count !== 1 ? "s" : ""}
      </button>
    ),
  },
  {
    key: "oldest_due_date",
    label: "Oldest Due",
    align: "left",
    cell: (g) => (
      <span className="text-sm text-gray-700 dark:text-slate-200">
        {fmtDate(g.oldest_due_date)}
      </span>
    ),
  },
  {
    key: "days_late",
    label: "Days Late",
    align: "center",
    cell: (g) => (
      <span
        className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${daysBadgeClass(
          g.days_late,
        )}`}
      >
        {g.days_late} {g.days_late === 1 ? "day" : "days"}
      </span>
    ),
  },
  {
    key: "amount_due",
    label: "Amount Due",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, g) => s + num(g.amount_due), 0),
    totalClass: "text-gray-800 dark:text-slate-100",
    cell: (g) => (
      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
        {formatKES(g.amount_due)}
      </span>
    ),
  },
  {
    key: "balance_due",
    label: "Balance",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, g) => s + num(g.balance_due), 0),
    totalClass: "text-red-700",
    cell: (g) => (
      <p className="font-bold text-red-600 text-sm">
        {formatKES(g.balance_due)}
      </p>
    ),
  },
  {
    key: "penalty_outstanding",
    label: "Penalty",
    align: "right",
    money: true,
    total: (rows) =>
      rows.reduce(
        (s, g) =>
          s + parseFloat(g.penalty_outstanding ?? g.penalty_total ?? 0),
        0,
      ),
    totalClass: "text-amber-700",
    cell: (g) => (
      <p
        className="font-semibold text-amber-700 text-sm"
        title="Late fee per missed payment + penalty interest on the overdue balance"
      >
        {formatKES(g.penalty_outstanding)}
      </p>
    ),
  },
  {
    key: "loan_status",
    label: "Status",
    align: "center",
    cell: (g) => (
      <span
        className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
          LOAN_STATUS_BADGE[g.loan_status] || "bg-gray-100 text-gray-700"
        }`}
      >
        {String(g.loan_status || "").replace("_", " ")}
      </span>
    ),
  },
  {
    // Synthetic column — excluded from every preset so it always renders
    // inside the expandable detail row. Holds the per-installment penalty
    // breakdown that previously lived in the inline expanded table.
    key: "_installments",
    label: "Overdue installments",
    align: "left",
    sortable: false,
    fullSpan: true,
    cell: (g) => (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-400">
              <th className="text-left py-1 font-semibold">Payment</th>
              <th className="text-left py-1 font-semibold">Due Date</th>
              <th className="text-center py-1 font-semibold">Days Late</th>
              <th className="text-right py-1 font-semibold">Amount Due</th>
              <th className="text-right py-1 font-semibold">Balance</th>
              <th className="text-right py-1 font-semibold">Late Fee</th>
              <th className="text-right py-1 font-semibold">
                Penalty Interest
              </th>
              <th className="text-right py-1 font-semibold">Penalty Total</th>
            </tr>
          </thead>
          <tbody>
            {g.installments.map((s) => {
              const d = parseInt(s.days_late, 10) || 0;
              const total =
                s.total_payments_in_loan || s.total_payments || "?";
              const months = s.months_late || 1;
              const rate = Number(s.penalty_rate || 0);
              return (
                <tr
                  key={s.schedule_id || s.id}
                  className="border-t border-gray-200/70 dark:border-slate-700"
                >
                  <td className="py-1.5 text-gray-700 dark:text-slate-200">
                    Payment {s.payment_number} of {total}
                  </td>
                  <td className="py-1.5 text-gray-700 dark:text-slate-200">
                    {fmtDate(s.due_date)}
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
                  <td className="py-1.5 text-right text-gray-700 dark:text-slate-200">
                    {formatKES(s.amount_due)}
                  </td>
                  <td className="py-1.5 text-right font-semibold text-red-600">
                    {formatKES(s.balance_due)}
                  </td>
                  <td className="py-1.5 text-right text-gray-700 dark:text-slate-200">
                    {formatKES(s.late_fee)}
                  </td>
                  <td
                    className="py-1.5 text-right text-gray-700 dark:text-slate-200"
                    title={`${rate}% per month × ${months} month${months !== 1 ? "s" : ""} on the overdue balance`}
                  >
                    {formatKES(s.penalty_interest)}
                  </td>
                  <td className="py-1.5 text-right font-semibold text-amber-700">
                    {formatKES(s.penalty_total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ),
  },
];

// Column presets — which keys render in the row. The pinned Client column
// is always shown outside this set. The `_installments` column is never
// listed, so it always lives in the expandable detail row.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["loan_code", "days_late", "balance_due", "loan_status"],
  },
  collections: {
    label: "Collections",
    keys: [
      "loan_code",
      "overdue_count",
      "oldest_due_date",
      "days_late",
      "balance_due",
      "penalty_outstanding",
      "loan_status",
    ],
  },
  full: {
    label: "Everything",
    keys: [
      "loan_code",
      "overdue_count",
      "oldest_due_date",
      "days_late",
      "amount_due",
      "balance_due",
      "penalty_outstanding",
      "loan_status",
    ],
  },
};

const PRESET_STORAGE_KEY = "overdue.columnPreset";
const SEGMENTS_STORAGE_KEY = "overdue.segments";

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

const KES = (n) => formatKES(n);

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
  // Period filter — installments whose due_date falls in [from, to].
  // Empty string = no constraint on that side. Drives the "Loans Not
  // Paid (period)" view requested in the original list — chase
  // installments due in a specific week / month / window.
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Which loans are expanded to reveal their overdue installments.
  const [expanded, setExpanded] = useState(() => new Set());

  // Column preset + saved filter segments — shared hooks, localStorage only.
  const [columnPreset, setColumnPreset] = useColumnPreset(
    PRESET_STORAGE_KEY,
    COLUMN_PRESETS,
    "collections",
  );
  const { segments, saveSegment, deleteSegment } =
    useFilterSegments(SEGMENTS_STORAGE_KEY);

  // Log Promise to Pay — inline action so the collections officer can
  // capture a borrower's verbal commitment without leaving the chase
  // list. Loan id + a pre-filled suggested amount come from the row
  // (overdue total seems like a sane default — admin can change it).
  const [promiseTarget, setPromiseTarget] = useState(null); // { loanId, loanCode, name, suggestedAmount }
  const [promiseForm, setPromiseForm] = useState({
    amount: "",
    promised_date: "",
    notes: "",
  });
  const [savingPromise, setSavingPromise] = useState(false);
  const [promiseError, setPromiseError] = useState("");

  const openPromise = (g) => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    // Default amount = what the borrower needs to hand over to clear
    // the overdue rows: principal+interest balance on the missed
    // installments + the penalty that's accrued on them. Fields are
    // the per-loan aggregates the row already renders (g.balance_due
    // and g.penalty_outstanding); my earlier draft read
    // g.overdue_balance which doesn't exist, hence the 0.00 default
    // the user flagged.
    const balance = parseFloat(g.balance_due || 0);
    const penalty = parseFloat(g.penalty_outstanding || 0);
    const suggested = balance + penalty;
    setPromiseTarget({
      loanId: g.loan_id,
      loanCode: g.loan_code,
      name: `${g.first_name} ${g.last_name}`,
    });
    setPromiseForm({
      amount: suggested > 0 ? suggested.toFixed(2) : "",
      promised_date: d.toISOString().slice(0, 10),
      notes: "",
    });
    setPromiseError("");
  };

  const submitPromise = async (e) => {
    e.preventDefault();
    if (!promiseTarget) return;
    const amt = parseFloat(promiseForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setPromiseError("Enter a positive amount.");
      return;
    }
    if (!promiseForm.promised_date) {
      setPromiseError("Pick a promise date.");
      return;
    }
    setSavingPromise(true);
    setPromiseError("");
    try {
      await api.post(`/loans/${promiseTarget.loanId}/promises`, {
        amount: amt,
        promised_date: promiseForm.promised_date,
        notes: promiseForm.notes.trim() || null,
      });
      setPromiseTarget(null);
    } catch (err) {
      setPromiseError(err.response?.data?.error || "Failed to log promise");
    } finally {
      setSavingPromise(false);
    }
  };
  const toggleExpand = (loanId) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(loanId) ? next.delete(loanId) : next.add(loanId);
      return next;
    });

  useEffect(() => {
    fetchOverdueData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFrom, periodTo]);

  // Reset to first page whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, severityFilter, periodFrom, periodTo]);

  const fetchOverdueData = async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (periodFrom) params.append("from", periodFrom);
      if (periodTo) params.append("to", periodTo);
      const qs = params.toString();
      const response = await api.get(`/overdue${qs ? `?${qs}` : ""}`);
      setOverdueList(response.data.data || []);
      setSummary(response.data.summary || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load overdue payments");
    } finally {
      setLoading(false);
    }
  };

  // Period quick-picks. Local-time dates so "this week" matches what
  // the user sees on their calendar, not what UTC says. Week starts
  // Monday — the conventional working-week start.
  const periodPresets = (() => {
    const toIso = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const today = new Date();
    const startOfWeek = (d) => {
      const x = new Date(d);
      // JS Sunday=0, Monday=1 ... shift so Monday=0
      const dow = (x.getDay() + 6) % 7;
      x.setDate(x.getDate() - dow);
      return x;
    };
    const endOfWeek = (d) => {
      const s = startOfWeek(d);
      s.setDate(s.getDate() + 6);
      return s;
    };
    const startOfMonth = (d) =>
      new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = (d) =>
      new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevWeekRef = new Date(today);
    prevWeekRef.setDate(prevWeekRef.getDate() - 7);
    return [
      {
        key: "this-week",
        label: "This Week",
        from: toIso(startOfWeek(today)),
        to: toIso(endOfWeek(today)),
      },
      {
        key: "last-week",
        label: "Last Week",
        from: toIso(startOfWeek(prevWeekRef)),
        to: toIso(endOfWeek(prevWeekRef)),
      },
      {
        key: "this-month",
        label: "This Month",
        from: toIso(startOfMonth(today)),
        to: toIso(endOfMonth(today)),
      },
      {
        key: "last-month",
        label: "Last Month",
        from: toIso(startOfMonth(prevMonth)),
        to: toIso(endOfMonth(prevMonth)),
      },
    ];
  })();

  const matchedPreset = periodPresets.find(
    (p) => p.from === periodFrom && p.to === periodTo,
  );

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

  // Rows handed to the shared DataTable. Cells are module-level so they
  // can't close over component scope — inject navigate + expand toggle
  // onto each row so the Loan Code / Overdue cells stay clickable.
  const tableRows = paginated.map((g) => ({
    ...g,
    __navigate: navigate,
    __toggleExpand: toggleExpand,
  }));

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
    setPeriodFrom("");
    setPeriodTo("");
  };

  // ── Saved filter segments (localStorage only, via shared hook) ─
  const handleSaveSegment = () => {
    const name = window.prompt("Name this segment (e.g. 90+ days)");
    if (!name) return;
    saveSegment(name, {
      searchQuery,
      severityFilter,
      periodFrom,
      periodTo,
    });
  };
  const applySegment = (segment) => {
    const snap = segment.snapshot || {};
    setSearchQuery(snap.searchQuery || "");
    setSeverityFilter(snap.severityFilter || "all");
    setPeriodFrom(snap.periodFrom || "");
    setPeriodTo(snap.periodTo || "");
    setCurrentPage(1);
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
      <PageHeader
        icon={AlertTriangle}
        title="Overdue Payments"
        subtitle={`${totalOverdueCount} overdue payments • ${KES(totalOverdueAmount)} outstanding`}
        actions={
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing ? "Refreshing..." : <span className="inline-flex items-center gap-1.5"><RotateCcw size={16} /> Refresh</span>}
          </button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <>
          {/* Summary card skeletons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 space-y-3"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          {/* Table skeleton */}
          <div className="hidden md:block bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 dark:border-slate-700"
              >
                <Skeleton className="h-4 w-4" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </>
      ) : overdueList.length === 0 && !periodFrom && !periodTo ? (
        // Celebration only when there's truly no overdue debt — not
        // when a period filter narrowed the result to zero. The
        // period-zero case keeps the full layout so the user can
        // try another window without having to navigate back.
        <EmptyState
          icon={PartyPopper}
          title="No overdue payments! Great job!"
          description="Every scheduled installment is on track."
        />
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
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 pointer-events-none flex items-center">
                    <Search size={16} />
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by client name, phone, or loan code..."
                    className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-red-500 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="px-4 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-red-500 focus:outline-none bg-white dark:bg-slate-900 font-semibold text-gray-700 dark:text-slate-100"
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition"
                >
                  <X size={15} /> Clear
                </button>
              )}
            </div>

            {/* Period filter — "Loans Not Paid in this window."
                Filters by ps.due_date BETWEEN ?from AND ?to on the
                backend so the page can answer "who was meant to pay
                last week and didn't" without the user re-running the
                manager's mental query against /loans. Quick-picks
                cover the 90% case (this week / last week / this
                month / last month); custom From/To stays for one-
                off windows. */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">
                  Due From
                </label>
                <input
                  type="date"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                  className="px-3 py-1.5 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-red-500 focus:outline-none text-sm dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">
                  Due To
                </label>
                <input
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                  min={periodFrom || undefined}
                  className="px-3 py-1.5 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-red-500 focus:outline-none text-sm dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {periodPresets.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setPeriodFrom(p.from);
                      setPeriodTo(p.to);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                      matchedPreset?.key === p.key
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {(periodFrom || periodTo) && (
                  <button
                    onClick={() => {
                      setPeriodFrom("");
                      setPeriodTo("");
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 inline-flex items-center gap-1 transition"
                    title="Show all overdue, ignore the date window"
                  >
                    <X size={12} /> Clear period
                  </button>
                )}
              </div>
            </div>

            {/* Active filter tags */}
            {filtersActive && (
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                <span className="text-sm text-gray-500 dark:text-slate-400">
                  Showing{" "}
                  <span className="font-semibold text-gray-800 dark:text-slate-100">
                    {filtered.length}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-gray-800 dark:text-slate-100">
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

          {/* Saved segments — named search + filter snapshots (shared
              SegmentBar; localStorage only, never server-side). */}
          <SegmentBar
            className="mb-6"
            segments={segments}
            onApply={applySegment}
            onDelete={deleteSegment}
            onSave={handleSaveSegment}
            canSave={filtersActive}
          />

          {/* Mobile card list (desktop uses the table below) */}
          {filtered.length > 0 && (
            <div className="md:hidden space-y-3 mb-4">
              {paginated.map((g) => {
                const open = expanded.has(g.loan_id);
                return (
                  <div
                    key={g.loan_id}
                    className={`bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 ${
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
                          <p className="font-semibold text-gray-800 dark:text-slate-100 truncate">
                            {g.first_name} {g.last_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">
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
                              "bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200"
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
                    <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 dark:border-slate-700 pt-3">
                      <div>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Overdue</p>
                        <p className="font-semibold">
                          {g.overdue_count} payment
                          {g.overdue_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Oldest Due</p>
                        <p className="font-semibold">
                          {new Date(g.oldest_due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Amount Due</p>
                        <p className="font-semibold">{KES(g.amount_due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Balance</p>
                        <p className="font-bold text-red-600">
                          {KES(g.balance_due)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Penalty</p>
                        <p className="font-semibold text-amber-700">
                          {KES(g.penalty_outstanding)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => openPromise(g)}
                        className="flex-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition inline-flex items-center justify-center gap-1"
                      >
                        <Handshake size={12} /> Log Promise
                      </button>
                      <button
                        onClick={() => navigate(`/loans/${g.loan_id}`)}
                        className="flex-1 px-3 py-1.5 bg-ocean-gradient text-white text-xs font-semibold rounded-lg hover:shadow-lg transition"
                      >
                        Open Loan
                      </button>
                    </div>
                    <button
                      onClick={() => toggleExpand(g.loan_id)}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-ocean-600"
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
                      <div className="mt-2 space-y-1.5 border-t border-gray-100 dark:border-slate-700 pt-2">
                        {g.installments.map((s) => {
                          const d = parseInt(s.days_late, 10) || 0;
                          return (
                            <div
                              key={s.schedule_id || s.id}
                              className="text-xs"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-gray-600 dark:text-slate-400">
                                  #{s.payment_number} ·{" "}
                                  {new Date(s.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
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
            // Empty-state copy adapts to which filter set returned
            // zero rows. Period filter alone vs search/severity needs
            // different language so the user knows what to try next.
            (periodFrom || periodTo) && overdueList.length === 0 ? (
              <EmptyState
                icon={PartyPopper}
                title="No overdue installments in this period"
                description={`Nothing came due (and went unpaid) between ${periodFrom || "—"} and ${periodTo || "—"}. Try a different window, or clear the period filter to see everything.`}
                action={
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
                  >
                    <X size={15} /> Clear Filters
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                tone="muted"
                title="No payments match your filters"
                description="Try a different severity range or clear your search."
                action={
                  <button
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
                  >
                    <X size={15} /> Clear Filters
                  </button>
                }
              />
            )
          ) : (
            <div className="hidden md:block">
              <DataTable
                columns={OVERDUE_COLUMNS}
                rows={tableRows}
                rowKey={(g) => g.loan_id}
                pinned={{
                  label: "Client",
                  sortKey: "first_name",
                  cell: (g) => (
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-slate-100 text-sm">
                        {g.first_name} {g.last_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {g.phone_number}
                      </p>
                    </div>
                  ),
                }}
                presets={COLUMN_PRESETS}
                preset={columnPreset}
                onPresetChange={setColumnPreset}
                expandedRows={expanded}
                onToggleRow={toggleExpand}
                selection={{
                  isSelected: bulk.isSelected,
                  toggle: bulk.toggle,
                  allSelected: bulk.allOnPageSelected,
                  toggleAll: bulk.togglePage,
                }}
                sort={{ requestSort, getSortIndicator }}
                onOpen={(g) => navigate(`/loans/${g.loan_id}`)}
                openLabel={(g) => `Open loan ${g.loan_code}`}
                totals={filtered}
                totalsLabel={
                  <span className="inline-flex items-center gap-1.5">
                    <BarChart3 size={15} /> TOTALS — {filtered.length} overdue •{" "}
                    {filteredLoans} loans
                  </span>
                }
                loading={loading}
                skeletonRows={8}
                skeletonCols={8}
                empty={
                  <EmptyState
                    icon={Search}
                    tone="muted"
                    title="No payments match your filters"
                    description="Try a different severity range or clear your search."
                    action={
                      <button
                        onClick={clearFilters}
                        className="inline-flex items-center gap-1.5 px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
                      >
                        <X size={15} /> Clear Filters
                      </button>
                    }
                  />
                }
              />


              {/* Pagination (same component as Clients/Loans) */}
              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 mt-3 bg-white dark:bg-slate-800 rounded-xl shadow-card">
                  <div className="text-sm text-gray-600 dark:text-slate-400">
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
                      className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
                                <span className="px-2 text-gray-400 dark:text-slate-400">...</span>
                              )}
                              <button
                                onClick={() => setCurrentPage(page)}
                                className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                                  currentPage === page
                                    ? "bg-red-600 text-white"
                                    : "bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
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
                      className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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

      {/* Log Promise modal — inline so the chase officer doesn't have
          to navigate into the loan page just to capture a verbal
          commitment. Mirrors the one on LoanDetails so behaviour and
          validation are identical. */}
      {promiseTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                  <Handshake size={22} className="text-amber-600" />
                  Log Promise to Pay
                </h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {promiseTarget.loanCode} ·{" "}
                  <span className="font-semibold">{promiseTarget.name}</span>
                </p>
              </div>
              <button
                onClick={() => setPromiseTarget(null)}
                disabled={savingPromise}
                className="text-gray-400 dark:text-slate-400 hover:text-gray-600"
              >
                <X size={22} />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 mb-4 text-sm flex items-start gap-2">
              <Clock size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                Amount defaults to the row's overdue balance + accrued
                penalty — what the borrower needs to clear to be current.
                Adjust if they committed to a different figure.
              </span>
            </div>

            {promiseError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-3 text-sm">
                {promiseError}
              </div>
            )}

            <form onSubmit={submitPromise} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Amount (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={promiseForm.amount}
                    onChange={(e) =>
                      setPromiseForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Promised by *
                  </label>
                  <input
                    type="date"
                    required
                    value={promiseForm.promised_date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) =>
                      setPromiseForm((p) => ({
                        ...p,
                        promised_date: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows="2"
                  value={promiseForm.notes}
                  onChange={(e) =>
                    setPromiseForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  placeholder="e.g. will pay after salary on Friday"
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setPromiseTarget(null)}
                  disabled={savingPromise}
                  className="px-5 py-2 bg-gray-500 text-white font-semibold rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPromise}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Handshake size={16} />
                  {savingPromise ? "Saving…" : "Log Promise"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Overdue;
