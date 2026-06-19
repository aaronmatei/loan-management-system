import React, { useState, useEffect } from "react";
import { CalendarDays, Plus, X, ClipboardCheck, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const ATT = [
  { v: "present", label: "Present", cls: "bg-emerald-100 text-emerald-800" },
  { v: "late", label: "Late", cls: "bg-amber-100 text-amber-800" },
  { v: "excused", label: "Excused", cls: "bg-sky-100 text-sky-800" },
  { v: "absent", label: "Absent", cls: "bg-red-100 text-red-800" },
];

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
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-semibold text-slate-800">{m.title || <span className="text-slate-400 font-normal">—</span>}</td>
                    <td className="px-4 py-2 text-slate-700">{fmt(m.meeting_date)}</td>
                    <td className="px-4 py-2 text-slate-600">{m.location || "—"}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[m.status] || STATUS.scheduled}`}>{m.status}</span></td>
                    <td className="px-4 py-2 text-right text-slate-700">{Number(m.present_count)}</td>
                    <td className="px-4 py-2 text-right">
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button onClick={() => setAttend(m)} className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 text-sm font-semibold"><ClipboardCheck size={15} /> Attendance</button>
                      </PermissionGate>
                    </td>
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
  const [form, setForm] = useState({ title: "", meeting_date: new Date().toISOString().split("T")[0], location: "", agenda: "" });
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
        <div><label className={lbl}>Location</label><input value={form.location} onChange={set("location")} className={fld} /></div>
        <div><label className={lbl}>Agenda</label><textarea value={form.agenda} onChange={set("agenda")} rows="2" className={fld} /></div>
        <Actions busy={busy} onClose={onClose} label="Schedule" />
      </form>
    </Shell>
  );
}

function AttendanceModal({ welfareId, meeting, onClose, onSaved }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(`/welfares/${welfareId}/meetings/${meeting.id}`).then((r) => {
      setRoster((r.data.data.roster || []).map((m) => ({ ...m, status: m.attendance_status || "present" })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [welfareId, meeting.id]);

  const setStatus = (memberId, status) => setRoster((r) => r.map((m) => (m.member_id === memberId ? { ...m, status } : m)));

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/welfares/${welfareId}/meetings/${meeting.id}/attendance`, {
        records: roster.map((m) => ({ member_id: m.member_id, status: m.status })),
      });
      onSaved();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  return (
    <Shell title="Record attendance" onClose={onClose}>
      {error && <div className="mb-3"><Err msg={error} /></div>}
      <p className="text-xs text-slate-500 mb-3">Absent / late apply this chama's attendance penalties automatically.</p>
      {loading ? <p className="text-sm text-slate-500">Loading roster…</p> : roster.length === 0 ? (
        <p className="text-sm text-slate-500">No active members.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {roster.map((m) => (
            <div key={m.member_id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-800">{m.first_name} {m.last_name}</span>
              <div className="flex gap-1">
                {ATT.map((a) => (
                  <button key={a.v} type="button" onClick={() => setStatus(m.member_id, a.v)}
                    className={`px-2 py-1 rounded text-xs font-semibold ${m.status === a.v ? a.cls : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-3 pt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={busy || loading || roster.length === 0} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save attendance"}</button>
      </div>
    </Shell>
  );
}

function Shell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
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
