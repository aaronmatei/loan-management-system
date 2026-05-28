// Waivers approval queue — admin only.
// Lists every loan-waiver row with status='pending' across the
// tenant, with one-click Approve / Reject buttons. Approving runs
// the allocation engine and notifies the customer; rejecting closes
// the request with a required reason.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HandCoins,
  RefreshCcw,
  Sparkles,
  CheckCircle,
  XCircle,
  Clock,
  ArrowUpRight,
  X,
  AlertTriangle,
} from "lucide-react";
import api from "../services/api";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

function Waivers() {
  const navigate = useNavigate();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state — reject needs a typed reason.
  const [actingOn, setActingOn] = useState(null); // { waiver, mode: 'approve' | 'reject' }
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await api.get("/waivers/pending");
      setPending(r.data.data || []);
    } catch (err) {
      console.error("Failed to load pending waivers:", err);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500">
          Loading pending waivers…
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Editorial header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-10">
        <div className="max-w-2xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-navy-900 tracking-tight">
            Waiver{" "}
            <span className="font-serif italic font-medium text-emerald-700">
              Approvals
            </span>
          </h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            Requests from your loan officers and managers, waiting for the
            final word. Approve to apply the allocation; reject to close out
            the request with a note.
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

      {/* Summary tile */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-amber-100/70 via-white/55 to-orange-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-amber-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-amber-700">
              Pending Requests
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Clock size={16} className="text-amber-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {pending.length}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            awaiting your sign-off
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-emerald-100/70 via-white/55 to-green-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-emerald-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-emerald-700">
              Total Requested
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <HandCoins size={16} className="text-emerald-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {fmt(pending.reduce((s, w) => s + parseFloat(w.amount || 0), 0))}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            sum across {pending.length} request
            {pending.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-sky-100/70 via-white/55 to-cyan-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-sky-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-sky-700">
              Unique Loans
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Sparkles size={16} className="text-sky-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {new Set(pending.map((w) => w.loan_id)).size}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            different loans affected
          </p>
        </div>
      </div>

      {/* Pending list */}
      {pending.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
          <CheckCircle
            size={42}
            className="text-emerald-400 mx-auto mb-3"
          />
          <h3 className="text-lg font-bold text-slate-700">
            All caught up
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            No waiver requests pending review.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((w) => (
            <div
              key={w.id}
              className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5"
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
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-navy-900">
                      {w.first_name} {w.last_name}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {w.client_code}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-bold text-emerald-700 text-2xl">
                      − {fmt(w.amount)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold uppercase">
                      {w.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">
                    <strong>Reason:</strong> {w.reason}
                  </p>
                  {w.notes && (
                    <p className="text-xs text-slate-500 mt-1 italic">
                      "{w.notes}"
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">
                    Requested by{" "}
                    <strong>{w.requested_by_name || "—"}</strong> on{" "}
                    {new Date(w.requested_at).toLocaleString("en-KE")} · loan
                    balance owed:{" "}
                    {fmt(
                      Math.max(
                        0,
                        parseFloat(w.total_amount_due) -
                          0, /* we don't have collected on this query */
                      ),
                    )}
                  </p>
                </div>
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approve / Reject confirmation */}
      {actingOn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                {actingOn.mode === "approve" ? (
                  <>
                    <CheckCircle size={20} className="text-emerald-700" />
                    Approve waiver?
                  </>
                ) : (
                  <>
                    <XCircle size={20} className="text-rose-700" />
                    Reject waiver?
                  </>
                )}
              </h3>
              <button
                onClick={() => {
                  setActingOn(null);
                  setRejectReason("");
                  setActionError("");
                }}
                disabled={busy}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              {actingOn.mode === "approve" ? (
                <>
                  Applies{" "}
                  <strong className="text-emerald-700">
                    {fmt(actingOn.waiver.amount)}
                  </strong>{" "}
                  to loan{" "}
                  <span className="font-mono">{actingOn.waiver.loan_code}</span>
                  . The customer will be notified.
                </>
              ) : (
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
            </p>

            {actingOn.mode === "reject" && (
              <>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Reason for rejection *
                </label>
                <textarea
                  rows="2"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Insufficient justification — please add documentation"
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
                onClick={() => {
                  setActingOn(null);
                  setRejectReason("");
                  setActionError("");
                }}
                disabled={busy}
                className="px-5 py-2 bg-gray-500 text-white rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              {actingOn.mode === "approve" ? (
                <button
                  onClick={handleApprove}
                  disabled={busy}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <CheckCircle size={16} />
                  {busy ? "Approving…" : "Approve & apply"}
                </button>
              ) : (
                <button
                  onClick={handleReject}
                  disabled={busy || !rejectReason.trim()}
                  className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <XCircle size={16} />
                  {busy ? "Rejecting…" : "Reject request"}
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
