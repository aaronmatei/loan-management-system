import React, { useEffect, useState } from "react";
import {
  X,
  ShieldCheck,
  Gauge,
  Layers,
  BadgeCheck,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import api from "../services/api";

// Loan-underwriting worksheet. Surfaces the borrower's risk picture for a
// manual decision: internal score, CRB result, current exposure, KYC and
// repayment history. The officer can run a CRB check (or key one in when no
// bureau is connected), set a risk grade + notes, and save. The actual
// approve/reject stays in the parent (Applications) flow.
const GRADES = ["A", "B", "C", "D", "E"];
const GRADE_COLOR = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-green-100 text-green-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-rose-100 text-rose-700",
};
const STATUS_COLOR = {
  clear: "bg-emerald-100 text-emerald-700",
  no_hit: "bg-slate-100 text-slate-600",
  listed: "bg-amber-100 text-amber-700",
  defaulted: "bg-rose-100 text-rose-700",
  unknown: "bg-slate-100 text-slate-500",
};
const money = (v) => `KES ${Number(v || 0).toLocaleString()}`;

export default function UnderwritingModal({ loan, onClose }) {
  const loanId = loan?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ score: "", status: "clear", reference: "" });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/underwriting/${loanId}`);
      const d = res.data.data;
      setData(d);
      setGrade(d.loan.risk_grade || "");
      setNotes(d.loan.underwriting_notes || "");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load worksheet");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (loanId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanId]);

  const runCrb = async (body) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/underwriting/${loanId}/crb-check`, body || {});
      setManualOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || "CRB check failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAssessment = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/underwriting/${loanId}/assess`, {
        risk_grade: grade || null,
        notes,
        credit_check_id: data?.credit_check?.id || null,
      });
      onClose(true);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  if (!loanId) return null;
  const cc = data?.credit_check;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => onClose(false)}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-3xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-ocean-600" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Underwriting</h3>
            {data && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                · {data.client.name} · {data.loan.loan_code}
              </span>
            )}
          </div>
          <button onClick={() => onClose(false)} className="text-slate-400 dark:text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500 dark:text-slate-400">Loading worksheet…</div>
        ) : !data ? (
          <div className="p-10 text-center text-rose-600">{error || "Not found"}</div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Risk summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card icon={Gauge} label="Internal score" tint="ocean">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {data.client.credit_score ?? "—"}
                </span>
              </Card>
              <Card icon={Layers} label="Current exposure" tint="violet">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {data.exposure.active_loans}
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {money(data.exposure.active_principal)} out
                </span>
              </Card>
              <Card icon={BadgeCheck} label="KYC" tint={data.client.kyc_verified ? "green" : "amber"}>
                <span className="text-base font-bold">
                  {data.client.kyc_verified ? "Verified" : "Unverified"}
                </span>
              </Card>
              <Card icon={AlertTriangle} label="History" tint="slate">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {data.history.loans_completed} done · {data.history.loans_defaulted} default
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {data.history.overdue_installments} overdue inst.
                </span>
              </Card>
            </div>

            {/* CRB section */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-slate-800 dark:text-slate-100">Credit Reference Bureau</h4>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      data.crb.connected
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {data.crb.connected ? `${data.crb.name} connected` : "no live bureau"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => runCrb()}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-600 hover:text-ocean-700 disabled:opacity-50"
                  >
                    <RefreshCw size={14} /> Run check
                  </button>
                  <button
                    onClick={() => setManualOpen((v) => !v)}
                    className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700"
                  >
                    Enter manually
                  </button>
                </div>
              </div>

              {cc ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-3xl font-bold text-slate-900 dark:text-slate-100">{cc.score ?? "—"}</span>
                  {cc.grade && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${GRADE_COLOR[cc.grade] || "bg-slate-100"}`}>
                      Grade {cc.grade}
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[cc.status] || "bg-slate-100"}`}>
                    {cc.status}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-400">
                    {cc.source === "estimate"
                      ? "internal estimate"
                      : cc.source === "manual"
                      ? "manually entered"
                      : "bureau"}
                    {cc.reference ? ` · ${cc.reference}` : ""}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No CRB check yet. Run one, or enter a result from your bureau portal.
                </p>
              )}

              {manualOpen && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-slate-100 dark:border-slate-700 pt-3">
                  <input
                    type="number"
                    placeholder="Score"
                    value={manual.score}
                    onChange={(e) => setManual({ ...manual, score: e.target.value })}
                    className="px-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg text-sm"
                  />
                  <select
                    value={manual.status}
                    onChange={(e) => setManual({ ...manual, status: e.target.value })}
                    className="px-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg text-sm"
                  >
                    {["clear", "listed", "defaulted", "no_hit"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Reference"
                    value={manual.reference}
                    onChange={(e) => setManual({ ...manual, reference: e.target.value })}
                    className="px-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg text-sm"
                  />
                  <button
                    onClick={() => runCrb({ manual: true, ...manual })}
                    disabled={busy || !manual.score}
                    className="sm:col-span-3 px-4 py-2 bg-ocean-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                  >
                    Save CRB result
                  </button>
                </div>
              )}
            </div>

            {/* Decision */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                  Risk grade
                </label>
                <div className="flex gap-1.5">
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      onClick={() => setGrade(g === grade ? "" : g)}
                      className={`w-9 h-9 rounded-lg font-bold text-sm ${
                        grade === g
                          ? GRADE_COLOR[g] + " ring-2 ring-offset-1 ring-slate-300"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                  Underwriting notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Affordability, collateral, references, recommendation…"
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg text-sm"
                />
              </div>
            </div>

            {error && <p className="text-rose-600 text-sm">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => onClose(false)}
                className="px-5 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Close
              </button>
              <button
                onClick={saveAssessment}
                disabled={busy}
                className="px-6 py-2.5 bg-ocean-gradient text-white rounded-lg font-bold disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save assessment"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, tint, children }) {
  const tints = {
    ocean: "bg-ocean-50 text-ocean-600",
    violet: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-xl p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg ${tints[tint] || tints.slate}`}>
          <Icon size={13} />
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
          {label}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}
