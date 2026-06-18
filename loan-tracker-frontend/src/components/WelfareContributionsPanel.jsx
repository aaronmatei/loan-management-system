import React, { useState, useEffect } from "react";
import { CalendarClock, Plus, X, Coins, Lock, AlertTriangle, ChevronRight, Smartphone, Repeat, ChevronLeft } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const FINE_TYPES = [
  { value: "", label: "No late fine" },
  { value: "fixed", label: "Flat amount (once)" },
  { value: "daily_fixed", label: "Flat amount per day late" },
  { value: "percentage", label: "% of the amount (once)" },
  { value: "daily_percentage", label: "% of the amount per day late" },
];

const money = (v) =>
  "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

// Welfare contribution cycles: open a period, collect per-member, and assess
// late penalties. Welfare accounts only.
export default function WelfareContributionsPanel({ welfareId }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState(null); // 'new' | 'plan' | null
  const [plan, setPlan] = useState(null);
  const [openCycle, setOpenCycle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/welfares/${welfareId}/cycles?year=${year}`);
      setCycles(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId, year]);
  useEffect(() => {
    api.get(`/welfares/${welfareId}/contribution-plan`).then((r) => setPlan(r.data.data)).catch(() => {});
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
            <button onClick={() => setCreator("new")} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <Plus size={15} /> New contribution
            </button>
          </div>
        </PermissionGate>
      </div>

      {plan && (
        <button onClick={() => setCreator("plan")} className="w-full text-left px-5 py-2 bg-sky-50/60 border-b border-sky-100 text-xs text-slate-600 hover:bg-sky-100/60">
          <Repeat size={12} className="inline mr-1 text-sky-600" /> Auto-opens monthly: <strong>{money(plan.amount)}</strong> due the {ordinal(plan.due_day)} · {fineSummary(plan)} <span className="text-sky-600 font-semibold">· edit</span>
        </button>
      )}
      <div className="px-5 pt-3 flex items-center gap-2 text-sm">
        <button onClick={() => setYear((y) => y - 1)} className="p-1 text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /></button>
        <span className="font-semibold text-slate-700 w-12 text-center">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} disabled={year >= new Date().getFullYear()} className="p-1 text-slate-500 hover:text-slate-800 disabled:opacity-30"><ChevronRight size={16} /></button>
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

      {creator && (
        <ContributionModal
          welfareId={welfareId}
          plan={plan}
          mode={creator}
          onClose={() => setCreator(null)}
          onSaved={(res) => { setCreator(null); if (res?.plan) setPlan(res.plan); load(); if (res?.cycle) setOpenCycle(res.cycle); }}
        />
      )}
      {openCycle && <SchedulesModal welfareId={welfareId} cycle={openCycle} onClose={() => setOpenCycle(null)} onChange={load} />}
    </div>
  );
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
function fineSummary(p) {
  if (!p?.fine_calc_type) return "no late fine";
  const grace = p.grace_days ? ` after ${p.grace_days}-day grace` : "";
  const t = p.fine_calc_type;
  if (t === "fixed") return `late fine ${money(p.fine_amount)}${grace}`;
  if (t === "daily_fixed") return `late fine ${money(p.fine_amount)}/day${grace}`;
  if (t === "percentage") return `late fine ${p.fine_rate}%${grace}`;
  if (t === "daily_percentage") return `late fine ${p.fine_rate}%/day${grace}`;
  return "late fine set";
}

const pill = (cls, text) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{text}</span>;
// Per-member timeliness for the cycle view: on time vs late (and by how many days).
function timeliness(s) {
  const late = Number(s.days_overdue || 0);
  if (s.status === "paid") {
    if (s.paid_on_time === true) return pill("bg-emerald-100 text-emerald-800", "On time");
    if (s.paid_on_time === false) return pill("bg-amber-100 text-amber-800", `Paid ${s.paid_late_days}d late`);
    return pill("bg-emerald-100 text-emerald-800", "Paid");
  }
  if (Number(s.amount_paid) > 0) return pill("bg-amber-100 text-amber-800", late > 0 ? `Partial · ${late}d late` : "Partial");
  return late > 0 ? pill("bg-red-100 text-red-700", `Late ${late}d`) : pill("bg-slate-100 text-slate-600", "Not yet due");
}

// One modal for creating a contribution. "Monthly" saves the recurring plan
// (auto-opens each month); "One-off" opens a single dated cycle. Both carry the
// late-fine rule. Opened from the plan banner ("plan" mode) it edits the plan.
function ContributionModal({ welfareId, plan, mode, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [recurring, setRecurring] = useState(mode === "plan" ? true : !plan ? true : true);
  const [form, setForm] = useState({
    name: "", amount: plan?.amount ?? "", due_day: plan?.due_day ?? 10, due_date: "",
    grace_days: plan?.grace_days ?? 0, fine_calc_type: plan?.fine_calc_type ?? "",
    fine_amount: plan?.fine_amount ?? "", fine_rate: plan?.fine_rate ?? "", fine_cap: plan?.fine_cap ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const usesAmount = ["fixed", "daily_fixed"].includes(form.fine_calc_type);
  const usesRate = ["percentage", "daily_percentage"].includes(form.fine_calc_type);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the contribution amount.");
    if (recurring) {
      const day = parseInt(form.due_day, 10);
      if (!(day >= 1 && day <= 28)) return setError("Due day must be between 1 and 28.");
    } else if (!form.due_date) return setError("Pick a due date.");
    if (usesAmount && !(parseFloat(form.fine_amount) > 0)) return setError("Enter the fine amount.");
    if (usesRate && !(parseFloat(form.fine_rate) > 0)) return setError("Enter the fine rate %.");
    setBusy(true);
    try {
      if (recurring) {
        const r = await api.put(`/welfares/${welfareId}/contribution-plan`, form);
        onSaved({ plan: r.data.data });
      } else {
        const r = await api.post(`/welfares/${welfareId}/cycles`, { ...form, name: form.name || undefined });
        onSaved({ cycle: r.data.data });
      }
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";
  const tab = (on) => `flex-1 py-2 text-sm font-semibold rounded-lg ${on ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`;

  return (
    <Shell title={mode === "plan" ? "Monthly contribution plan" : "New contribution"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        {mode !== "plan" && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setRecurring(true)} className={tab(recurring)}>Monthly (recurring)</button>
            <button type="button" onClick={() => setRecurring(false)} className={tab(!recurring)}>One-off</button>
          </div>
        )}
        {!recurring && <div><label className={lbl}>Name</label><input value={form.name} onChange={set("name")} placeholder="e.g. Building fund" className={fld} /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Amount per member *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} /></div>
          {recurring
            ? <div><label className={lbl}>Due day of month *</label><input type="number" min="1" max="28" value={form.due_day} onChange={set("due_day")} className={fld} /></div>
            : <div><label className={lbl}>Due date *</label><input type="date" min={today} value={form.due_date} onChange={set("due_date")} className={fld} /></div>}
        </div>
        <div className="border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-700 mb-2">Late fine</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={lbl}>Rule</label>
              <select value={form.fine_calc_type} onChange={set("fine_calc_type")} className={fld}>
                {FINE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {usesAmount && <div><label className={lbl}>Fine amount (KES)</label><input type="number" value={form.fine_amount} onChange={set("fine_amount")} className={fld} /></div>}
            {usesRate && <div><label className={lbl}>Fine rate (%)</label><input type="number" value={form.fine_rate} onChange={set("fine_rate")} className={fld} /></div>}
            {form.fine_calc_type && <div><label className={lbl}>Grace days</label><input type="number" min="0" value={form.grace_days} onChange={set("grace_days")} className={fld} /></div>}
            {form.fine_calc_type && <div><label className={lbl}>Cap (optional)</label><input type="number" value={form.fine_cap} onChange={set("fine_cap")} className={fld} /></div>}
          </div>
        </div>
        <p className="text-xs text-gray-500">
          {recurring
            ? `Opens automatically each month, due on the ${ordinal(parseInt(form.due_day, 10) || 10)}. A schedule is created for every active member.`
            : "A schedule is created for every active member."}
        </p>
        <Actions busy={busy} onClose={onClose} label={recurring ? "Save plan" : "Open contribution"} tone="bg-sky-600 hover:bg-sky-700" />
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
                <th className="text-left px-3 py-2">Timeliness</th>
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
                  <td className="px-3 py-2">{timeliness(s)}</td>
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
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  // M-Pesa pays the full outstanding (Daraja confirms the actual amount).
  const requestMpesa = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/mpesa/contribution`, { schedule_id: schedule.id, phone: phone || undefined });
      setNotice(r.data?.message || "STK push sent — the member should enter their M-Pesa PIN.");
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't start the M-Pesa request.");
    } finally { setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <Shell title={`Contribution — ${schedule.first_name} ${schedule.last_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">Outstanding: <strong>{money(outstanding)}</strong></p>
        {error && <Err msg={error} />}
        {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><Smartphone size={15} /> {notice}</div>}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Amount <span className="text-gray-500 font-normal">(blank = full)</span></label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(outstanding)} className={fld} autoFocus />
        </div>
        <Actions busy={busy} onClose={onClose} label="Record payment" tone="bg-emerald-600 hover:bg-emerald-700" />
      </form>

      <div className="mt-5 pt-4 border-t border-slate-100">
        <p className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-1.5"><Smartphone size={15} className="text-green-600" /> Or request via M-Pesa</p>
        <p className="text-xs text-slate-500 mb-2">Sends an STK prompt for the full outstanding to the member's phone.</p>
        <div className="flex gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (blank = member's number)" className={`${fld} flex-1`} />
          <button type="button" onClick={requestMpesa} disabled={busy} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50 whitespace-nowrap">STK push</button>
        </div>
      </div>
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
