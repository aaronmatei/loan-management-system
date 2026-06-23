import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, BarChart3, Smartphone, Coins, X, Check, Search, ChevronRight, ChevronDown, Calendar, Pencil } from "lucide-react";
import api from "../services/api";
import { useSortableTable } from "../hooks/useSortableTable";
import PaymentReceipt from "../components/PaymentReceipt";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import DataTable from "../components/DataTable";
import SegmentBar from "../components/SegmentBar";
import { useColumnPreset, useFilterSegments } from "../hooks/useTablePrefs";
import { formatKES } from "../utils/money";

// ── Payments table column model (shared DataTable) ────────────────────
// One row per loan (grouped), with the loan's transactions nested in the
// expandable detail row. The Client (name + phone) is pinned/sticky and
// rendered specially, so it is NOT part of this generic list. `money`
// columns also feed the totals footer. Secondary columns demote into the
// expandable panel via the presets below — nothing is ever hidden.
const PAYMENT_COLUMNS = [
  {
    key: "loan_code",
    label: "Loan",
    align: "left",
    cell: (g) => (
      <p className="font-mono text-sm">
        <Link
          to={`/loans/${g.loan_id}`}
          className="text-ocean-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {g.loan_code}
        </Link>
      </p>
    ),
  },
  {
    key: "count",
    label: "Payments",
    align: "left",
    footer: (rows) => {
      const n = rows.reduce((s, g) => s + g.count, 0);
      return (
        <p className="font-semibold text-gray-700 dark:text-slate-200 text-sm">
          {n} payment{n !== 1 ? "s" : ""}
        </p>
      );
    },
    cell: (g) => (
      <p className="font-semibold text-gray-800 dark:text-slate-100">
        {g.count} payment{g.count !== 1 ? "s" : ""}
      </p>
    ),
  },
  {
    key: "total_paid",
    label: "Total Paid",
    align: "left",
    money: true,
    total: (rows) => rows.reduce((s, g) => s + g.total_paid, 0),
    totalClass: "text-green-700",
    cell: (g) => (
      <p className="font-bold text-green-600">{formatKES(g.total_paid)}</p>
    ),
  },
  {
    key: "total_collected",
    label: "Total Collected",
    align: "left",
    money: true,
    total: (rows) => rows.reduce((s, g) => s + g.total_collected, 0),
    totalClass: "text-emerald-800",
    cell: (g) => (
      <p className="font-bold text-emerald-700">
        {formatKES(g.total_collected)}
      </p>
    ),
  },
  {
    key: "overpayment",
    label: "Overpayment",
    align: "left",
    money: true,
    total: (rows) => rows.reduce((s, g) => s + g.overpayment, 0),
    totalClass: "text-amber-700",
    footer: (rows) => {
      const op = rows.reduce((s, g) => s + g.overpayment, 0);
      return (
        <p className="font-semibold text-amber-700 text-sm">
          {op > 0 ? formatKES(op) : "—"}
        </p>
      );
    },
    cell: (g) =>
      g.overpayment > 0 ? (
        <span className="font-semibold text-amber-700 text-sm">
          {formatKES(g.overpayment)}
        </span>
      ) : (
        <span className="text-gray-400 dark:text-slate-400 text-sm">—</span>
      ),
  },
  {
    key: "last_date",
    label: "Last Payment",
    align: "left",
    cell: (g) => (
      <span className="text-gray-600 dark:text-slate-400 text-sm">
        {new Date(g.last_date).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })}
      </span>
    ),
  },
];

// Column presets — which keys render inline. Client is always pinned and
// shown outside this set. Anything not visible drops into the expandable
// detail row (which also always carries the transaction sub-table), so no
// data is ever hidden — just demoted. The synthetic "transactions" column
// (built inside the component, where the row handlers live) is never listed
// in any preset, so it is ALWAYS demoted into the expand panel — that's what
// keeps the per-transaction sub-table available on every preset.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["loan_code", "count", "total_paid"],
  },
  financials: {
    label: "Financials",
    keys: ["loan_code", "count", "total_paid", "total_collected", "last_date"],
  },
  full: {
    label: "Everything",
    keys: PAYMENT_COLUMNS.map((c) => c.key),
  },
};

const PRESET_STORAGE_KEY = "payments.columnPreset";
const SEGMENTS_STORAGE_KEY = "payments.segments";

