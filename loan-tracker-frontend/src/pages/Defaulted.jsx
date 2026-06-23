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
import Skeleton from "../components/Skeleton";
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
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
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
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Defaulted
          </p>
          <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">{totalCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            loan{totalCount !== 1 ? "s" : ""} on the book
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
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
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
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
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
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

      {/* List */}
      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          tone="muted"
          title="No defaulted loans"
          description="Everything on the book is current or being repaid."
        />
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full whitespace-nowrap">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b-2 border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                <tr className="text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">
                  <th className="px-4 py-3">Loan</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Principal</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Penalty</th>
                  <th className="px-4 py-3 text-right" title="Days since the oldest unpaid installment came due">
                    Days
                  </th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  // Sort by days-late DESC (deepest defaults first) —
                  // that's the natural collections-side ordering.
                  // Ties broken by balance at risk so big-money rows
                  // still sit above smaller ones at the same age.
                  .sort((a, b) => {
                    const da = parseInt(a.max_days_late, 10) || 0;
                    const db = parseInt(b.max_days_late, 10) || 0;
                    if (db !== da) return db - da;
                    return (
                      parseFloat(b.balance_due || 0) -
                      parseFloat(a.balance_due || 0)
                    );
                  })
                  .map((loan) => {
                    // max_days_late comes from the loans-list overdue
                    // subquery — days since the OLDEST unpaid
                    // installment came due, not since the loan row
                    // was last updated (which my earlier draft used
                    // and was both stale + misleading after any
                    // recent edit bumped updated_at).
                    const days = parseInt(loan.max_days_late, 10) || 0;
                    const penalty = penaltyByLoan.get(loan.id) || 0;
                    return (
                      <tr
                        key={loan.id}
                        className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/loans/${loan.id}`)}
                            className="font-mono text-sm font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                          >
                            {loan.loan_code} <ArrowUpRight size={12} />
                          </button>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            disbursed {fmtDate(loan.disbursed_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-navy-900 dark:text-slate-100 text-sm">
                            {loan.first_name} {loan.last_name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {loan.client_code}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                            {fmt(loan.principal_amount)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-bold text-rose-700 text-sm">
                            {fmt(loan.balance_due)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {penalty > 0 ? (
                            <p
                              className="font-semibold text-orange-600 text-sm"
                              title="Sum of penalty_outstanding across this loan's overdue installments"
                            >
                              {fmt(penalty)}
                            </p>
                          ) : (
                            <p className="text-slate-300 text-sm">—</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {days > 0 ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                                days > 90
                                  ? "bg-red-200 text-red-900"
                                  : days >= 31
                                    ? "bg-red-100 text-red-700"
                                    : days >= 8
                                      ? "bg-orange-100 text-orange-700"
                                      : "bg-yellow-100 text-yellow-700"
                              }`}
                              title="Days since the oldest unpaid installment came due"
                            >
                              {days}d
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => navigate(`/loans/${loan.id}`)}
                              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
                            >
                              <Eye size={13} /> Open
                            </button>
                            <PermissionGate role={["admin", "manager"]}>
                              <button
                                onClick={() => setReactivating(loan)}
                                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
                                title="Move back to active so waivers / new payments can land"
                              >
                                <CheckCircle size={13} /> Reactivate
                              </button>
                            </PermissionGate>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reactivate confirmation */}
      {reactivating && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
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
