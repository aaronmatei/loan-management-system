// Defaulted Loans — dedicated workflow page for the loans that
// have been flagged as 'defaulted'. Pre-filtered slice of /loans
// with summary tiles + one-click Reactivate per row, so collections
// admins don't have to navigate Loans → filter → status → defaulted
// every time.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertOctagon,
  RefreshCcw,
  CheckCircle,
  Eye,
  ArrowUpRight,
  X,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const daysSince = (d) => {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

function Defaulted() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reactivating, setReactivating] = useState(null); // loan row
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await api.get("/loans?status=defaulted&limit=10000");
      setRows(r.data.data || []);
    } catch (err) {
      console.error("Failed to load defaulted loans:", err);
      setRows([]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

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

  // Summary tiles — count, total balance at risk, oldest defaulted loan.
  // balance_due on each row already accounts for waivers (the loans-list
  // fix we shipped earlier), so summing it gives the cash-equivalent
  // exposure that's still on the book.
  const totalCount = rows.length;
  const totalAtRisk = rows.reduce(
    (s, r) => s + parseFloat(r.balance_due || 0),
    0,
  );
  const totalPrincipal = rows.reduce(
    (s, r) => s + parseFloat(r.principal_amount || 0),
    0,
  );
  const oldest = rows.reduce((acc, r) => {
    const d = daysSince(r.updated_at);
    return d != null && (acc == null || d > acc) ? d : acc;
  }, null);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div className="max-w-2xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-navy-900 tracking-tight">
            Defaulted{" "}
            <span className="font-serif italic font-medium text-rose-700">
              Loans
            </span>
          </h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            Loans flagged as defaulted. Reactivate to move them back onto the
            active book (waivers and renegotiation need to land on a live
            obligation). The list is sorted by balance at risk, largest first.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={() => load({ silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            Defaulted
          </p>
          <p className="text-3xl font-bold text-navy-900 mt-2">{totalCount}</p>
          <p className="text-xs text-slate-500 mt-1">
            loan{totalCount !== 1 ? "s" : ""} on the book
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            Balance at Risk
          </p>
          <p className="text-3xl font-bold text-rose-700 mt-2">
            {fmt(totalAtRisk)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            still owed (post-waiver, post-cash)
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            Principal Lent
          </p>
          <p className="text-3xl font-bold text-amber-700 mt-2">
            {fmt(totalPrincipal)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            across {totalCount} loan{totalCount !== 1 ? "s" : ""}
            {oldest != null && ` · oldest ${oldest}d`}
          </p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500">
          Loading defaulted loans…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <CheckCircle size={42} className="text-emerald-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-700">
            No defaulted loans
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Everything on the book is current or being repaid.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full whitespace-nowrap">
              <thead className="bg-slate-50 border-b-2 border-slate-200 sticky top-0 z-10">
                <tr className="text-left text-xs font-semibold text-slate-600 uppercase">
                  <th className="px-4 py-3">Loan</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Principal</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Days</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort(
                    (a, b) =>
                      parseFloat(b.balance_due || 0) -
                      parseFloat(a.balance_due || 0),
                  )
                  .map((loan) => {
                    const days = daysSince(loan.updated_at);
                    return (
                      <tr
                        key={loan.id}
                        className="border-b border-slate-100 hover:bg-slate-50 transition"
                      >
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/loans/${loan.id}`)}
                            className="font-mono text-sm font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                          >
                            {loan.loan_code} <ArrowUpRight size={12} />
                          </button>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            disbursed {fmtDate(loan.disbursed_at)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-navy-900 text-sm">
                            {loan.first_name} {loan.last_name}
                          </p>
                          <p className="text-xs text-slate-500 font-mono">
                            {loan.client_code}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-semibold text-slate-800 text-sm">
                            {fmt(loan.principal_amount)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-bold text-rose-700 text-sm">
                            {fmt(loan.balance_due)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="text-sm text-slate-700">
                            {days != null ? `${days}d` : "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => navigate(`/loans/${loan.id}`)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
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
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <CheckCircle size={20} className="text-emerald-700" />
                Reactivate loan?
              </h3>
              <button
                onClick={() => {
                  setReactivating(null);
                  setActionError("");
                }}
                disabled={busy}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
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
