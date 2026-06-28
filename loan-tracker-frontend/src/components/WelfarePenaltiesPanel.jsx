import React, { useState, useEffect } from "react";
import { Gavel, Coins, Ban } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";
import StatTiles from "./StatTiles";

// Fines are now defined ON each contribution / event / meeting. This page is a
// read-only ledger: every fine raised against members, and what it was for.
const TRIGGER_LABEL = {
  contribution_late: "Late contribution",
  loan_late: "Late loan",
  attendance_absent: "Absent",
  attendance_late: "Late to meeting",
  meeting_missed: "Absent",
  manual: "Manual",
};
const KIND_BADGE = {
  contribution: "bg-sky-100 text-sky-700",
  meeting: "bg-indigo-100 text-indigo-700",
};
const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });

export default function WelfarePenaltiesPanel({ welfareId }) {
  const [penalties, setPenalties] = useState([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/penalties${showAll ? "" : "?status=outstanding"}`);
      setPenalties(r.data.data || []);
      setOutstanding(r.data.outstanding_total || 0);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async (a) => {
    if (!confirm(`Record full payment of ${money(a.amount - a.paid_amount)} for this fine?`)) return;
    try { await api.post(`/welfares/${welfareId}/penalties/${a.id}/pay`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };
  const waive = async (a) => {
    if (!confirm("Waive this fine?")) return;
    try { await api.post(`/welfares/${welfareId}/penalties/${a.id}/waive`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };

  const tab = (on) => `px-3 py-1 text-sm font-semibold rounded-lg ${on ? "bg-rose-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`;

  // Outstanding fines broken out by penalty type (shown even when zero).
  const groupOf = (t) => (t === "contribution_late" ? "Contributions" : (t || "").startsWith("attendance") ? "Meetings" : t === "loan_late" ? "Loans" : "Other");
  const groups = penalties.reduce((acc, p) => {
    const g = groupOf(p.trigger);
    acc[g] = acc[g] || { count: 0, outstanding: 0 };
    acc[g].count += 1;
    acc[g].outstanding += p.status === "outstanding" ? Number(p.amount) - Number(p.paid_amount) : 0;
    return acc;
  }, {});
  const penTiles = ["Contributions", "Meetings", "Loans"].map((g) => {
    const v = groups[g] || { count: 0, outstanding: 0 };
    return { label: g, value: money(v.outstanding), sub: `${v.count} fine${v.count === 1 ? "" : "s"}`, tone: v.outstanding > 0 ? "rose" : "slate" };
  });
  if (groups.Other) penTiles.push({ label: "Other", value: money(groups.Other.outstanding), sub: `${groups.Other.count} fine${groups.Other.count === 1 ? "" : "s"}`, tone: groups.Other.outstanding > 0 ? "rose" : "slate" });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-rose-100 mb-6 overflow-hidden">
      <div className="bg-rose-50 px-5 py-3 border-b border-rose-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Gavel size={18} className="text-rose-600" /> Penalties
        </h2>
        <div className="text-right">
          <p className="text-xs text-rose-700/70">Outstanding</p>
          <p className="text-lg font-bold text-rose-800">{money(outstanding)}</p>
        </div>
      </div>

      <div className="p-5">
        {!loading && <StatTiles tiles={penTiles} />}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">Fines are set when you create a contribution, event or meeting — and charged automatically. This is the record.</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setShowAll(false)} className={tab(!showAll)}>Outstanding</button>
            <button onClick={() => setShowAll(true)} className={tab(showAll)}>All</button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : penalties.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{showAll ? "No fines recorded." : "No outstanding fines. 🎉"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Member</th>
                  <th className="text-left px-4 py-2">For</th>
                  <th className="text-left px-4 py-2">Reason</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {penalties.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 text-slate-800 dark:text-slate-100 whitespace-nowrap">{a.first_name} {a.last_name}</td>
                    <td className="px-4 py-2">
                      {a.source_kind && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold mr-1.5 ${KIND_BADGE[a.source_kind] || "bg-slate-100 text-slate-600"}`}>{a.source_kind}</span>}
                      <span className="text-slate-600 dark:text-slate-400">{a.source_label || "—"}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{TRIGGER_LABEL[a.trigger] || a.trigger}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(a.amount - a.paid_amount)}{Number(a.paid_amount) > 0 && Number(a.paid_amount) < Number(a.amount) ? <span className="text-xs text-slate-400 dark:text-slate-400"> of {money(a.amount)}</span> : null}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.status === "paid" ? "bg-emerald-100 text-emerald-800" : a.status === "waived" ? "bg-slate-200 text-slate-600" : "bg-rose-100 text-rose-700"}`}>{a.status}</span></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {a.status === "outstanding" && (
                        <>
                          <PermissionGate role={["admin", "manager", "loan_officer"]}>
                            <button onClick={() => pay(a)} className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold mr-3"><Coins size={14} /> Pay</button>
                          </PermissionGate>
                          <PermissionGate role={["admin", "manager"]}>
                            <button onClick={() => waive(a)} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 inline-flex items-center gap-1 text-sm font-semibold"><Ban size={14} /> Waive</button>
                          </PermissionGate>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
