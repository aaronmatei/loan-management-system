// Promise to Pay — tenant-wide follow-up queue.
// Tabs: Pending (upcoming), Partial (some money in but short),
//       Broken (past due, nothing in), Kept, Cancelled.
// Backend derives 'broken' on read (pending + date < today); 'partial'
// is stored explicitly by reconcilePromisesForLoan whenever a payment
// lands that's smaller than the promised amount.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Handshake,
  RefreshCcw,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  X,
  CheckCheck,
  CircleDashed,
} from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton, { SkeletonText } from "../components/Skeleton";
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

const TABS = [
  {
    key: "pending",
    label: "Pending",
    icon: Clock,
    activeCls: "border-amber-600 text-amber-700",
    pillCls: "bg-amber-100 text-amber-800",
  },
  {
    key: "partial",
    label: "Partial",
    icon: CircleDashed,
    activeCls: "border-ocean-600 text-ocean-700",
    pillCls: "bg-ocean-100 text-ocean-800",
  },
  {
    key: "broken",
    label: "Broken",
    icon: AlertTriangle,
    activeCls: "border-rose-600 text-rose-700",
    pillCls: "bg-rose-100 text-rose-800",
  },
  {
    key: "kept",
    label: "Kept",
    icon: CheckCircle,
    activeCls: "border-emerald-600 text-emerald-700",
    pillCls: "bg-emerald-100 text-emerald-800",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    icon: XCircle,
    activeCls: "border-slate-600 text-slate-700",
    pillCls: "bg-slate-200 text-slate-700",
  },
];

