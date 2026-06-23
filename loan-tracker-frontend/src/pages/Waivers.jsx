// Waivers — admin queue + tenant-wide history.
// Tabs: Pending (action queue), Approved, Rejected, Reversed.
// Pending pulls from /waivers/pending (admin-only). The history tabs
// share /waivers/history?status=approved|rejected|reversed.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HandCoins,
  RefreshCcw,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpRight,
  X,
  RotateCcw,
} from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton, { SkeletonText } from "../components/Skeleton";
import { formatKES } from "../utils/money";

const fmt = (n) => formatKES(n);

const TABS = [
  {
    key: "pending",
    label: "Pending",
    icon: Clock,
    activeCls: "border-amber-600 text-amber-700",
  },
  {
    key: "approved",
    label: "Approved",
    icon: CheckCircle,
    activeCls: "border-emerald-600 text-emerald-700",
  },
  {
    key: "rejected",
    label: "Rejected",
    icon: XCircle,
    activeCls: "border-rose-600 text-rose-700",
  },
  {
    key: "reversed",
    label: "Reversed",
    icon: RotateCcw,
    activeCls: "border-slate-600 text-slate-700",
  },
];

function statusPill(status) {
  const styles = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
    reversed: "bg-slate-200 text-slate-700",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
        styles[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {status}
    </span>
  );
}

