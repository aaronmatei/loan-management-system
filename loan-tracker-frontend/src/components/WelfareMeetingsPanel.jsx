import React, { useState, useEffect } from "react";
import { CalendarDays, Plus, X, AlertTriangle, ChevronRight, Gift } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const ATT = [
  { v: "present", label: "Present", cls: "bg-emerald-100 text-emerald-800" },
  { v: "late", label: "Late", cls: "bg-amber-100 text-amber-800" },
  { v: "excused", label: "Excused", cls: "bg-sky-100 text-sky-800" },
  { v: "absent", label: "Absent", cls: "bg-red-100 text-red-800" },
];
const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const ruleLabel = (r) => `${r.calc_type === "fixed" ? `KES ${Number(r.amount).toLocaleString()}` : r.calc_type === "percentage" ? `${Number(r.rate)}%` : r.calc_type}${r.notes ? ` · ${r.notes}` : ""}`;

// Welfare meetings + member attendance. Absent/late statuses auto-apply the
// chama's attendance penalties.
export default function WelfareMeetingsPanel({ welfareId }) {
  const [meetings, setMeetings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [attend, setAttend] = useState(null);

  const load = async () => {
    try {
      const [m, s] = await Promise.all([
        api.get(`/welfares/${welfareId}/meetings`),
        api.get(`/welfares/${welfareId}/attendance-summary`),
      ]);
      setMeetings(m.data.data || []);
      setSummary(s.data.data || null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
  const STATUS = { scheduled: "bg-slate-100 text-slate-700", held: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-700" };

  return (
    <div className="bg-white rounded-xl shadow-md border border-indigo-100 mb-6 overflow-hidden">
      <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <CalendarDays size={18} className="text-indigo-600" /> Meetings &amp; Attendance
        </h2>
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
            <Plus size={15} /> Schedule
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {summary && summary.members.length > 0 && summary.held_meetings > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {summary.members.map((m) => (
              <span key={m.member_id} className="text-xs bg-slate-50 border border-slate-200 rounded-full px-3 py-1" title={`${m.attended}/${summary.held_meetings} meetings`}>
                {m.first_name} {m.last_name}: <strong className={m.rate >= 50 ? "text-emerald-700" : "text-red-600"}>{m.rate}%</strong>
              </span>
            ))}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="text-sm text-slate-500">No meetings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Location</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Present</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id} onClick={() => setAttend(m)} className="border-t border-slate-100 hover:bg-indigo-50/50 cursor-pointer">
                    <td className="px-4 py-2 font-semibold text-slate-800">{m.title || <span className="text-slate-400 font-normal">—</span>}</td>
                    <td className="px-4 py-2 text-slate-700">{fmt(m.meeting_date)}</td>
                    <td className="px-4 py-2 text-slate-600">{m.location || "—"}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[m.status] || STATUS.scheduled}`}>{m.status}</span></td>
                    <td className="px-4 py-2 text-right text-slate-700">{Number(m.present_count)}</td>
                    <td className="px-4 py-2 text-right text-indigo-500"><ChevronRight size={16} className="inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <NewMeetingModal welfareId={welfareId} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
      {attend && <AttendanceModal welfareId={welfareId} meeting={attend} onClose={() => setAttend(null)} onSaved={() => { setAttend(null); load(); }} />}
    </div>
  );
}

function NewMeetingModal({ welfareId, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", meeting_date: new Date().toISOString().split("T")[0], location: "", agenda: "", penalty_rule_id: "" });
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  useEffect(() => { api.get(`/welfares/${welfareId}/penalty-rules`).then((r) => setRules((r.data.data || []).filter((x) => x.trigger === "attendance_late" || x.trigger === "attendance_absent"))).catch(() => {}); }, [welfareId]);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.meeting_date) return setError("Pick a date.");
    setBusy(true);
    try { await api.post(`/welfares/${welfareId}/meetings`, form); onCreated(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";
  return (
    <Shell title="Schedule meeting" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div><label className={lbl}>Name</label><input value={form.title} onChange={set("title")} placeholder="e.g. Dowry hand-out — Jane" className={fld} /></div>
        <div><label className={lbl}>Date</label><input type="date" value={form.meeting_date} onChange={set("meeting_date")} className={fld} /></div>
        <div><label className={lbl}>Location</label><input value={form.location} onChange={set("location")} className={fld} /></div>
        <div><label className={lbl}>Agenda</label><textarea value={form.agenda} onChange={set("agenda")} rows="2" className={fld} /></div>
        <div>
          <label className={lbl}>Attendance fine</label>
          <select value={form.penalty_rule_id} onChange={set("penalty_rule_id")} className={fld}>
            <option value="">No fine</option>
            {rules.map((r) => <option key={r.id} value={r.id}>{ruleLabel(r)}</option>)}
          </select>
          <p className="text-xs text-slate-400 mt-1">Charged to late & absent members. Rules come from the <span className="font-semibold">Penalties</span> module.</p>
        </div>
        <Actions busy={busy} onClose={onClose} label="Schedule" />
      </form>
    </Shell>
  );
}

// A meeting's full detail: info + the attendance roster (markable) + the fines it
// raised + any pool payout handed out at it.
function AttendanceModal({ welfareId, meeting: row, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/meetings/${row.id}`);
      setData(r.data.data);
      setRoster((r.data.data.roster || []).map((m) => ({ ...m, status: m.attendance_status || "present" })));
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId, row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = (memberId, status) => setRoster((r) => r.map((m) => (m.member_id === memberId ? { ...m, status } : m)));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.post(`/welfares/${welfareId}/meetings/${row.id}/attendance`, { records: roster.map((m) => ({ member_id: m.member_id, status: m.status })) });
      await load(); onSaved?.();
      setBusy(false);
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  const m = data?.meeting || row;
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");
  const FT = { attendance_late: "Late", attendance_absent: "Absent", contribution_late: "Contribution late" };

  return (
    <Shell title={m.title || "Meeting"} onClose={onClose} wide>
      {error && <div className="mb-3"><Err msg={error} /></div>}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 mb-4">
        <span><span className="text-slate-400">Date</span> {fmtD(m.meeting_date)}</span>
        {m.location && <span><span className="text-slate-400">Location</span> {m.location}</span>}
        <span><span className="text-slate-400">Attendance fine</span> {m.rule ? ruleLabel(m.rule) : "none"}</span>
      </div>
      {m.agenda && <p className="text-sm text-slate-600 mb-4 bg-slate-50 rounded-lg px-3 py-2">{m.agenda}</p>}

      {data?.payout && (
        <div className="mb-4 flex items-center gap-2 text-sm bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <Gift size={15} className="text-violet-600" /> Handed out <span className="font-semibold">{money(data.payout.amount)}</span> to {data.payout.first_name} {data.payout.last_name}
        </div>
      )}

      <p className="text-sm font-semibold text-slate-700 mb-2">Attendance</p>
      {loading ? <p className="text-sm text-slate-500">Loading roster…</p> : roster.length === 0 ? (
        <p className="text-sm text-slate-500">No active members.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {roster.map((mem) => (
            <div key={mem.member_id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-800">{mem.first_name} {mem.last_name}</span>
              <div className="flex gap-1">
                {ATT.map((a) => (
                  <button key={a.v} type="button" onClick={() => setStatus(mem.member_id, a.v)}
                    className={`px-2 py-1 rounded text-xs font-semibold ${mem.status === a.v ? a.cls : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <PermissionGate role={["admin", "manager", "loan_officer"]}>
        <div className="flex justify-end gap-3 pt-3">
          <button onClick={save} disabled={busy || loading || roster.length === 0} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save attendance"}</button>
        </div>
      </PermissionGate>

      {data?.fines?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-700 mb-2">Fines from this meeting ({data.fines.length})</p>
          <div className="space-y-1">
            {data.fines.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{f.first_name} {f.last_name} <span className="text-xs text-slate-400">· {FT[f.trigger] || f.trigger}</span></span>
                <span className={`font-semibold ${f.status === "paid" ? "text-emerald-600" : "text-rose-600"}`}>{money(f.amount)}{f.status === "paid" ? " ✓" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
function Actions({ busy, onClose, label }) {
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
      <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : label}</button>
    </div>
  );
}