function statusPill(status) {
  const t = TABS.find((x) => x.key === status);
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
        t?.pillCls || "bg-slate-100 text-slate-700"
      }`}
    >
      {status}
    </span>
  );
}

function Promises() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Per-action state — the "Cancel" path needs a typed reason; "Mark
  // kept" is a single confirm.
  const [actingOn, setActingOn] = useState(null); // { promise, mode: 'kept' | 'cancel' }
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [list, s] = await Promise.all([
        api.get(`/promises?status=${tab}`),
        api.get("/promises/summary"),
      ]);
      setRows(list.data.data || []);
      setSummary(s.data.data || {});
    } catch (err) {
      console.error("Failed to load promises:", err);
      setRows([]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleKept = async () => {
    if (!actingOn) return;
    setBusy(true);
    setActionError("");
    try {
      await api.put(`/promises/${actingOn.promise.id}/kept`);
      setActingOn(null);
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to mark kept");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!actingOn || !cancelReason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await api.put(`/promises/${actingOn.promise.id}/cancel`, {
        cancelled_reason: cancelReason.trim(),
      });
      setActingOn(null);
      setCancelReason("");
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to cancel");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setActingOn(null);
    setCancelReason("");
    setActionError("");
  };

  // Per-tab summary numbers. Pending/Broken summary fields come back
  // with both count and amount; Kept/Cancelled show count only (amount
  // isn't operationally interesting after resolution).
  const tileCount = summary[`${tab}_count`] ?? rows.length;
  const tileAmount = summary[`${tab}_amount`];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Handshake}
        title="Promises to Pay"
        subtitle="Verbal commitments captured from borrowers. Pending = upcoming; Partial = some money has landed but it's short of the promised amount; Broken = the date passed with nothing in; Kept = the full amount arrived. Statuses transition automatically as payments are recorded."
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 mb-6">
        {TABS.map((t) => {
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
                active
                  ? t.activeCls
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              <Icon size={15} /> {t.label}
              {summary[`${t.key}_count`] > 0 && (
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${t.pillCls}`}
                >
                  {summary[`${t.key}_count`]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Headline tiles for the active tab */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            {TABS.find((t) => t.key === tab)?.label}
          </p>
          <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">{tileCount}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            promise{tileCount !== 1 ? "s" : ""}{" "}
            {tab === "pending" ? "upcoming" : `(${tab})`}
          </p>
        </div>
        {tileAmount != null && (
          <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
            <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
              Total Amount
            </p>
            <p className="text-3xl font-bold text-amber-700 mt-2">
              {fmt(tileAmount)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              sum of {tab} promises
            </p>
          </div>
        )}
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Unique Loans
          </p>
          <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">
            {new Set(rows.map((r) => r.loan_id)).size}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            different loans on this tab
          </p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-8 w-40 mb-3" />
              <SkeletonText lines={2} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          tone="muted"
          title={
            tab === "pending"
              ? "No upcoming promises"
              : tab === "partial"
                ? "No partially-paid promises"
                : "Nothing here yet"
          }
          description={
            tab === "pending"
              ? "Log a promise from any loan's detail page."
              : tab === "partial"
                ? "Promises move here automatically once a payment lands that's smaller than the promised amount."
                : `No ${tab} promises on record.`
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <div
              key={p.id}
              className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <button
                      onClick={() => navigate(`/loans/${p.loan_id}`)}
                      className="font-mono text-sm font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                    >
                      {p.loan_code} <ArrowUpRight size={12} />
                    </button>
                    <span className="text-slate-300 dark:text-slate-400">·</span>
                    <span className="font-semibold text-navy-900 dark:text-slate-100">
                      {p.first_name} {p.last_name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {p.client_code}
                    </span>
                    {statusPill(p.derived_status)}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-bold text-2xl text-amber-700">
                      {fmt(p.amount)}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      by{" "}
                      <span className="font-semibold">
                        {fmtDate(p.promised_date)}
                      </span>
                    </span>
                    {p.derived_status === "broken" && (
                      <span className="text-xs text-rose-700 font-semibold">
                        {Math.abs(
                          Math.round(
                            (new Date(p.promised_date) - new Date()) /
                              (1000 * 60 * 60 * 24),
                          ),
                        )}{" "}
                        days past due
                      </span>
                    )}
                  </div>

                  {/* Partial breakdown — paid / promised / remaining
                      with a sky progress bar. paid_since is the
                      cumulative cash on this loan from completed txns
                      with created_at >= promise.made_at (mirror of the
                      reconciliation metric). Only renders when the
                      promise is in the partial bucket; for pending /
                      broken / kept / cancelled the row keeps its
                      previous shape. */}
                  {p.derived_status === "partial" && (() => {
                    const amount = parseFloat(p.amount || 0);
                    const paid = parseFloat(p.paid_since || 0);
                    const remaining = Math.max(0, amount - paid);
                    const pct =
                      amount > 0
                        ? Math.min(100, Math.round((paid / amount) * 100))
                        : 0;
                    return (
                      <div className="mb-2 rounded-lg border border-ocean-100 bg-ocean-50/60 px-3 py-2">
                        <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-0.5 text-xs">
                          <span className="text-slate-600">
                            Paid{" "}
                            <strong className="text-ocean-800">{fmt(paid)}</strong>{" "}
                            of{" "}
                            <strong className="text-slate-700">
                              {fmt(amount)}
                            </strong>
                          </span>
                          <span className="text-rose-700 font-semibold">
                            Remaining {fmt(remaining)}
                          </span>
                        </div>
                        <div className="mt-1.5 w-full h-1.5 rounded-full bg-ocean-100 overflow-hidden">
                          <div
                            className="h-full bg-ocean-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Cumulative cash on this loan since the promise was
                          logged · {pct}% of the promised amount
                        </p>
                      </div>
                    );
                  })()}

                  {p.notes && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">"{p.notes}"</p>
                  )}
                  {p.cancelled_reason && (
                    <p className="text-xs text-slate-700 dark:text-slate-200 mt-1">
                      <strong>Cancelled:</strong> {p.cancelled_reason}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Logged by{" "}
                    <strong>{p.captured_by_name || "—"}</strong> on{" "}
                    {new Date(p.made_at).toLocaleString("en-KE")}
                    {p.resolved_at && (
                      <>
                        {" "}· Resolved by{" "}
                        <strong>{p.resolved_by_name || "—"}</strong> on{" "}
                        {new Date(p.resolved_at).toLocaleString("en-KE")}
                      </>
                    )}
                  </p>
                </div>
                {/* Action buttons — show on pending / partial / broken
                    (all still awaiting full resolution). Kept and
                    cancelled rows are terminal. Manual "Mark Kept" on
                    a partial promise is the off-system completion
                    path: the rest came in cash and the admin closes
                    it out. */}
                {["pending", "partial", "broken"].includes(p.derived_status) && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setActingOn({ promise: p, mode: "cancel" })
                      }
                      className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
                    >
                      <XCircle size={16} /> Cancel
                    </button>
                    <button
                      onClick={() =>
                        setActingOn({ promise: p, mode: "kept" })
                      }
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
                    >
                      <CheckCheck size={16} /> Mark Kept
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mark kept / Cancel confirmation */}
      {actingOn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                {actingOn.mode === "kept" ? (
                  <>
                    <CheckCheck size={20} className="text-emerald-700" />
                    Mark as kept?
                  </>
                ) : (
                  <>
                    <XCircle size={20} className="text-rose-700" />
                    Cancel promise?
                  </>
                )}
              </h3>
              <button
                onClick={closeModal}
                disabled={busy}
                className="text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              {actingOn.mode === "kept" ? (
                <>
                  Marks{" "}
                  <strong className="text-amber-700">
                    {fmt(actingOn.promise.amount)}
                  </strong>{" "}
                  on loan{" "}
                  <span className="font-mono">
                    {actingOn.promise.loan_code}
                  </span>{" "}
                  as fulfilled. Use after a matching payment lands.
                </>
              ) : (
                <>
                  Closes the promise of{" "}
                  <strong className="text-rose-700">
                    {fmt(actingOn.promise.amount)}
                  </strong>{" "}
                  on loan{" "}
                  <span className="font-mono">
                    {actingOn.promise.loan_code}
                  </span>{" "}
                  with a reason. Use when the borrower's circumstances
                  changed and the promise no longer applies.
                </>
              )}
            </p>

            {actingOn.mode === "cancel" && (
              <>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Reason for cancellation *
                </label>
                <textarea
                  rows="2"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Borrower renegotiated the date"
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-rose-500 focus:outline-none mb-3"
                  required
                />
              </>
            )}

            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-3 text-sm">
                {actionError}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-3">
              <button
                onClick={closeModal}
                disabled={busy}
                className="px-5 py-2 bg-gray-500 text-white rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              {actingOn.mode === "kept" ? (
                <button
                  onClick={handleKept}
                  disabled={busy}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <CheckCheck size={16} />
                  {busy ? "Saving…" : "Mark Kept"}
                </button>
              ) : (
                <button
                  onClick={handleCancel}
                  disabled={busy || !cancelReason.trim()}
                  className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <XCircle size={16} />
                  {busy ? "Cancelling…" : "Cancel Promise"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Promises;
