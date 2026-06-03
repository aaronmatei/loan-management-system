// Promise to Pay — tenant-wide follow-up queue.
// Tabs: Pending (upcoming), Broken (past due, unresolved), Kept, Cancelled.
// Backend derives the "broken" status on read so we don't depend on a cron.

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
} from "lucide-react";
import api from "../services/api";
import Spinner from "../components/Spinner";

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

const TABS = [
  {
    key: "pending",
    label: "Pending",
    icon: Clock,
    activeCls: "border-amber-600 text-amber-700",
    pillCls: "bg-amber-100 text-amber-800",
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
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div className="max-w-2xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-navy-900 tracking-tight">
            Promises{" "}
            <span className="font-serif italic font-medium text-amber-700">
              to Pay
            </span>
          </h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            Verbal commitments captured from borrowers. Pending = upcoming;
            Broken = the date passed and the promise wasn't resolved. Mark
            kept once a matching payment lands, or cancel with a reason.
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-6">
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
                  : "border-transparent text-slate-500 hover:text-slate-700"
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
        <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            {TABS.find((t) => t.key === tab)?.label}
          </p>
          <p className="text-3xl font-bold text-navy-900 mt-2">{tileCount}</p>
          <p className="text-xs text-slate-500 mt-1">
            promise{tileCount !== 1 ? "s" : ""}{" "}
            {tab === "pending" ? "upcoming" : `(${tab})`}
          </p>
        </div>
        {tileAmount != null && (
          <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
            <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
              Total Amount
            </p>
            <p className="text-3xl font-bold text-amber-700 mt-2">
              {fmt(tileAmount)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              sum of {tab} promises
            </p>
          </div>
        )}
        <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
            Unique Loans
          </p>
          <p className="text-3xl font-bold text-navy-900 mt-2">
            {new Set(rows.map((r) => r.loan_id)).size}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            different loans on this tab
          </p>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12">
          <Spinner centered label={`Loading ${tab} promises…`} />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <Handshake size={42} className="text-amber-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-700">
            {tab === "pending"
              ? "No upcoming promises"
              : "Nothing here yet"}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {tab === "pending"
              ? "Log a promise from any loan's detail page."
              : `No ${tab} promises on record.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5"
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
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-navy-900">
                      {p.first_name} {p.last_name}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {p.client_code}
                    </span>
                    {statusPill(p.derived_status)}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-bold text-2xl text-amber-700">
                      {fmt(p.amount)}
                    </span>
                    <span className="text-sm text-slate-600">
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
                  {p.notes && (
                    <p className="text-xs text-slate-600 italic">"{p.notes}"</p>
                  )}
                  {p.cancelled_reason && (
                    <p className="text-xs text-slate-700 mt-1">
                      <strong>Cancelled:</strong> {p.cancelled_reason}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">
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
                {/* Action buttons — only on pending/broken (still
                    awaiting resolution). Kept/cancelled rows are
                    terminal. */}
                {["pending", "broken"].includes(p.derived_status) && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setActingOn({ promise: p, mode: "cancel" })
                      }
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
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
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
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
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
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
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Reason for cancellation *
                </label>
                <textarea
                  rows="2"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Borrower renegotiated the date"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none mb-3"
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
