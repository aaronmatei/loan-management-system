import React, { useState, useEffect } from "react";
import { HeartHandshake, Plus, X, AlertTriangle, ChevronRight, Coins, ArrowDownToLine, RotateCcw, PiggyBank } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");
const STATUS = {
  open: "bg-slate-100 text-slate-700", collecting: "bg-amber-100 text-amber-800",
  disbursed: "bg-sky-100 text-sky-800", settled: "bg-emerald-100 text-emerald-800", closed: "bg-slate-200 text-slate-600",
};

// Welfare EVENTS: ad-hoc member payouts funded by the separate events pool.
export default function WelfareEventsPanel({ welfareId }) {
  const [events, setEvents] = useState([]);
  const [pool, setPool] = useState(0);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [open, setOpen] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/events`);
      setEvents(r.data.data.events || []);
      setPool(Number(r.data.data.pool_balance || 0));
    } catch { /* non-fatal */ } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    api.get(`/welfares/${welfareId}/members`).then((r) => setMembers((r.data.data || []).filter((m) => m.status === "active"))).catch(() => {});
  }, [welfareId]);

  return (
    <div className="bg-white rounded-xl shadow-md border border-sky-100 mb-6 overflow-hidden">
      <div className="bg-sky-50 px-5 py-3 border-b border-sky-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><HeartHandshake size={18} className="text-sky-600" /> Events</h2>
          <p className="text-xs text-slate-500 mt-0.5">Events pool: <strong className="text-emerald-700">{money(pool)}</strong></p>
        </div>
        <PermissionGate role={["admin", "manager"]}>
          <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
            <Plus size={15} /> New event
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : events.length === 0 ? (
          <p className="text-sm text-slate-500">No events yet. Create one to pay out to a member (sickness, bereavement, ceremony).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Event</th>
                  <th className="text-left px-4 py-2">Beneficiary</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="text-right px-4 py-2">Collected</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-sky-50/50 cursor-pointer" onClick={() => setOpen(e)}>
                    <td className="px-4 py-2 font-semibold text-slate-800">{e.title}</td>
                    <td className="px-4 py-2 text-slate-600">{e.beneficiary_first} {e.beneficiary_last}</td>
                    <td className="px-4 py-2 text-right">{money(e.amount)}</td>
                    <td className="px-4 py-2 text-right">{Number(e.to_collect) > 0 ? <>{money(e.collected)} <span className="text-slate-400">/ {money(e.to_collect)}</span></> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[e.status] || STATUS.open}`}>{e.status}</span></td>
                    <td className="px-4 py-2 text-right"><ChevronRight size={16} className="inline text-sky-400" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewEventModal welfareId={welfareId} members={members} onClose={() => setShowNew(false)} onCreated={(e) => { setShowNew(false); load(); setOpen(e); }} />}
      {open && <EventModal welfareId={welfareId} eventRow={open} poolBalance={pool} onClose={() => setOpen(null)} onChange={load} />}
    </div>
  );
}

function NewEventModal({ welfareId, members, onClose, onCreated }) {
  const [form, setForm] = useState({ beneficiary_member_id: "", amount: "", due_date: "", needed_by: "", title: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const today = new Date().toISOString().slice(0, 10);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.beneficiary_member_id) return setError("Pick the beneficiary.");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the amount needed.");
    if (form.needed_by && form.needed_by <= today) return setError("Date needed must be in the future.");
    if (form.due_date && form.due_date <= today) return setError("Collection deadline must be in the future.");
    if (form.due_date && form.needed_by && form.due_date > form.needed_by) return setError("Collection deadline can't be after the date needed.");
    setBusy(true);
    try { const r = await api.post(`/welfares/${welfareId}/events`, form); onCreated(r.data.data); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <Shell title="New event" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div>
          <label className={lbl}>Beneficiary *</label>
          <select value={form.beneficiary_member_id} onChange={set("beneficiary_member_id")} className={fld}>
            <option value="">Select a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.member_no})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Amount needed *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
          <div><label className={lbl}>Date needed</label><input type="date" min={today} value={form.needed_by} onChange={set("needed_by")} className={fld} /></div>
          <div><label className={lbl}>Collection deadline</label><input type="date" min={today} max={form.needed_by || undefined} value={form.due_date} onChange={set("due_date")} className={fld} /></div>
        </div>
        <div><label className={lbl}>Title</label><input value={form.title} onChange={set("title")} placeholder="e.g. John — hospital" className={fld} /></div>
        <div><label className={lbl}>Note</label><textarea value={form.description} onChange={set("description")} rows={2} className={fld} /></div>
        <Actions busy={busy} onClose={onClose} label="Create event" tone="bg-sky-600 hover:bg-sky-700" />
      </form>
    </Shell>
  );
}