function Payments() {
  const [payments, setPayments] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Date-range filter — filters BY transaction.payment_date so a
  // group only shows up if at least one of its transactions falls
  // in the window. Empty inputs = unbounded on that side. Resetting
  // page to 1 on every change keeps pagination consistent.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFrom, dateTo]);

  // Which loans are expanded to reveal their transactions (drives both the
  // mobile card list and the desktop DataTable detail rows).
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (loanId) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(loanId) ? next.delete(loanId) : next.add(loanId);
      return next;
    });

  // ── Table UX (client-side only) ───────────────────────────────────
  // Column preset + saved filter segments — shared hooks, localStorage only.
  const [columnPreset, setColumnPreset] = useColumnPreset(
    PRESET_STORAGE_KEY,
    COLUMN_PRESETS,
    "financials",
  );
  const { segments, saveSegment, deleteSegment } =
    useFilterSegments(SEGMENTS_STORAGE_KEY);

  // Loan search
  const [loanSearch, setLoanSearch] = useState("");
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loanSummary, setLoanSummary] = useState(null);
  const dropdownRef = useRef(null);

  const [formData, setFormData] = useState({
    loan_id: "",
    amount_paid: "",
    payment_date: new Date().toISOString().split("T")[0],
    payment_method: "M-Pesa",
    payment_reference: "",
    notes: "",
  });

  // Receipt modal state — populated from POST /payments response.
  const [receiptModal, setReceiptModal] = useState(null);
  const [txnModal, setTxnModal] = useState(null);
  const [tenantBranding, setTenantBranding] = useState(null);

  // Edit-payment modal (null = closed). Prepopulated from a transaction.
  const [editForm, setEditForm] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");

  // ?loan=<id> deep-link — when LoanDetails' "Record Payment" action
  // (or any other surface) navigates here it pre-selects the loan,
  // pre-fills the summary and opens the form, so the user lands one
  // amount away from recording. We strip the param after consuming
  // it so a manual refresh doesn't re-trigger the auto-select.
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchPayments();
    fetchLoans();
    // Best-effort tenant branding for the receipt header. White-label
    // settings live behind admin auth, so we degrade gracefully on 403.
    api
      .get("/white-label/settings")
      .then((r) => setTenantBranding(r.data.data || null))
      .catch(() => {});
  }, []);

  // Watches for ?loan=<id> AND for `loans` to finish loading. Runs
  // once they intersect — selecting + opening the form, then drops
  // the query param so the URL stays clean.
  useEffect(() => {
    const wantedId = searchParams.get("loan");
    if (!wantedId || loans.length === 0) return;
    const match = loans.find((l) => String(l.id) === String(wantedId));
    if (match) {
      handleSelectLoan(match);
      setShowForm(true);
    }
    // Drop the param regardless — if we couldn't find the loan
    // (filtered out by status), refreshing wouldn't help.
    const next = new URLSearchParams(searchParams);
    next.delete("loan");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, searchParams]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const response = await api.get("/payments");
      setPayments(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  const fetchLoans = async () => {
    try {
      const response = await api.get("/loans?status=active");
      // Filter only active loans
      const activeLoans = (response.data.data || []).filter(
        (l) => l.status === "active",
      );
      setLoans(activeLoans);
    } catch (err) {
      console.error("Failed to fetch loans:", err);
    }
  };

  const fetchLoanSummary = async (loanId) => {
    try {
      const response = await api.get(`/payments/loan/${loanId}/summary`);
      setLoanSummary(response.data.data);
    } catch (err) {
      console.error("Failed to fetch loan summary:", err);
    }
  };

  const filteredLoans = loans.filter((loan) => {
    if (!loanSearch) return true;
    const search = loanSearch.toLowerCase();
    return (
      loan.loan_code?.toLowerCase().includes(search) ||
      loan.first_name?.toLowerCase().includes(search) ||
      loan.last_name?.toLowerCase().includes(search) ||
      loan.phone_number?.includes(search) ||
      loan.client_code?.toLowerCase().includes(search)
    );
  });

  const handleSelectLoan = (loan) => {
    setSelectedLoan(loan);
    setFormData({ ...formData, loan_id: loan.id });
    setLoanSearch(`${loan.loan_code} - ${loan.first_name} ${loan.last_name}`);
    setShowDropdown(false);
    fetchLoanSummary(loan.id);
  };

  const handleClearLoan = () => {
    setSelectedLoan(null);
    setFormData({ ...formData, loan_id: "" });
    setLoanSearch("");
    setLoanSummary(null);
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.loan_id) {
      setError("Please select a loan");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await api.post("/payments", formData);
      const txn = response.data.data;
      setSuccess(
        `Payment ${txn.transaction_code} recorded successfully!`,
      );

      // Show the receipt modal if the backend returned a receipt block
      // (added with migration 012 / payments.js update). Enrich with the
      // penalty cleared by THIS payment so the receipt summary breaks it down.
      if (txn.receipt) {
        setReceiptModal({
          payment: txn,
          receipt: {
            ...txn.receipt,
            penalty_paid: parseFloat(txn.penalty_portion || 0),
          },
        });
      }

      setFormData({
        loan_id: "",
        amount_paid: "",
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "M-Pesa",
        payment_reference: "",
        notes: "",
      });
      setSelectedLoan(null);
      setLoanSearch("");
      setLoanSummary(null);

      setShowForm(false);
      fetchPayments();
      fetchLoans();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit a recorded payment ──────────────────────────────────────
  // Prepopulate from the transaction. Date from payment_date; time from
  // created_at (the receipt's clock).
  const openEditPayment = (p) => {
    const created = p.created_at ? new Date(p.created_at) : null;
    const hh = created ? String(created.getHours()).padStart(2, "0") : "08";
    const mm = created ? String(created.getMinutes()).padStart(2, "0") : "00";
    setEditError("");
    setEditForm({
      id: p.id,
      transaction_code: p.transaction_code,
      amount_paid: String(parseFloat(p.amount_paid)),
      payment_date: (p.payment_date || "").slice(0, 10),
      payment_time: `${hh}:${mm}`,
      payment_method: p.payment_method || "M-Pesa",
      payment_reference: p.payment_reference || "",
      notes: p.notes || "",
    });
  };

  const submitEditPayment = async (e) => {
    e.preventDefault();
    setEditError("");
    setEditSubmitting(true);
    try {
      await api.put(`/payments/${editForm.id}`, {
        amount_paid: editForm.amount_paid,
        payment_date: editForm.payment_date,
        payment_time: editForm.payment_time,
        payment_method: editForm.payment_method,
        payment_reference: editForm.payment_reference,
        notes: editForm.notes,
      });
      const code = editForm.transaction_code;
      setEditForm(null);
      setSuccess(`Payment ${code} updated successfully`);
      fetchPayments();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setEditError(err.response?.data?.error || "Failed to update payment");
    } finally {
      setEditSubmitting(false);
    }
  };

  // Apply date-range filter before grouping. Comparing payment_date
  // as 'YYYY-MM-DD' against the input string keeps timezone math
  // out — no Date() coercion needed.
  const filteredPayments = payments.filter((p) => {
    const d = (p.payment_date || "").slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  // Sort then paginate
  // Group transactions into ONE entry per loan, with the transactions nested
  // for the expand view. Group fields (count, total_paid, last_date) drive
  // sorting + the collapsed row; the transactions themselves show on expand.
  const loanGroups = (() => {
    const map = new Map();
    for (const p of filteredPayments) {
      let g = map.get(p.loan_id);
      if (!g) {
        g = {
          loan_id: p.loan_id,
          loan_code: p.loan_code,
          first_name: p.first_name,
          last_name: p.last_name,
          phone_number: p.phone_number,
          transactions: [],
          count: 0,
          total_paid: 0,        // gross (what the client paid)
          total_collected: 0,   // amount_paid - overpayment_portion
          overpayment: 0,       // sum of overpayment_portion
          last_date: p.payment_date,
        };
        map.set(p.loan_id, g);
      }
      g.transactions.push(p);
      // Voided (reversed) payments stay visible on expand, badged, but are out
      // of every total — they've been pulled back off the books (mirrors the
      // loan-detail summary). Counting them here double-counts reversed cash
      // and resurrects overpayment that the reversal already cleared.
      if (p.payment_status === "voided") continue;
      g.count += 1;
      const op = parseFloat(p.overpayment_portion || 0);
      g.total_paid += parseFloat(p.amount_paid || 0);
      g.total_collected += parseFloat(p.amount_paid || 0) - op;
      g.overpayment += op;
      if (new Date(p.payment_date) > new Date(g.last_date))
        g.last_date = p.payment_date;
    }
    for (const g of map.values())
      g.transactions.sort(
        (a, b) => new Date(b.payment_date) - new Date(a.payment_date),
      );
    return [...map.values()];
  })();

  const {
    sortedData: sortedGroups,
    requestSort,
    getSortIndicator,
  } = useSortableTable(loanGroups, "last_date", "desc");

  // Pagination math (same pattern as Clients/Overdue pages) — over LOANS now
  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedGroups = sortedGroups.slice(startIndex, endIndex);

  // Totals across ALL filtered groups (not just the current page).
  // Sum gross, collected, and overpayment so the footer reads "what
  // did this date range actually move?" rather than "what's on
  // screen?" — matches how spreadsheets sum filtered ranges.
  const totals = sortedGroups.reduce(
    (acc, g) => ({
      count: acc.count + g.count,
      total_paid: acc.total_paid + g.total_paid,
      total_collected: acc.total_collected + g.total_collected,
      overpayment: acc.overpayment + g.overpayment,
    }),
    { count: 0, total_paid: 0, total_collected: 0, overpayment: 0 },
  );

  // ── Saved filter segments (localStorage only, via shared hook) ──────
  // The Payments page's only filter is the date range, so a segment is a
  // named snapshot of {dateFrom, dateTo}.
  const filtersActive = dateFrom !== "" || dateTo !== "";
  const handleSaveSegment = () => {
    const name = window.prompt("Name this segment (e.g. This month)");
    if (!name) return;
    saveSegment(name, { dateFrom, dateTo });
  };
  const applySegment = (segment) => {
    const snap = segment.snapshot || {};
    setDateFrom(snap.dateFrom || "");
    setDateTo(snap.dateTo || "");
    setCurrentPage(1);
  };

  // Desktop columns = the module-level model + a synthetic, always-demoted
  // "transactions" column carrying the per-transaction sub-table (lives here
  // because it needs the row handlers). It is never in a preset, so DataTable
  // always renders it inside the expand panel.
  const desktopColumns = [
    ...PAYMENT_COLUMNS,
    {
      key: "transactions",
      label: "Transactions",
      align: "left",
      sortable: false,
      fullSpan: true,
      cell: (g) => (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-400">
                <th className="text-left py-1 font-semibold">Transaction</th>
                <th className="text-left py-1 font-semibold">Amount</th>
                <th className="text-left py-1 font-semibold">Method</th>
                <th className="text-left py-1 font-semibold">Reference</th>
                <th className="text-right py-1 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {g.transactions.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-gray-200/70 dark:border-slate-700"
                >
                  <td className="py-1.5">
                    <button
                      onClick={() => setTxnModal(p)}
                      className="font-mono font-semibold text-green-600 hover:underline"
                    >
                      {p.transaction_code}
                    </button>
                  </td>
                  <td className="py-1.5 font-bold text-green-600">
                    {formatKES(p.amount_paid)}
                  </td>
                  <td className="py-1.5">
                    <span className="inline-block px-2 py-0.5 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
                      {p.payment_method}
                    </span>
                  </td>
                  <td className="py-1.5 text-gray-600 dark:text-slate-400">
                    {p.payment_reference || "-"}
                  </td>
                  <td className="py-1.5 text-right text-gray-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-2 justify-end">
                      {new Date(p.payment_date).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                      <button
                        onClick={() => openEditPayment(p)}
                        title="Edit payment"
                        className="text-gray-400 dark:text-slate-400 hover:text-ocean-600 transition"
                      >
                        <Pencil size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        icon={Coins}
        title="Payments"
        subtitle={`${payments.filter((p) => p.payment_status !== "voided").length} payments recorded`}
        actions={
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={loans.length === 0}
            className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showForm ? <span className="inline-flex items-center gap-1.5"><X size={16} /> Cancel</span> : "+ Record Payment"}
          </button>
        }
      />

      {/* Date range filter — filters by transaction.payment_date.
          Both inputs are independent; leaving one empty leaves that
          side unbounded. Clear button only renders when something
          is set. */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-3 mb-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-200">
          <Calendar size={16} /> Date range
        </span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-slate-400">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            max={dateTo || undefined}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-slate-400">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            min={dateFrom || undefined}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-slate-400 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition"
          >
            <X size={14} /> Clear
          </button>
        )}
        {(dateFrom || dateTo) && (
          <span className="ml-auto text-xs text-gray-500 dark:text-slate-400">
            Showing{" "}
            <span className="font-semibold text-gray-700 dark:text-slate-200">
              {sortedGroups.length}
            </span>{" "}
            of {loanGroups.length === sortedGroups.length ? sortedGroups.length : loanGroups.length} loans
          </span>
        )}
      </div>

      {/* Saved segments — named date-range snapshots (shared SegmentBar;
          localStorage only, never server-side). */}
      <SegmentBar
        className="mb-4"
        segments={segments}
        onApply={applySegment}
        onDelete={deleteSegment}
        onSave={handleSaveSegment}
        canSave={filtersActive}
      />

      {loans.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-4">
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} className="text-yellow-600" /> No active loans available. Create a loan first to record payments.</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Record Payment Form */}
      {showForm && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-6">
            Record New Payment
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Searchable Loan Dropdown */}
            <div ref={dropdownRef} className="relative">
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Select Loan *
                <span className="text-gray-500 dark:text-slate-400 font-normal ml-2">
                  (Search by loan code, client name, or phone)
                </span>
              </label>

              {selectedLoan ? (
                <div className="flex items-center gap-2 p-3 border-2 border-green-300 bg-green-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-semibold text-green-900">
                      {selectedLoan.loan_code} - {selectedLoan.first_name}{" "}
                      {selectedLoan.last_name}
                    </p>
                    <p className="text-sm text-green-700 flex items-center gap-1.5">
                      <Smartphone size={14} /> {selectedLoan.phone_number}
                      <span className="mx-1">•</span>
                      <Coins size={14} />{" "}
                      {formatKES(selectedLoan.principal_amount)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearLoan}
                    className="text-red-600 hover:text-red-800 px-2"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={loanSearch}
                    onChange={(e) => {
                      setLoanSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Type to search active loans..."
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />

                  {showDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-600 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                      {filteredLoans.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 dark:text-slate-400">
                          No active loans found
                        </div>
                      ) : (
                        filteredLoans.map((loan) => (
                          <button
                            key={loan.id}
                            type="button"
                            onClick={() => handleSelectLoan(loan)}
                            className="w-full text-left p-3 hover:bg-green-50 dark:hover:bg-slate-700 border-b border-gray-100 dark:border-slate-700 last:border-b-0 transition"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-semibold text-gray-800 dark:text-slate-100">
                                  {loan.loan_code}
                                </p>
                                <p className="text-sm text-gray-700 dark:text-slate-200">
                                  {loan.first_name} {loan.last_name} •{" "}
                                  {loan.phone_number}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                  Principal:{" "}
                                  {formatKES(loan.principal_amount)}{" "}
                                  • Remaining:{" "}
                                  {formatKES(
                                    loan.balance_due ??
                                      Math.max(
                                        parseFloat(loan.total_amount_due || 0) -
                                          parseFloat(loan.total_paid || 0),
                                        0,
                                      ),
                                  )}
                                </p>
                              </div>
                              <span className="text-xs font-mono text-green-600 bg-green-100 px-2 py-1 rounded">
                                {loan.status}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Loan Summary if selected — ledger style so the user can
                see at a glance what was cash vs waived on both the
                principal+interest book and the penalty book. Resolves
                the "I paid the balance and there's still 500 left"
                confusion: that 500 is the amount_due left after part of
                the cash had to clear the outstanding penalty first. */}
            {loanSummary && (() => {
              const s = loanSummary.summary;
              const num = (v) => parseFloat(v || 0);
              const fmt = (v) => num(v).toLocaleString();
              const totalDue = num(s.total_due);
              const cashToAmountDue = num(s.total_cash_paid);
              const waivedAmountDue = num(s.total_waived_amount_due);
              const balance = num(s.balance);
              // Cash overdue right now across past-due installments —
              // a collector-friendly "minimum to bring this loan
              // current" alongside the lifetime Balance.
              const overdueBalance = num(s.total_overdue_balance);
              const progress = parseFloat(s.progress_percentage || 0);
              const penaltyPaid = num(s.total_penalty_paid);
              const penaltyWaived = num(s.total_waived_penalty);
              const penaltyOutstanding = num(s.total_penalty_outstanding);
              // Accrued is the lifetime penalty bill for this loan
              // (cash paid + waived + still outstanding). Surface
              // it explicitly so a staff member can see at a glance
              // why the outstanding line lands where it does — e.g.
              // "9,517.64 accrued, 2,517.64 waived → 7,000 still
              // owed" reads cleanly instead of leaving the staff
              // to math the gap.
              const penaltyAccrued = penaltyPaid + penaltyWaived + penaltyOutstanding;
              const hasPenaltyActivity = penaltyAccrued > 0;
              const totalToPay = balance + penaltyOutstanding;
              return (
                <div className="bg-ocean-50 border border-ocean-200 rounded-lg p-4">
                  <h3 className="font-semibold text-ocean-900 mb-3 flex items-center gap-2">
                    <BarChart3 size={16} /> Loan Status
                  </h3>

                  {/* Principal + interest ledger */}
                  <div className="bg-white dark:bg-slate-800 rounded-md p-3 text-sm space-y-1.5">
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">
                      Principal + interest
                    </p>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-slate-400">Total due</span>
                      <span className="font-semibold text-gray-800 dark:text-slate-100">
                        KES {fmt(totalDue)}
                      </span>
                    </div>
                    <div className="flex justify-between pl-4">
                      <span className="text-gray-500 dark:text-slate-400">↳ Cash paid</span>
                      <span className="font-semibold text-green-700">
                        KES {fmt(cashToAmountDue)}
                      </span>
                    </div>
                    {waivedAmountDue > 0 && (
                      <div className="flex justify-between pl-4">
                        <span className="text-gray-500 dark:text-slate-400">↳ Waived</span>
                        <span className="font-semibold text-fuchsia-700">
                          KES {fmt(waivedAmountDue)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-100 dark:border-slate-700 pt-1.5">
                      <span className="font-semibold text-gray-700 dark:text-slate-200">Balance</span>
                      <span
                        className={`font-bold ${
                          balance > 0 ? "text-orange-600" : "text-green-600"
                        }`}
                      >
                        KES {fmt(balance)}
                      </span>
                    </div>
                    {/* Overdue line — only renders when something is
                        actually past due. Lets the collector see the
                        "bring this loan current" cash ask separately
                        from the full lifetime Balance above. Penalty
                        is in its own section below — this is the
                        amount_due slice only. */}
                    {overdueBalance > 0 && (
                      <div
                        className="flex justify-between pl-4"
                        title="Sum of unpaid amount_due across installments past their due date"
                      >
                        <span className="text-rose-700">↳ Overdue right now</span>
                        <span className="font-bold text-rose-700">
                          KES {fmt(overdueBalance)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 dark:text-slate-400">Progress</span>
                      <span className="font-semibold text-ocean-700">
                        {progress}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Penalty ledger — render whenever there's any
                      penalty activity (paid, waived, or still
                      outstanding). Outstanding line makes it clear
                      that penalty continues to accrue independent of
                      the principal+interest book; together with the
                      Total to pay row below it answers "what does
                      the borrower owe me right now in cash?". */}
                  {hasPenaltyActivity && (
                    <div className="mt-3 bg-white dark:bg-slate-800 rounded-md p-3 text-sm space-y-1.5">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">
                        Penalties
                      </p>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-400">Accrued</span>
                        <span className="font-semibold text-gray-800 dark:text-slate-100">
                          KES {fmt(penaltyAccrued)}
                        </span>
                      </div>
                      {penaltyPaid > 0 && (
                        <div className="flex justify-between pl-4">
                          <span className="text-gray-500 dark:text-slate-400">↳ Cash paid</span>
                          <span className="font-semibold text-rose-700">
                            KES {fmt(penaltyPaid)}
                          </span>
                        </div>
                      )}
                      {penaltyWaived > 0 && (
                        <div className="flex justify-between pl-4">
                          <span className="text-gray-500 dark:text-slate-400">↳ Waived</span>
                          <span className="font-semibold text-fuchsia-700">
                            KES {fmt(penaltyWaived)}
                          </span>
                        </div>
                      )}
                      {/* Always render Outstanding when there's any
                          penalty activity, even if 0 — gives the
                          staff a clear "nothing left to pay on
                          penalty" instead of leaving them to infer
                          from missing rows. Colour shifts to green
                          when there's nothing owed. */}
                      <div className="flex justify-between border-t border-gray-100 dark:border-slate-700 pt-1.5">
                        <span className="font-semibold text-gray-700 dark:text-slate-200">
                          Outstanding
                        </span>
                        <span
                          className={`font-bold ${
                            penaltyOutstanding > 0
                              ? "text-orange-600"
                              : "text-green-600"
                          }`}
                        >
                          KES {fmt(penaltyOutstanding)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Total to pay — what the borrower must hand over
                      right now to clear both books. Balance is the
                      remaining principal+interest after cash + waivers;
                      penaltyOutstanding is the still-accruing fine on
                      whatever's still overdue. Both are live figures. */}
                  {totalToPay > 0 && (
                    <div className="mt-3 bg-ocean-100/60 border border-ocean-200 rounded-md p-3 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-ocean-900 uppercase text-xs tracking-wide">
                          Total to pay now
                        </span>
                        <span className="font-bold text-ocean-900 text-lg">
                          KES {fmt(totalToPay)}
                        </span>
                      </div>
                      {penaltyOutstanding > 0 && balance > 0 && (
                        <p className="text-[11px] text-ocean-700/80 mt-1">
                          KES {fmt(balance)} balance + KES{" "}
                          {fmt(penaltyOutstanding)} penalty
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Payment Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Amount Paid (KES) *
                </label>
                <input
                  type="number"
                  name="amount_paid"
                  value={formData.amount_paid}
                  onChange={handleInputChange}
                  required
                  min="1"
                  step="0.01"
                  placeholder="9166.67"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  name="payment_date"
                  value={formData.payment_date}
                  onChange={handleInputChange}
                  required
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Payment Method *
                </label>
                <select
                  name="payment_method"
                  value={formData.payment_method}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                >
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Reference Number
                </label>
                <input
                  name="payment_reference"
                  value={formData.payment_reference}
                  onChange={handleInputChange}
                  placeholder="M-Pesa code, cheque #, etc."
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                placeholder="Any additional notes..."
                rows="2"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !formData.loan_id}
                className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
              >
                {submitting ? "Recording..." : <span className="inline-flex items-center gap-1.5"><Check size={16} /> Record Payment</span>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile totals card — pinned at the TOP of the list so the
          summary is visible without scrolling past every loan. Mirrors
          the desktop tfoot row content. */}
      {!loading && sortedGroups.length > 0 && (
        <div className="md:hidden bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 rounded-xl shadow-sm p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide font-bold text-emerald-700">
              Totals
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {sortedGroups.length} loan
              {sortedGroups.length !== 1 ? "s" : ""} · {totals.count} payment
              {totals.count !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">Total Paid</p>
              <p className="font-bold text-green-700">
                {formatKES(totals.total_paid)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">Total Collected</p>
              <p className="font-bold text-emerald-800">
                {formatKES(totals.total_collected)}
              </p>
            </div>
            {totals.overpayment > 0 && (
              <div className="col-span-2">
                <p className="text-[11px] text-gray-500 dark:text-slate-400">Overpayment</p>
                <p className="font-semibold text-amber-700">
                  {formatKES(totals.overpayment)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile card list (desktop uses the table below) */}
      {!loading && payments.length > 0 && (
        <div className="md:hidden space-y-3 mb-4">
          {paginatedGroups.map((g) => {
            const open = expanded.has(g.loan_id);
            return (
              <div key={g.loan_id} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-slate-100 truncate">
                      {g.first_name} {g.last_name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{g.phone_number}</p>
                    <Link
                      to={`/loans/${g.loan_id}`}
                      className="block text-xs text-ocean-600 font-mono hover:underline"
                    >
                      {g.loan_code}
                    </Link>
                  </div>
                  <span className="flex-shrink-0 inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                    {g.count} payment{g.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 dark:border-slate-700 pt-3">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Total Paid</p>
                    <p className="font-bold text-green-600">
                      {formatKES(g.total_paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Total Collected</p>
                    <p className="font-bold text-emerald-700">
                      {formatKES(g.total_collected)}
                    </p>
                  </div>
                  {g.overpayment > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 dark:text-slate-400">Overpayment</p>
                      <p className="font-semibold text-amber-700">
                        {formatKES(g.overpayment)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Last Payment</p>
                    <p className="font-semibold">
                      {new Date(g.last_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => toggleExpand(g.loan_id)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-ocean-600"
                >
                  {open ? (
                    <>
                      <ChevronDown size={14} /> Hide transactions
                    </>
                  ) : (
                    <>
                      <ChevronRight size={14} /> Show {g.count} transaction
                      {g.count !== 1 ? "s" : ""}
                    </>
                  )}
                </button>
                {open && (
                  <div className="mt-2 space-y-2 border-t border-gray-100 dark:border-slate-700 pt-2">
                    {g.transactions.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between items-center text-xs"
                      >
                        <button
                          onClick={() => setTxnModal(p)}
                          className="font-mono font-semibold text-green-600 hover:underline"
                        >
                          {p.transaction_code}
                        </button>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-500 dark:text-slate-400">
                            {new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                          </span>
                          <span className="font-bold text-green-600">
                            {formatKES(p.amount_paid)}
                          </span>
                          <button
                            onClick={() => openEditPayment(p)}
                            title="Edit payment"
                            className="text-gray-400 dark:text-slate-400 hover:text-ocean-600"
                          >
                            <Pencil size={13} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payments List */}
      {!loading && payments.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="No payments yet"
          description="Record a payment against an active loan and it will show up here."
          action={
            <button
              onClick={() => setShowForm(true)}
              disabled={loans.length === 0}
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Record Payment
            </button>
          }
        />
      ) : (
        /* Desktop — shared DataTable (column presets, expandable rows with
           the per-transaction sub-table, sticky pinned Client, totals,
           skeleton, scroll affordance). Mobile uses the card list above. */
        <div className="hidden md:block">
          <DataTable
            columns={desktopColumns}
            rows={paginatedGroups}
            rowKey={(g) => g.loan_id}
            pinned={{
              label: "Client",
              sortKey: "first_name",
              cell: (g) => (
                <div>
                  <p className="font-semibold text-gray-800 dark:text-slate-100">
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
            sort={{ requestSort, getSortIndicator }}
            totals={sortedGroups}
            totalsLabel={
              <span className="inline-flex items-center gap-2">
                <BarChart3 size={16} /> TOTAL ({sortedGroups.length} loan
                {sortedGroups.length !== 1 ? "s" : ""})
              </span>
            }
            loading={loading}
            skeletonRows={8}
            skeletonCols={7}
            empty={
              <EmptyState
                icon={Calendar}
                tone="muted"
                title="No payments in this date range"
                description="No transactions fall in the selected window. Clear the date range to see every payment."
                action={
                  (dateFrom || dateTo) && (
                    <button
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                      }}
                      className="inline-flex items-center gap-1.5 px-6 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <X size={15} /> Clear date range
                    </button>
                  )
                }
              />
            }
          />

          {!loading && sortedGroups.length > 0 && totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 mt-3 bg-white dark:bg-slate-800 rounded-xl shadow-card">
              <div className="text-sm text-gray-600 dark:text-slate-400">
                Showing <span className="font-semibold">{startIndex + 1}</span>{" "}
                to{" "}
                <span className="font-semibold">
                  {Math.min(endIndex, loanGroups.length)}
                </span>{" "}
                of <span className="font-semibold">{loanGroups.length}</span>{" "}
                loans
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
                        (page >= currentPage - 2 && page <= currentPage + 2),
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
                                ? "bg-green-600 text-white"
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

      {txnModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setTxnModal(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-1 text-gray-800 dark:text-slate-100 flex items-center gap-2"><Search size={20} /> Transaction</h3>
            <p className="font-mono text-green-600 mb-4">
              {txnModal.transaction_code}
            </p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Loan</dt>
                <dd className="font-mono">{txnModal.loan_code}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Client</dt>
                <dd className="font-semibold">
                  {txnModal.first_name} {txnModal.last_name}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Amount</dt>
                <dd className="font-bold text-green-600">
                  {formatKES(txnModal.amount_paid)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Method</dt>
                <dd>{txnModal.payment_method}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Reference</dt>
                <dd>{txnModal.payment_reference || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-slate-400">Date</dt>
                <dd>
                  {new Date(
                    txnModal.payment_date || txnModal.created_at,
                  ).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </dd>
              </div>
              {txnModal.notes && (
                <div>
                  <dt className="text-gray-500 dark:text-slate-400">Notes</dt>
                  <dd className="mt-1">{txnModal.notes}</dd>
                </div>
              )}
            </dl>
            <div className="flex justify-end gap-3 mt-5">
              <Link
                to={`/loans/${txnModal.loan_id}`}
                className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg text-sm"
              >
                View loan
              </Link>
              <button
                onClick={() => setTxnModal(null)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptModal && (
        <PaymentReceipt
          payment={receiptModal.payment}
          receipt={receiptModal.receipt}
          tenant={{
            ...tenantBranding,
            business_type:
              tenantBranding?.business_type ||
              JSON.parse(localStorage.getItem("user") || "{}")?.tenant
                ?.business_type,
          }}
          onClose={() => setReceiptModal(null)}
        />
      )}

      {/* ===== EDIT PAYMENT MODAL ===== */}
      {editForm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setEditForm(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                <Pencil size={18} className="text-ocean-600" /> Edit Payment
              </h3>
              <button
                onClick={() => setEditForm(null)}
                className="text-gray-400 dark:text-slate-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <p className="font-mono text-xs text-gray-500 dark:text-slate-400 mb-4">
              {editForm.transaction_code}
            </p>

            <form onSubmit={submitEditPayment} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Amount (KES)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={editForm.amount_paid}
                  onChange={(e) =>
                    setEditForm({ ...editForm, amount_paid: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().split("T")[0]}
                    value={editForm.payment_date}
                    onChange={(e) =>
                      setEditForm({ ...editForm, payment_date: e.target.value })
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={editForm.payment_time}
                    onChange={(e) =>
                      setEditForm({ ...editForm, payment_time: e.target.value })
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Method
                  </label>
                  <select
                    value={editForm.payment_method}
                    onChange={(e) =>
                      setEditForm({ ...editForm, payment_method: e.target.value })
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  >
                    {["M-Pesa", "Cash", "Bank", "Cheque", "Other"].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Reference
                  </label>
                  <input
                    type="text"
                    value={editForm.payment_reference}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        payment_reference: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>

              <p className="text-xs text-gray-500 dark:text-slate-400">
                Changing the amount re-derives the loan's schedule, balance and
                capital pool automatically.
              </p>
              {editError && (
                <p className="text-rose-600 text-sm">{editError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setEditForm(null)}
                  className="px-5 py-2.5 border border-gray-300 dark:border-slate-700 rounded-lg font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="flex-1 px-5 py-2.5 bg-ocean-gradient text-white rounded-lg font-bold disabled:opacity-60"
                >
                  {editSubmitting ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Payments;
