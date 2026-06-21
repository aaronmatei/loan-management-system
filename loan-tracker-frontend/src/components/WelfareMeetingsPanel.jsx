import React, { useState, useEffect } from "react";
import { CalendarDays, Plus, X, AlertTriangle, ChevronRight, Gift, Check } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const ATT = [
  { v: "present", label: "Present", cls: "bg-emerald-100 text-emerald-800" },
  { v: "late", label: "Late", cls: "bg-amber-100 text-amber-800" },
  { v: "excused", label: "Excused", cls: "bg-sky-100 text-sky-800" },
  { v: "absent", label: "Absent", cls: "bg-red-100 text-red-800" },
];
const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
// Client preview of the status the server will derive from arrival vs start+grace.
const deriveStatus = (arrival, apology, meeting) => {
  if (arrival) { const s = toMin(meeting.start_time); if (s == null) return "present"; return toMin(arrival) > s + (Number(meeting.grace_minutes) || 0) ? "late" : "present"; }
  return apology ? "excused" : "absent";
};

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
          <AttendanceOverview summary={summary} />
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
                    <td className="px-4 py-2 text-slate-700">{fmt(m.meeting_date)}{m.start_time ? ` · ${hhmm(m.start_time)}` : ""}</td>
                    <td className="px-4 py-2 text-slate-600">{m.location || "Home"}</td>
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

