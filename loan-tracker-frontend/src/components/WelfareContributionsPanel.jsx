import React, { useState, useEffect } from "react";
import { CalendarClock, Plus, X, Coins, Lock, AlertTriangle, ChevronRight } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) =>
  "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

// Welfare contribution cycles: open a period, collect per-member, and assess
// late penalties. Welfare accounts only.
export default function WelfareContributionsPanel({ welfareId }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openCycle, setOpenCycle] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/cycles`);
      setCycles(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const assessLate = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/cycles/0/assess-late`, {});
      alert(`${r.data.assessed} new late-contribution penalt${r.data.assessed === 1 ? "y" : "ies"} assessed.`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || "Failed");
    } finally {
      setBusy(false);
    }
  };
  const close = async (c) => {
    if (!confirm(`Close ${c.name}?`)) return;
    try { await api.post(`/welfares/${welfareId}/cycles/${c.id}/close`, {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Failed"); }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-sky-100 mb-6 overflow-hidden">
      <div className="bg-sky-50 px-5 py-3 border-b border-sky-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <CalendarClock size={18} className="text-sky-600" /> Contributions
        </h2>
        <PermissionGate role={["admin", "manager"]}>
          <div className="flex gap-2">
            <button onClick={assessLate} disabled={busy} className="px-3 py-1.5 bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-semibold rounded-lg disabled:opacity-50">
              Assess late
            </button>
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <Plus size={15} /> New cycle
            </button>
          </div>
        </PermissionGate>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : cycles.length === 0 ? (
          <p className="text-sm text-slate-500">No contribution cycles yet. Open one to start collecting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Cycle</th>
                  <th className="text-left px-4 py-2">Due</th>
                  <th className="text-right px-4 py-2">Collected / Expected</th>
                  <th className="text-right px-4 py-2">Paid</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-sky-50/50 cursor-pointer" onClick={() => setOpenCycle(c)}>
                    <td className="px-4 py-2 font-semibold text-slate-800">{c.name}</td>
                    <td className="px-4 py-2 text-slate-600">{fmt(c.due_date)}</td>
                    <td className="px-4 py-2 text-right">{money(c.collected)} <span className="text-slate-400">/ {money(c.expected)}</span></td>
                    <td className="px-4 py-2 text-right">{c.paid_count}/{c.member_count}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {c.status === "open" && (
                        <PermissionGate role={["admin", "manager"]}>
                          <button onClick={(e) => { e.stopPropagation(); close(c); }} className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 text-sm font-semibold mr-3"><Lock size={13} /> Close</button>
                        </PermissionGate>
                      )}
                      <ChevronRight size={16} className="inline text-sky-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewCycleModal welfareId={welfareId} onClose={() => setShowNew(false)} onCreated={(c) => { setShowNew(false); load(); setOpenCycle(c); }} />}
      {openCycle && <SchedulesModal welfareId={welfareId} cycle={openCycle} onClose={() => setOpenCycle(null)} onChange={load} />}
    </div>
  );
}

function NewCycleModal({ welfareId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", amount: "", frequency: "monthly", due_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Default settings amount if not entered.
  useEffect(() => {
    api.get(`/welfares/${welfareId}/settings`).then((r) => {
      const s = r.data?.data;
      if (s) setForm((f) => ({ ...f, amount: f.amount || (s.contribution_amount ?? ""), frequency: s.contribution_frequency || "monthly" }));
    }).catch(() => {});
  }, [welfareId]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the contribution amount.");
    if (!form.due_date) return setError("Pick a due date.");
    setBusy(true);
    try { const r = await api.post(`/welfares/${welfareId}/cycles`, form); onCreated(r.data.data); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <Shell title="New contribution cycle" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div><label className={lbl}>Name</label><input value={form.name} onChange={set("name")} placeholder="e.g. July 2026" className={fld} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Amount per member *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
          <div><label className={lbl}>Due date *</label><input type="date" value={form.due_date} onChange={set("due_date")} className={fld} /></div>
        </div>
        <div>
          <label className={lbl}>Frequency</label>
          <select value={form.frequency} onChange={set("frequency")} className={fld}>
            <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option>
          </select>
        </div>
        <p className="text-xs text-gray-500">A schedule is created for every active member.</p>
        <Actions busy={busy} onClose={onClose} label="Open cycle" tone="bg-sky-600 hover:bg-sky-700" />
      </form>
    </Shell>
  );
}

function SchedulesModal({ welfareId, cycle, onClose, onChange }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payFor, setPayFor] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/cycles/${cycle.id}`);
      setSchedules(r.data.data.schedules || []);
    } catch {/* */} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [cycle.id]);

  const STATUS = { paid: "bg-emerald-100 text-emerald-800", partial: "bg-amber-100 text-amber-800", overdue: "bg-red-100 text-red-700", pending: "bg-slate-100 text-slate-700" };

  return (
    <Shell title={`${cycle.name} — ${fmt(cycle.due_date)}`} onClose={onClose} wide>
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Member</th>
                <th className="text-right px-3 py-2">Due</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-800">{s.first_name} {s.last_name}</td>
                  <td className="px-3 py-2 text-right">{money(s.amount_due)}</td>
                  <td className="px-3 py-2 text-right">{money(s.amount_paid)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[s.status] || STATUS.pending}`}>{s.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {s.status !== "paid" && (
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button onClick={() => setPayFor(s)} className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold"><Coins size={14} /> Pay</button>
                      </PermissionGate>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payFor && (
        <PayModal welfareId={welfareId} cycle={cycle} schedule={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); onChange?.(); }} />
      )}
    </Shell>
  );
}

function PayModal({ welfareId, cycle, schedule, onClose, onDone }) {
  const outstanding = Number(schedule.amount_due) - Number(schedule.amount_paid);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = amount === "" ? outstanding : parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (amt > outstanding) return setError(`Max ${money(outstanding)}.`);
    setBusy(true);
    try { await api.post(`/welfares/${welfareId}/cycles/${cycle.id}/schedules/${schedule.id}/pay`, { amount: amt }); onDone(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <Shell title={`Contribution — ${schedule.first_name} ${schedule.last_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">Outstanding: <strong>{money(outstanding)}</strong></p>
        {error && <Err msg={error} />}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Amount <span className="text-gray-500 font-normal">(blank = full)</span></label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(outstanding)} className={fld} autoFocus />
        </div>
        <Actions busy={busy} onClose={onClose} label="Record payment" tone="bg-emerald-600 hover:bg-emerald-700" />
      </form>
    </Shell>
  );
}

function Shell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-10`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
const Err = ({ msg }) => (
  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {msg}</div>
);
function Actions({ busy, onClose, label, tone }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${tone}`}>{busy ? "Saving…" : label}</button>
    </div>
  );
}