function Waivers() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state — reject + reverse both need a typed reason.
  const [actingOn, setActingOn] = useState(null); // { waiver, mode: 'approve' | 'reject' | 'reverse' }
  const [rejectReason, setRejectReason] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      if (tab === "pending") {
        const r = await api.get("/waivers/pending");
        setRows(r.data.data || []);
        setTotals([]);
      } else {
        const r = await api.get(`/waivers/history?status=${tab}`);
        setRows(r.data.data || []);
        setTotals(r.data.totals || []);
      }
    } catch (err) {
      console.error("Failed to load waivers:", err);
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

  const handleApprove = async () => {
    if (!actingOn) return;
    setBusy(true);
    setActionError("");
    try {
      await api.put(`/waivers/${actingOn.waiver.id}/approve`);
      setActingOn(null);
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to approve");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!actingOn || !rejectReason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await api.put(`/waivers/${actingOn.waiver.id}/reject`, {
        rejection_reason: rejectReason.trim(),
      });
      setActingOn(null);
      setRejectReason("");
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to reject");
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async () => {
    if (!actingOn || !reverseReason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/waivers/${actingOn.waiver.id}/reverse`, {
        reversal_reason: reverseReason.trim(),
      });
      setActingOn(null);
      setReverseReason("");
      load({ silent: true });
    } catch (err) {
      setActionError(err.response?.data?.error || "Failed to reverse");
    } finally {
      setBusy(false);
    }
  };

  const closeModal = () => {
    setActingOn(null);
    setRejectReason("");
    setReverseReason("");
    setActionError("");
  };

  // Per-tab counts/totals for the small headline tiles.
  const totalsByStatus = Object.fromEntries(
    totals.map((t) => [t.status, t]),
  );
  const currentTotal = totalsByStatus[tab] || {
    count: rows.length,
    total_amount: rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0),
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={HandCoins}
        title="Waiver Approvals"
        subtitle="Requests from loan officers and managers. Pending sits at the top of the queue; Approved / Rejected / Reversed keep a full audit trail of every decision."
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
            </button>
          );
        })}
      </div>

      {/* Single summary tile for the active tab */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            {TABS.find((t) => t.key === tab)?.label}
          </p>
          <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">
            {currentTotal.count}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            waiver{currentTotal.count !== 1 ? "s" : ""}{" "}
            {tab === "pending" ? "awaiting review" : `(${tab})`}
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Total Amount
          </p>
          <p className="text-3xl font-bold text-emerald-700 mt-2">
            {fmt(currentTotal.total_amount)}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            sum of {tab} waivers
          </p>
        </div>
        <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
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
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5"
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
          icon={CheckCircle}
          tone="muted"
          title={tab === "pending" ? "All caught up" : "Nothing here yet"}
          description={
            tab === "pending"
              ? "No waiver requests pending review."
              : `No ${tab} waivers on record.`
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((w) => (
            <div
              key={w.id}
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <button
                      onClick={() => navigate(`/loans/${w.loan_id}`)}
                      className="font-mono text-sm font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                    >
                      {w.loan_code} <ArrowUpRight size={12} />
                    </button>
                    <span className="text-slate-300 dark:text-slate-400">·</span>
                    <span className="font-semibold text-navy-900 dark:text-slate-100">
                      {w.first_name} {w.last_name}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {w.client_code}
                    </span>
                    {statusPill(w.status)}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span
                      className={`font-bold text-2xl ${
                        w.status === "reversed"
                          ? "text-slate-500 dark:text-slate-400 line-through"
                          : "text-emerald-700"
                      }`}
                    >
                      − {fmt(w.amount)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold uppercase">
                      {w.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    <strong>Reason:</strong> {w.reason}
                  </p>
                  {w.notes && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                      "{w.notes}"
                    </p>
                  )}
                  {w.rejection_reason && (
                    <p className="text-xs text-rose-700 mt-1">
                      <strong>Rejected:</strong> {w.rejection_reason}
                    </p>
                  )}
                  {w.reversal_reason && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      <strong>Reversed:</strong> {w.reversal_reason}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Requested by{" "}
                    <strong>{w.requested_by_name || "—"}</strong> on{" "}
                    {new Date(w.requested_at).toLocaleString("en-KE")}
                    {w.approved_at && (
                      <>
                        {" "}· Approved by{" "}
                        <strong>{w.approved_by_name || "—"}</strong> on{" "}
                        {new Date(w.approved_at).toLocaleString("en-KE")}
                      </>
                    )}
                    {w.rejected_at && (
                      <>
                        {" "}· Rejected by{" "}
                        <strong>{w.rejected_by_name || "—"}</strong> on{" "}
                        {new Date(w.rejected_at).toLocaleString("en-KE")}
                      </>
                    )}
                    {w.reversed_at && (
                      <>
                        {" "}· Reversed by{" "}
                        <strong>{w.reversed_by_name || "—"}</strong> on{" "}
                        {new Date(w.reversed_at).toLocaleString("en-KE")}
                      </>
                    )}
                  </p>
                </div>
                {tab === "pending" && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setActingOn({ waiver: w, mode: "reject" })
                      }
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
                    >
                      <XCircle size={16} /> Reject
                    </button>
                    <button
                      onClick={() =>
                        setActingOn({ waiver: w, mode: "approve" })
                      }
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
                    >
                      <CheckCircle size={16} /> Approve
                    </button>
                  </div>
                )}
                {tab === "approved" && w.status === "approved" && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() =>
                        setActingOn({ waiver: w, mode: "reverse" })
                      }
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-semibold text-sm inline-flex items-center gap-2 transition"
                      title="Undo this waiver — restores schedule rows + pool counter"
                    >
                      <RotateCcw size={16} /> Reverse
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve / Reject / Reverse confirmation */}
      {actingOn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                {actingOn.mode === "approve" && (
                  <>
                    <CheckCircle size={20} className="text-emerald-700" />
                    Approve waiver?
                  </>
                )}
                {actingOn.mode === "reject" && (
                  <>
                    <XCircle size={20} className="text-rose-700" />
                    Reject waiver?
                  </>
                )}
                {actingOn.mode === "reverse" && (
                  <>
                    <RotateCcw size={20} className="text-rose-700" />
                    Reverse waiver?
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
              {actingOn.mode === "approve" && (
                <>
                  Applies{" "}
                  <strong className="text-emerald-700">
                    {fmt(actingOn.waiver.amount)}
                  </strong>{" "}
                  to loan{" "}
                  <span className="font-mono">{actingOn.waiver.loan_code}</span>
                  . The customer will be notified.
                </>
              )}
              {actingOn.mode === "reject" && (
                <>
                  Closes the request for{" "}
                  <strong className="text-rose-700">
                    {fmt(actingOn.waiver.amount)}
                  </strong>{" "}
                  on loan{" "}
                  <span className="font-mono">{actingOn.waiver.loan_code}</span>
                  . The borrower is NOT charged anything — the request is
                  simply declined.
                </>
              )}
              {actingOn.mode === "reverse" && (
                <>
                  Undoes{" "}
                  <strong className="text-rose-700">
                    {fmt(actingOn.waiver.amount)}
                  </strong>{" "}
                  on loan{" "}
                  <span className="font-mono">{actingOn.waiver.loan_code}</span>
                  . Schedule rows roll back to their pre-waiver state, the pool
                  counter is decremented, and the row stays in the Reversed tab
                  for audit. The borrower is notified.
                </>
              )}
            </p>

            {actingOn.mode === "reject" && (
              <>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Reason for rejection *
                </label>
                <textarea
                  rows="2"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Insufficient justification — please add documentation"
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-rose-500 focus:outline-none mb-3"
                  required
                />
              </>
            )}

            {actingOn.mode === "reverse" && (
              <>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Reason for reversal *
                </label>
                <textarea
                  rows="2"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="e.g. Applied to wrong loan — reversing"
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
              {actingOn.mode === "approve" && (
                <button
                  onClick={handleApprove}
                  disabled={busy}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <CheckCircle size={16} />
                  {busy ? "Approving…" : "Approve & apply"}
                </button>
              )}
              {actingOn.mode === "reject" && (
                <button
                  onClick={handleReject}
                  disabled={busy || !rejectReason.trim()}
                  className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <XCircle size={16} />
                  {busy ? "Rejecting…" : "Reject request"}
                </button>
              )}
              {actingOn.mode === "reverse" && (
                <button
                  onClick={handleReverse}
                  disabled={busy || !reverseReason.trim()}
                  className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <RotateCcw size={16} />
                  {busy ? "Reversing…" : "Reverse waiver"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Waivers;