// Scalable attendance summary: headline stats + a distribution bar + the
// at-risk members surfaced, with the full per-member list behind a searchable,
// scrollable toggle (works whether the chama has 18 members or 1,000).
function AttendanceOverview({ summary }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const members = summary.members.map((m) => ({ ...m, rate: Number(m.rate) }));
  const held = Number(summary.held_meetings);
  const n = members.length;
  const avg = n ? Math.round(members.reduce((a, m) => a + m.rate, 0) / n) : 0;
  const perfect = members.filter((m) => m.rate >= 100).length;
  const atRisk = members.filter((m) => m.rate < 75).sort((a, b) => a.rate - b.rate);
  const buckets = [
    { label: "100%", cls: "bg-emerald-500", count: members.filter((m) => m.rate >= 100).length },
    { label: "75–99%", cls: "bg-lime-500", count: members.filter((m) => m.rate >= 75 && m.rate < 100).length },
    { label: "50–74%", cls: "bg-amber-500", count: members.filter((m) => m.rate >= 50 && m.rate < 75).length },
    { label: "<50%", cls: "bg-rose-500", count: members.filter((m) => m.rate < 50).length },
  ];
  const rateCls = (r) => (r >= 75 ? "text-emerald-700" : r >= 50 ? "text-amber-700" : "text-rose-600");
  const barCls = (r) => (r >= 100 ? "bg-emerald-500" : r >= 75 ? "bg-lime-500" : r >= 50 ? "bg-amber-500" : "bg-rose-500");
  const filtered = members
    .filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.rate - b.rate || a.first_name.localeCompare(b.first_name));

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Avg attendance" value={`${avg}%`} tone={rateCls(avg)} />
        <Stat label="Perfect (100%)" value={`${perfect}/${n}`} />
        <Stat label="Below 75%" value={atRisk.length} tone={atRisk.length ? "text-rose-600" : "text-slate-800"} />
        <Stat label="Meetings held" value={held} />
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 mb-1.5">
        {buckets.map((b) => b.count > 0 && <div key={b.label} className={b.cls} style={{ width: `${(b.count / n) * 100}%` }} title={`${b.label}: ${b.count}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {buckets.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${b.cls}`} /> {b.label} <strong className="text-slate-700">{b.count}</strong></span>
        ))}
      </div>

      {atRisk.length > 0 && !open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Needs attention:</span>
          {atRisk.slice(0, 6).map((m) => (
            <span key={m.member_id} className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5">{m.first_name} {m.last_name}: <strong className="text-rose-600">{m.rate}%</strong></span>
          ))}
          {atRisk.length > 6 && <span className="text-slate-400">+{atRisk.length - 6} more</span>}
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
        {open ? "Hide" : "View"} attendance by member
      </button>
      {open && (
        <div className="mt-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="w-full sm:w-64 mb-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:border-indigo-400 focus:outline-none" />
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {filtered.map((m) => (
              <div key={m.member_id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="flex-1 truncate text-slate-700">{m.first_name} {m.last_name}</span>
                <span className="text-xs text-slate-400 tabular-nums">{m.attended}/{held}</span>
                <div className="hidden sm:block w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className={`h-full ${barCls(m.rate)}`} style={{ width: `${m.rate}%` }} /></div>
                <strong className={`w-10 text-right tabular-nums ${rateCls(m.rate)}`}>{m.rate}%</strong>
              </div>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No members match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value, tone = "text-slate-800" }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function NewMeetingModal({ welfareId, onClose, onCreated }) {
  const [form, setForm] = useState({ title: "", meeting_date: new Date().toISOString().split("T")[0], start_time: "", grace_minutes: "", location: "", agenda: "", fine_late: "", fine_absent: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
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
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Start time</label><input type="time" value={form.start_time} onChange={set("start_time")} className={fld} /></div>
          <div><label className={lbl}>Grace (min)</label><input type="number" min="0" value={form.grace_minutes} onChange={set("grace_minutes")} placeholder="e.g. 15" className={fld} /></div>
        </div>
        <p className="-mt-2 text-xs text-slate-400">Members arriving after the start time + grace are marked late automatically.</p>
        <div><label className={lbl}>Location</label><input value={form.location} onChange={set("location")} className={fld} /></div>
        <div><label className={lbl}>Agenda</label><textarea value={form.agenda} onChange={set("agenda")} rows="2" className={fld} /></div>
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Attendance fines</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Late (KES)</label><input type="number" min="0" value={form.fine_late} onChange={set("fine_late")} placeholder="e.g. 500" className={fld} /></div>
            <div><label className={lbl}>Absent (KES)</label><input type="number" min="0" value={form.fine_absent} onChange={set("fine_absent")} placeholder="e.g. 1500" className={fld} /></div>
          </div>
          <p className="text-xs text-slate-400 mt-1">Charged automatically when you mark a member late or absent.</p>
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
      setRoster((r.data.data.roster || []).map((m) => ({ ...m, arrival_time: hhmm(m.arrival_time), apology: !!m.apology })));
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId, row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Setting an arrival time means they showed up, so an apology no longer applies.
  const setArrival = (memberId, arrival_time) => setRoster((r) => r.map((m) => (m.member_id === memberId ? { ...m, arrival_time, apology: arrival_time ? false : m.apology } : m)));
  const setApology = (memberId, apology) => setRoster((r) => r.map((m) => (m.member_id === memberId ? { ...m, apology } : m)));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.post(`/welfares/${welfareId}/meetings/${row.id}/attendance`, {
        records: roster.map((m) => ({ member_id: m.member_id, arrival_time: m.arrival_time || null, apology: !!m.apology })),
      });
      await load(); onSaved?.();
      setBusy(false);
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  const m = data?.meeting || row;
  const fmtD = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");
  const FT = { attendance_late: "Late", attendance_absent: "Absent", contribution_late: "Contribution late" };
  // Attendance is recorded ONCE: if any member already has a saved status, the
  // roster is locked (read-only) and there's no second Save.
  const recorded = roster.some((mem) => mem.attendance_status);

  return (
    <Shell title={m.title || "Meeting"} onClose={onClose} wide>
      {error && <div className="mb-3"><Err msg={error} /></div>}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 mb-4">
        <span><span className="text-slate-400">Date</span> {fmtD(m.meeting_date)}</span>
        {m.start_time && <span><span className="text-slate-400">Start</span> {hhmm(m.start_time)}{m.grace_minutes ? ` (+${m.grace_minutes}m grace)` : ""}</span>}
        <span><span className="text-slate-400">Location</span> {m.location || "Home"}</span>
        <span><span className="text-slate-400">Fines</span> {[m.fine_late > 0 ? `late ${money(m.fine_late)}` : null, m.fine_absent > 0 ? `absent ${money(m.fine_absent)}` : null].filter(Boolean).join(" · ") || "none"}</span>
      </div>
      {m.agenda && <p className="text-sm text-slate-600 mb-4 bg-slate-50 rounded-lg px-3 py-2">{m.agenda}</p>}

      {data?.payout && (
        <div className="mb-4 flex items-center gap-2 text-sm bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <Gift size={15} className="text-violet-600" /> Handed out <span className="font-semibold">{money(data.payout.amount)}</span> to {data.payout.first_name} {data.payout.last_name}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-700">Attendance</p>
        {recorded && <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1"><Check size={14} /> Recorded</span>}
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading roster…</p> : roster.length === 0 ? (
        <p className="text-sm text-slate-500">No active members.</p>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-2">Enter each member's arrival time. Anyone past {m.start_time ? `${hhmm(m.start_time)} + ${m.grace_minutes || 0} min grace` : "the start time"} is marked late; leave blank for a no-show, and tick <em>apology</em> to excuse them from the fine.</p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {roster.map((mem) => {
              const st = recorded ? mem.attendance_status : deriveStatus(mem.arrival_time, mem.apology, m);
              const badge = ATT.find((x) => x.v === st) || ATT[0];
              return (
                <div key={mem.member_id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-slate-800 truncate">{mem.first_name} {mem.last_name}</span>
                  {recorded ? (
                    <span className="text-xs text-slate-500 tabular-nums w-12 text-right">{hhmm(mem.arrival_time) || "—"}</span>
                  ) : (
                    <>
                      <input type="time" value={mem.arrival_time || ""} onChange={(e) => setArrival(mem.member_id, e.target.value)} className="px-2 py-1 border border-slate-200 rounded text-sm" />
                      <label className="text-xs text-slate-500 inline-flex items-center gap-1 select-none">
                        <input type="checkbox" checked={!!mem.apology} disabled={!!mem.arrival_time} onChange={(e) => setApology(mem.member_id, e.target.checked)} /> apology
                      </label>
                    </>
                  )}
                  <span className={`px-2 py-1 rounded text-xs font-semibold w-16 text-center shrink-0 ${badge.cls}`}>{badge.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <PermissionGate role={["admin", "manager", "loan_officer"]}>
        <div className="flex justify-end items-center gap-3 pt-3">
          {recorded ? (
            <span className="text-sm font-semibold text-emerald-700 inline-flex items-center gap-1.5"><Check size={16} /> Attendance recorded</span>
          ) : (
            <button onClick={save} disabled={busy || loading || roster.length === 0} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save attendance"}</button>
          )}
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