function EventModal({ welfareId, eventRow, poolBalance, onClose, onChange }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dueDate, setDueDate] = useState("");

  const load = async () => {
    try { const r = await api.get(`/welfares/${welfareId}/events/${eventRow.id}`); setData(r.data.data); }
    catch { /* */ }
  };
  useEffect(() => { load(); }, [eventRow.id]);

  const act = async (fn) => {
    setError(""); setBusy(true);
    try { await fn(); await load(); onChange?.(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); }
    finally { setBusy(false); }
  };
  const base = `/welfares/${welfareId}/events/${eventRow.id}`;
  const ev = data?.event || eventRow;
  const N = Number(ev.amount);
  const pool = data ? Number(data.pool_balance) : poolBalance;
  const bridgeOutstanding = Number(ev.bridged_amount || 0) - Number(ev.bridge_repaid || 0);

  return (
    <Shell title={ev.title} onClose={onClose} wide>
      {error && <div className="mb-3"><Err msg={error} /></div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
        <Stat label="Amount" value={money(N)} />
        <Stat label="Events pool" value={money(pool)} tone="text-emerald-700" />
        <Stat label="Status" value={ev.status} />
        {bridgeOutstanding > 0.001 && <Stat label="Bridge owed" value={money(bridgeOutstanding)} tone="text-amber-700" />}
      </div>

      {ev.status === "open" && (
        <PermissionGate role={["admin", "manager"]}>
          <div className="bg-slate-50 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-slate-700 mb-1">Fund this event</p>
            <p className="text-xs text-slate-500 mb-3">Pool covers it → pay now. Otherwise collect equal shares from members, or bridge the shortfall from the savings pool.</p>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-500">Collection deadline</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="px-2 py-1 border-2 border-gray-200 rounded-lg text-sm" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy || pool < N} onClick={() => act(() => api.post(`${base}/fund`, { mode: "pool" }))} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40" title={pool < N ? "Events pool can't cover the amount" : ""}>
                Disburse from pool
              </button>
              <button disabled={busy} onClick={() => act(() => api.post(`${base}/fund`, { mode: "collect", due_date: dueDate || undefined }))} className="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-40">
                Collect shortfall
              </button>
              <button disabled={busy} onClick={() => act(() => api.post(`${base}/fund`, { mode: "bridge", due_date: dueDate || undefined }))} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-40">
                Bridge from savings
              </button>
            </div>
          </div>
        </PermissionGate>
      )}

      <PermissionGate role={["admin", "manager"]}>
        <div className="flex flex-wrap gap-2 mb-4">
          {ev.status === "collecting" && (
            <button disabled={busy || pool < N} onClick={() => act(() => api.post(`${base}/payout`, {}))} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-1.5" title={pool < N ? "Not fully collected yet" : ""}>
              <ArrowDownToLine size={15} /> Disburse to beneficiary
            </button>
          )}
          {bridgeOutstanding > 0.001 && (
            <button disabled={busy} onClick={() => act(() => api.post(`${base}/repay-bridge`, {}))} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
              <RotateCcw size={15} /> Repay savings bridge
            </button>
          )}
          {(data?.shares?.length > 0) && (
            <button disabled={busy} onClick={() => act(() => api.post(`/welfares/${welfareId}/events/assess-late`, {}))} className="px-3 py-2 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-sm font-semibold disabled:opacity-40">
              Assess late fines
            </button>
          )}
        </div>
      </PermissionGate>

      {data?.shares?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Member</th>
                <th className="text-right px-3 py-2">Share</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.shares.map((s) => {
                const outstanding = Number(s.amount_due) - Number(s.amount_paid);
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{s.first_name} {s.last_name}</td>
                    <td className="px-3 py-2 text-right">{money(s.amount_due)}</td>
                    <td className="px-3 py-2 text-right">{money(s.amount_paid)}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.status === "paid" ? "bg-emerald-100 text-emerald-800" : s.status === "overdue" ? "bg-red-100 text-red-700" : s.status === "partial" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{s.status}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {outstanding > 0.001 && (
                        <PermissionGate role={["admin", "manager"]}>
                          <button disabled={busy} onClick={() => act(() => api.post(`${base}/shares/${s.member_id}/pay`, {}))} className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold mr-3"><Coins size={14} /> Pay</button>
                          <button disabled={busy} onClick={() => { if (confirm(`Recover ${money(outstanding)} from ${s.first_name}'s savings?`)) act(() => api.post(`${base}/shares/${s.member_id}/recover`, {})); }} className="text-amber-700 hover:text-amber-900 inline-flex items-center gap-1 text-sm font-semibold"><PiggyBank size={14} /> Recover</button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

const Stat = ({ label, value, tone }) => (
  <div className="bg-slate-50 rounded-lg px-3 py-2">
    <p className="text-xs text-slate-500">{label}</p>
    <p className={`font-bold ${tone || "text-slate-800"} capitalize`}>{value}</p>
  </div>
);
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
