// Defaulted Loans — dedicated workflow page for the loans that
// have been flagged as 'defaulted'. Pre-filtered slice of /loans
// with summary tiles + one-click Reactivate per row, so collections
// admins don't have to navigate Loans → filter → status → defaulted
// every time.

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertOctagon,
  RefreshCcw,
  CheckCircle,
  Eye,
  ArrowUpRight,
  X,
  Flame,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import DataTable from "../components/DataTable";
import { useColumnPreset } from "../hooks/useTablePrefs";
import { formatKES } from "../utils/money";

const fmt = (n) => formatKES(n);

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const num = (v) => parseFloat(v || 0);

// ── Defaulted-loans table column model ────────────────────────────────
// Column-driven so the page can offer client-side presets (which columns
// render in the row) and push the rest into an expandable detail row.
// Loan Code is pinned (rendered specially) and so is NOT in this list.
// `money` columns also contribute to the totals footer. Each row carries
// a derived `penalty` (Σ penalty_outstanding) and `days` (max_days_late)
// so the cells stay pure presentation. The Action column injects its
// handlers via the factory arg.
const defaultedColumns = ({ navigate, onReactivate }) => [
  {
    key: "client",
    label: "Client",
    align: "left",
    cell: (loan) => (
      <div>
        <p className="font-semibold text-navy-900 dark:text-slate-100 text-sm">
          {loan.first_name} {loan.last_name}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          {loan.client_code}
        </p>
      </div>
    ),
  },
  {
    key: "principal_amount",
    label: "Principal",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, r) => s + num(r.principal_amount), 0),
    totalClass: "text-amber-700",
    cell: (loan) => (
      <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
        {fmt(loan.principal_amount)}
      </p>
    ),
  },
  {
    key: "balance_due",
    label: "Balance",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, r) => s + num(r.balance_due), 0),
    totalClass: "text-rose-700",
    cell: (loan) => (
      <p className="font-bold text-rose-700 text-sm">{fmt(loan.balance_due)}</p>
    ),
  },
  {
    key: "penalty",
    label: "Penalty",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, r) => s + num(r.penalty), 0),
    totalClass: "text-orange-600",
    cell: (loan) =>
      loan.penalty > 0 ? (
        <p
          className="font-semibold text-orange-600 text-sm"
          title="Sum of penalty_outstanding across this loan's overdue installments"
        >
          {fmt(loan.penalty)}
        </p>
      ) : (
        <p className="text-slate-300 text-sm">—</p>
      ),
  },
  {
    key: "days",
    label: "Days",
    align: "right",
    cell: (loan) =>
      loan.days > 0 ? (
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
            loan.days > 90
              ? "bg-red-200 text-red-900"
              : loan.days >= 31
                ? "bg-red-100 text-red-700"
                : loan.days >= 8
                  ? "bg-orange-100 text-orange-700"
                  : "bg-yellow-100 text-yellow-700"
          }`}
          title="Days since the oldest unpaid installment came due"
        >
          {loan.days}d
        </span>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      ),
  },
  {
    key: "action",
    label: "Action",
    align: "left",
    cell: (loan) => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(`/loans/${loan.id}`)}
          className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
        >
          <Eye size={13} /> Open
        </button>
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => onReactivate(loan)}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
            title="Move back to active so waivers / new payments can land"
          >
            <CheckCircle size={13} /> Reactivate
          </button>
        </PermissionGate>
      </div>
    ),
  },
];

// Column presets — which keys render in the row. Loan Code is always
// pinned and shown outside this set. Hidden keys drop into the expandable
// detail row, so nothing is lost — just demoted.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["client", "balance_due", "days", "action"],
  },
  full: {
    label: "Everything",
    keys: ["client", "principal_amount", "balance_due", "penalty", "days", "action"],
  },
};

const PRESET_STORAGE_KEY = "defaulted.columnPreset";

function Defaulted() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  // Per-installment overdue rows — fetched alongside the defaulted
  // loans so we can roll up accrued penalty by loan. /overdue already
  // computes the live penalty figure per row (same formula the
  // schedule + Overdue page use), so grouping by loan_id here is the
  // cheapest way to surface a correct penalty on the defaulted view.
  const [overdueRows, setOverdueRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reactivating, setReactivating] = useState(null); // loan row
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // ── Table UX state (client-side only) ─────────────────────────
  // Expanded rows reveal columns demoted by the active preset.
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleRow = (id) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Column preset — shared hook, localStorage only. (No client-side
  // filters on this page, so there are no saved segments to manage.)
  const [columnPreset, setColumnPreset] = useColumnPreset(
    PRESET_STORAGE_KEY,
    COLUMN_PRESETS,
    "full",
  );

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [loansRes, overdueRes] = await Promise.all([
        api.get("/loans?status=defaulted&limit=10000"),
        api.get("/overdue?limit=10000"),
      ]);
      setRows(loansRes.data.data || []);
      setOverdueRows(overdueRes.data.data || []);
    } catch (err) {
      console.error("Failed to load defaulted loans:", err);
      setRows([]);
      setOverdueRows([]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  // Per-loan accrued penalty = Σ penalty_outstanding across that loan's
  // overdue installments. penalty_outstanding falls back to
  // penalty_total when missing (same precedence Overdue.jsx uses).
  const penaltyByLoan = useMemo(() => {
    const m = new Map();
    for (const o of overdueRows) {
      const p = parseFloat(
        o.penalty_outstanding ?? o.penalty_total ?? 0,
      );
      if (!p) continue;
      m.set(o.loan_id, (m.get(o.loan_id) || 0) + p);
    }
    return m;
  }, [overdueRows]);

  useEffect(() => {
    load();
  }, []);

  const handleReactivate = async () => {
    if (!reactivating) return;
    setBusy(true);
    setActionError("");
    try {
      await api.put(`/loans/${reactivating.id}/status`, { status: "active" });
      setReactivating(null);
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to reactivate");
    } finally {
      setBusy(false);
    }
  };

  // Summary tiles — count, total balance at risk, accrued penalty,
  // oldest defaulted loan. balance_due on each row already accounts
  // for waivers (the loans-list fix we shipped earlier), so summing it
  // gives the cash-equivalent exposure that's still on the book.
  const totalCount = rows.length;
  const totalAtRisk = rows.reduce(
    (s, r) => s + parseFloat(r.balance_due || 0),
    0,
  );
  const totalPenalty = rows.reduce(
    (s, r) => s + (penaltyByLoan.get(r.id) || 0),
    0,
  );
  const totalPrincipal = rows.reduce(
    (s, r) => s + parseFloat(r.principal_amount || 0),
    0,
  );
  // "Oldest default days" = longest overdue installment across the
  // defaulted book. max_days_late comes from the loans-list overdue
  // subquery and represents the per-loan max — taking max-of-max
  // across rows gives portfolio-level worst.
  const oldest = rows.reduce((acc, r) => {
    const d = parseInt(r.max_days_late, 10) || 0;
    return d > 0 && (acc == null || d > acc) ? d : acc;
  }, null);

  // Sorted + derived rows for the table. Sort by days-late DESC
  // (deepest defaults first) — the natural collections-side ordering.
  // Ties broken by balance at risk so big-money rows still sit above
  // smaller ones at the same age. `days` and `penalty` are precomputed
  // so the column cells stay pure presentation.
  const tableRows = rows
    .slice()
    .sort((a, b) => {
      const da = parseInt(a.max_days_late, 10) || 0;
      const db = parseInt(b.max_days_late, 10) || 0;
      if (db !== da) return db - da;
      return parseFloat(b.balance_due || 0) - parseFloat(a.balance_due || 0);
    })
    .map((loan) => ({
      ...loan,
      days: parseInt(loan.max_days_late, 10) || 0,
      penalty: penaltyByLoan.get(loan.id) || 0,
    }));

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={AlertOctagon}
        title="Defaulted Loans"
        subtitle="Loans flagged as defaulted. Reactivate to move them back onto the active book (waivers and renegotiation need to land on a live obligation). The list is sorted by balance at risk, largest first."
        actions={
          <button
            onClick={() => load({ silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-surface border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Defaulted
          </p>
          <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">{totalCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            loan{totalCount !== 1 ? "s" : ""} on the book
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Balance at Risk
          </p>
          <p className="text-3xl font-bold text-rose-700 mt-2">
            {fmt(totalAtRisk)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            still owed (post-waiver, post-cash)
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Flame size={12} className="text-orange-600" /> Penalty Accrued
          </p>
          <p className="text-3xl font-bold text-orange-600 mt-2">
            {fmt(totalPenalty)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            outstanding fines on these loans
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Principal Lent
          </p>
          <p className="text-3xl font-bold text-amber-700 mt-2">
            {fmt(totalPrincipal)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            across {totalCount} loan{totalCount !== 1 ? "s" : ""}
            {oldest != null && ` · oldest ${oldest}d`}
          </p>
        </div>
      </div>

      {/* List — shared DataTable (column presets, expandable rows,
          sticky pinned Loan Code, totals footer, skeleton). The rows
          are pre-sorted (days-late DESC) by the page, so the column
          headers are not interactive sorters. */}
      <DataTable
        columns={defaultedColumns({
          navigate,
          onReactivate: (loan) => setReactivating(loan),
        })}
        rows={tableRows}
        rowKey={(l) => l.id}
        pinned={{
          label: "Loan",
          cell: (loan) => (
            <div>
              <button
                onClick={() => navigate(`/loans/${loan.id}`)}
                className="font-mono text-sm font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
              >
                {loan.loan_code} <ArrowUpRight size={12} />
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                disbursed {fmtDate(loan.disbursed_at)}
              </p>
            </div>
          ),
        }}
        presets={COLUMN_PRESETS}
        preset={columnPreset}
        onPresetChange={setColumnPreset}
        expandedRows={expandedRows}
        onToggleRow={toggleRow}
        totals={tableRows}
        totalsLabel={`TOTALS (${tableRows.length})`}
        loading={loading}
        skeletonRows={6}
        skeletonCols={7}
        empty={
          <EmptyState
            icon={CheckCircle}
            tone="muted"
            title="No defaulted loans"
            description="Everything on the book is current or being repaid."
          />
        }
      />

      {/* Reactivate confirmation */}
      {reactivating && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-700" />
                Reactivate loan?
              </h3>
              <button
                onClick={() => {
                  setReactivating(null);
                  setActionError("");
                }}
                disabled={busy}
                className="text-slate-400 dark:text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              Moves loan{" "}
              <span className="font-mono">{reactivating.loan_code}</span>{" "}
              back to <strong>active</strong>. Waivers and new payments will
              accept again. The defaulted history stays on the audit trail.
            </p>

            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-3 text-sm">
                {actionError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReactivating(null);
                  setActionError("");
                }}
                disabled={busy}
                className="px-5 py-2 bg-gray-500 text-white rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReactivate}
                disabled={busy}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                <CheckCircle size={16} />
                {busy ? "Reactivating…" : "Reactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Defaulted;
