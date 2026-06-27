import React, { useState, useEffect } from "react";
import { CalendarDays, Plus, X, AlertTriangle, ChevronRight, Gift, Check, Pencil, Trash2, Link2, Copy } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const ATT = [
  { v: "present", label: "Present", cls: "bg-emerald-100 text-emerald-800" },
  { v: "late", label: "Late", cls: "bg-amber-100 text-amber-800" },
  { v: "excused", label: "Excused", cls: "bg-sky-100 text-sky-800" },
  { v: "absent", label: "Absent", cls: "bg-red-100 text-red-800" },
];
// Usual meeting venues per town — one-tap fill on the schedule-meeting form.
const VENUE_PRESETS = [
  { town: "Kitengela", venue: "Doctors Plaza" },
  { town: "Utawala", venue: "Tawala Gardens" },
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
// `client`/`basePath`/`readOnly` let the member portal reuse this whole view
// read-only (members are equal owners). Admin keeps the defaults.
export default function WelfareMeetingsPanel({ welfareId, client = api, readOnly = false, basePath = `/welfares/${welfareId}`, memberConfirm = false }) {
  const [meetings, setMeetings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [attend, setAttend] = useState(null);
  const [acting, setActing] = useState(null);

  const load = async () => {
    try {
      const [m, s] = await Promise.all([
        client.get(`${basePath}/meetings`),
        client.get(`${basePath}/attendance-summary`),
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
  }, [basePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
  const STATUS = { scheduled: "bg-slate-100 text-slate-700", held: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-700", suspended: "bg-rose-100 text-rose-700" };

  // Member RSVPs for a scheduled meeting; admin suspends one whose quorum
  // (50% + 1 of active non-exempt members) wasn't confirmed.
  const rsvp = async (meetingId, attending) => {
    setActing(meetingId);
    try { await client.post(`${basePath}/meetings/${meetingId}/confirm`, { attending }); await load(); }
    catch (e) { alert(e.response?.data?.error || "Failed to save your confirmation."); }
    finally { setActing(null); }
  };
  const suspend = async (meetingId) => {
    if (!window.confirm("Suspend this meeting because quorum wasn't confirmed? Members will see it as suspended — then schedule a new one.")) return;
    setActing(meetingId);
    try { await client.post(`${basePath}/meetings/${meetingId}/suspend`, { reason: "Quorum not met" }); await load(); }
    catch (e) { alert(e.response?.data?.error || "Failed to suspend meeting."); }
    finally { setActing(null); }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-indigo-100 mb-6 overflow-hidden">
      <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <CalendarDays size={18} className="text-indigo-600" /> Meetings &amp; Attendance
        </h2>
        {!readOnly && (
          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <Plus size={15} /> Schedule
            </button>
          </PermissionGate>
        )}
      </div>

      <div className="p-5">
        {summary && summary.members.length > 0 && summary.held_meetings > 0 && (
          <AttendanceOverview summary={summary} />
        )}
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No meetings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Venue</th>
                  <th className="text-left px-4 py-2">Location</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Confirmations</th>
                  <th className="text-right px-4 py-2">Present</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id} onClick={() => setAttend(m)} className="border-t border-slate-100 dark:border-slate-700 hover:bg-indigo-50/50 cursor-pointer">
                    <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{m.title || <span className="text-slate-400 dark:text-slate-400 font-normal">—</span>}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{fmt(m.meeting_date)}{m.start_time ? ` · ${hhmm(m.start_time)}` : ""}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.venue || "—"}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.location || "—"}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[m.status] || STATUS.scheduled}`}>{m.status}</span></td>
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      {m.status === "scheduled" ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.quorum_met ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                            title={`Quorum needs ${m.quorum_needed} of ${m.quorum_base} members`}
                          >
                            {Number(m.confirmed_count)} confirmed{m.quorum_met ? " · quorum met" : ""}
                          </span>
                          {memberConfirm && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => rsvp(m.id, true)}
                                disabled={acting === m.id || m.my_confirmation === true}
                                className={`px-2 py-0.5 rounded-md text-xs font-semibold border transition disabled:cursor-not-allowed ${m.my_confirmation === true ? "bg-emerald-600 text-white border-emerald-600" : "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"}`}
                              >
                                Attending
                              </button>
                              <button
                                onClick={() => rsvp(m.id, false)}
                                disabled={acting === m.id || m.my_confirmation === false}
                                className={`px-2 py-0.5 rounded-md text-xs font-semibold border transition disabled:cursor-not-allowed ${m.my_confirmation === false ? "bg-rose-600 text-white border-rose-600" : "bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/30 disabled:opacity-50"}`}
                              >
                                Can't make it
                              </button>
                            </div>
                          )}
                          {!readOnly && !m.quorum_met && (
                            <PermissionGate role={["admin", "manager", "loan_officer"]}>
                              <button
                                onClick={() => suspend(m.id)}
                                disabled={acting === m.id}
                                className="px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                              >
                                Suspend — no quorum
                              </button>
                            </PermissionGate>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-700 dark:text-slate-200">{Number(m.present_count)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {!readOnly && (
                        <PermissionGate role={["admin", "manager", "loan_officer"]}>
                          <button onClick={(e) => { e.stopPropagation(); setEditing(m); }} className="text-slate-400 dark:text-slate-400 hover:text-indigo-600 mr-2 align-middle" title="Edit meeting"><Pencil size={15} className="inline" /></button>
                        </PermissionGate>
                      )}
                      <ChevronRight size={16} className="inline text-indigo-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && !readOnly && <MeetingModal welfareId={welfareId} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {editing && !readOnly && <MeetingModal welfareId={welfareId} meeting={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {attend && <AttendanceModal client={client} basePath={basePath} readOnly={readOnly} welfareId={welfareId} meeting={attend} onClose={() => setAttend(null)} onSaved={() => { setAttend(null); load(); }} />}
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
    <div className="mb-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Avg attendance" value={`${avg}%`} tone={rateCls(avg)} />
        <Stat label="Perfect (100%)" value={`${perfect}/${n}`} />
        <Stat label="Below 75%" value={atRisk.length} tone={atRisk.length ? "text-rose-600" : "text-slate-800 dark:text-slate-100"} />
        <Stat label="Meetings held" value={held} />
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 mb-1.5">
        {buckets.map((b) => b.count > 0 && <div key={b.label} className={b.cls} style={{ width: `${(b.count / n) * 100}%` }} title={`${b.label}: ${b.count}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {buckets.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${b.cls}`} /> {b.label} <strong className="text-slate-700 dark:text-slate-200">{b.count}</strong></span>
        ))}
      </div>

      {atRisk.length > 0 && !open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 dark:text-slate-400">Needs attention:</span>
          {atRisk.slice(0, 6).map((m) => (
            <span key={m.member_id} className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5">{m.first_name} {m.last_name}: <strong className="text-rose-600">{m.rate}%</strong></span>
          ))}
          {atRisk.length > 6 && <span className="text-slate-400 dark:text-slate-400">+{atRisk.length - 6} more</span>}
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
        {open ? "Hide" : "View"} attendance by member
      </button>
      {open && (
        <div className="mt-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="w-full sm:w-64 mb-2 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-indigo-400 focus:outline-none" />
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            {filtered.map((m) => (
              <div key={m.member_id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{m.first_name} {m.last_name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-400 tabular-nums">{m.attended}/{held}</span>
                <div className="hidden sm:block w-24 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className={`h-full ${barCls(m.rate)}`} style={{ width: `${m.rate}%` }} /></div>
                <strong className={`w-10 text-right tabular-nums ${rateCls(m.rate)}`}>{m.rate}%</strong>
              </div>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-400">No members match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value, tone = "text-slate-800 dark:text-slate-100" }) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

const toDateInput = (d) => { if (!d) return ""; const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

function MeetingModal({ welfareId, meeting, onClose, onSaved }) {
  const editing = !!meeting;
  const [form, setForm] = useState(
    editing
      ? { title: meeting.title || "", meeting_date: toDateInput(meeting.meeting_date), start_time: hhmm(meeting.start_time), grace_minutes: meeting.grace_minutes ?? "", location: meeting.location || "", venue: meeting.venue || "", fine_late: meeting.fine_late ?? "", fine_absent: meeting.fine_absent ?? "" }
      : { title: "", meeting_date: new Date().toISOString().split("T")[0], start_time: "", grace_minutes: "", location: "", venue: "", fine_late: "", fine_absent: "" },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.meeting_date) return setError("Pick a date.");
    setBusy(true);
    try {
      if (editing) await api.put(`/welfares/${welfareId}/meetings/${meeting.id}`, form);
      else await api.post(`/welfares/${welfareId}/meetings`, form);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-indigo-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";
  return (
    <Shell title={editing ? "Edit meeting" : "Schedule meeting"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div><label className={lbl}>Name</label><input value={form.title} onChange={set("title")} placeholder="e.g. Dowry hand-out — Jane" className={fld} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Location</label><input value={form.location} onChange={set("location")} placeholder="Town / area (e.g. Kitengela)" className={fld} /></div>
          <div><label className={lbl}>Venue</label><input value={form.venue} onChange={set("venue")} placeholder="Place (e.g. Doctors Plaza)" className={fld} /></div>
        </div>
        {/* Quick-pick: fills both the town (Location) and its usual Venue. */}
        <div className="-mt-2 flex flex-wrap gap-2">
          {VENUE_PRESETS.map((p) => (
            <button
              key={p.town}
              type="button"
              onClick={() => setForm((f) => ({ ...f, location: p.town, venue: p.venue }))}
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hover:text-emerald-700 dark:hover:text-emerald-300 transition"
            >
              {p.town} · {p.venue}
            </button>
          ))}
        </div>
        <div><label className={lbl}>Date</label><input type="date" value={form.meeting_date} onChange={set("meeting_date")} className={fld} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Start time</label><input type="time" value={form.start_time} onChange={set("start_time")} className={fld} /></div>
          <div><label className={lbl}>Grace (min)</label><input type="number" min="0" value={form.grace_minutes} onChange={set("grace_minutes")} placeholder="e.g. 15" className={fld} /></div>
        </div>
        <p className="-mt-2 text-xs text-slate-400 dark:text-slate-400">Members arriving after the start time + grace are marked late automatically.</p>
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Attendance fines</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Late (KES)</label><input type="number" min="0" value={form.fine_late} onChange={set("fine_late")} placeholder="e.g. 500" className={fld} /></div>
            <div><label className={lbl}>Absent (KES)</label><input type="number" min="0" value={form.fine_absent} onChange={set("fine_absent")} placeholder="e.g. 1500" className={fld} /></div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">Charged automatically when you mark a member late or absent.</p>
        </div>
        <Actions busy={busy} onClose={onClose} label={editing ? "Save changes" : "Schedule"} />
      </form>
    </Shell>
  );
}

// A meeting's agenda. The admin adds items directly (they're the official,
// "approved" agenda). Members SUGGEST items, which sit in a pending list until
// the admin approves (→ agenda) or rejects (removed). A member may edit/withdraw
// only their own pending suggestion.
function AgendaSection({ client, basePath, meetingId, items, freeText, readOnly, myMemberId, onChange }) {
  const [adding, setAdding] = useState("");
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = !readOnly;
  const approved = items.filter((it) => it.status === "approved");
  const pending = items.filter((it) => it.status === "suggested");
  const canEdit = (it) => isAdmin || (it.status === "suggested" && myMemberId != null && it.suggested_by_member === myMemberId);
  // Free-text agenda (legacy) is only a fallback when there are no approved items.
  const freeBullets = (freeText || "").split(/\r?\n|\s+-\s+|;/).map((s) => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
  const lbl = "text-sm font-semibold text-slate-700 dark:text-slate-200";
  const fld = "flex-1 px-2 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm";
  const wrap = async (fn) => { setBusy(true); try { await fn(); await onChange(); } catch (e) { alert(e.response?.data?.error || "Failed."); } finally { setBusy(false); } };
  const add = () => adding.trim() && wrap(async () => { await client.post(`${basePath}/meetings/${meetingId}/agenda`, { content: adding.trim() }); setAdding(""); });
  const saveEdit = (id) => editText.trim() && wrap(async () => { await client.put(`${basePath}/meetings/${meetingId}/agenda/${id}`, { content: editText.trim() }); setEditId(null); });
  const del = (id) => window.confirm("Remove this agenda item?") && wrap(() => client.delete(`${basePath}/meetings/${meetingId}/agenda/${id}`));
  const approve = (id) => wrap(() => client.put(`${basePath}/meetings/${meetingId}/agenda/${id}`, { status: "approved" }));
  const reject = (id) => window.confirm("Reject this suggestion?") && wrap(() => client.delete(`${basePath}/meetings/${meetingId}/agenda/${id}`));

  const Editable = ({ it }) => editId === it.id ? (
    <span className="flex-1 flex gap-2">
      <input value={editText} onChange={(e) => setEditText(e.target.value)} className={fld} autoFocus />
      <button onClick={() => saveEdit(it.id)} disabled={busy} className="text-xs font-semibold text-emerald-700">Save</button>
      <button onClick={() => setEditId(null)} className="text-xs text-slate-400">Cancel</button>
    </span>
  ) : (
    <span className="flex-1 text-slate-800 dark:text-slate-100">{it.content} {it.author_name && <span className="text-xs text-slate-400 dark:text-slate-500">— {it.author_name}</span>}</span>
  );

  return (
    <div className="mb-4 border-t border-slate-100 dark:border-slate-700 pt-3">
      <p className={`${lbl} mb-2`}>Agenda</p>
      {/* Official agenda: approved items, else the legacy free-text bullets. */}
      {approved.length > 0 ? (
        <ol className="space-y-1.5">
          {approved.map((it, i) => (
            <li key={it.id} className="flex items-start gap-2 text-sm">
              <span className="text-slate-400 dark:text-slate-500 w-5 shrink-0">{i + 1}.</span>
              <Editable it={it} />
              {isAdmin && editId !== it.id && (
                <span className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditId(it.id); setEditText(it.content); }} title="Edit" className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>
                  <button onClick={() => del(it.id)} title="Remove" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : freeBullets.length > 0 ? (
        <ul className="list-disc pl-5 space-y-0.5 text-sm text-slate-700 dark:text-slate-200">
          {freeBullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-400">No agenda items yet.</p>
      )}

      {/* Admin adds straight to the agenda; members suggest. */}
      <div className="flex gap-2 mt-2">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={isAdmin ? "Add an agenda item" : "Suggest an agenda item"} className={fld} />
        <button onClick={add} disabled={busy || !adding.trim()} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50">{isAdmin ? "Add" : "Suggest"}</button>
      </div>

      {/* Pending member suggestions — admin approves/rejects; a member can edit/withdraw their own. */}
      {pending.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">Suggestions awaiting approval ({pending.length})</p>
          <ul className="space-y-1.5">
            {pending.map((it) => (
              <li key={it.id} className="flex items-start gap-2 text-sm">
                <span className="text-amber-400 shrink-0">•</span>
                <Editable it={it} />
                {editId !== it.id && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    {isAdmin && <button onClick={() => approve(it.id)} disabled={busy} title="Approve" className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"><Check size={14} /> approve</button>}
                    {isAdmin && <button onClick={() => reject(it.id)} title="Reject" className="inline-flex items-center gap-0.5 text-xs font-semibold text-rose-600 hover:text-rose-800"><X size={14} /> reject</button>}
                    {!isAdmin && canEdit(it) && <button onClick={() => { setEditId(it.id); setEditText(it.content); }} title="Edit" className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>}
                    {!isAdmin && canEdit(it) && <button onClick={() => del(it.id)} title="Withdraw" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Meeting minutes = welfare_documents linked to the meeting (category 'minutes').
// Admin uploads from the admin app; on the member portal only the secretary can.
function MinutesSection({ client, basePath, meetingId, minutes, readOnly, canUploadMinutes, onChange }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const canUpload = !readOnly || canUploadMinutes;
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "");
  const upload = async () => {
    if (!title.trim() || !file) { alert("Add a title and choose a file."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim()); fd.append("category", "minutes"); fd.append("meeting_id", String(meetingId)); fd.append("file", file);
      await client.post(`${basePath}/documents`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTitle(""); setFile(null); await onChange();
    } catch (e) { alert(e.response?.data?.error || "Failed to upload minutes."); } finally { setBusy(false); }
  };
  return (
    <div className="mb-4 border-t border-slate-100 dark:border-slate-700 pt-3">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Minutes{minutes.length ? ` (${minutes.length})` : ""}</p>
      {minutes.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-400 mb-1">No minutes uploaded yet.</p>}
      <div className="space-y-1">
        {minutes.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-700 dark:text-slate-200 truncate">{d.title} <span className="text-xs text-slate-400 dark:text-slate-500">· {d.uploaded_by_name || "—"} · {fmtDate(d.created_at)}</span></span>
            <a href={d.file_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-900 font-semibold text-sm shrink-0 ml-2">Open</a>
          </div>
        ))}
      </div>
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Minutes title" className="px-2 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm" />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs text-slate-600 dark:text-slate-400 file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-emerald-50 file:text-emerald-700 file:font-semibold" />
          <button onClick={upload} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Uploading…" : "Upload minutes"}</button>
        </div>
      )}
    </div>
  );
}

// A meeting's full detail: info + the attendance roster (markable) + the fines it
// raised + any pool payout handed out at it.
function AttendanceModal({ welfareId, meeting: row, onClose, onSaved, client = api, basePath = `/welfares/${welfareId}`, readOnly = false }) {
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(null); // { link, message } for sharing
  const [copied, setCopied] = useState("");
  const [attOpen, setAttOpen] = useState(true); // attendance section collapse
  const loadInvite = async () => {
    if (invite) { setInvite(null); return; } // toggle
    try { setInvite((await client.get(`${basePath}/meetings/${row.id}/invite`)).data.data); }
    catch (e) { alert(e.response?.data?.error || "Failed to build invite"); }
  };
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 2000); } catch { /* */ } };

  const load = async () => {
    try {
      const r = await client.get(`${basePath}/meetings/${row.id}`);
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
      await client.post(`${basePath}/meetings/${row.id}/attendance`, {
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
  // roster is locked (read-only) and there's no second Save. The member portal
  // (readOnly) is always view-only.
  const recorded = roster.some((mem) => mem.attendance_status);
  const editable = !readOnly && !recorded;
  // Members' RSVPs (confirmed attending / can't make it / no reply), so the admin
  // and members can see who said what before the meeting is held.
  const rsvp = roster.reduce((a, mem) => { if (mem.confirmed === true) a.yes++; else if (mem.confirmed === false) a.no++; else a.none++; return a; }, { yes: 0, no: 0, none: 0 });
  const rsvpChip = (c) => c === true
    ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shrink-0">Attending</span>
    : c === false
      ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 shrink-0">Can't make it</span>
      : <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-400 shrink-0">No reply</span>;

  return (
    <Shell title={m.title || "Meeting"} onClose={onClose} wide>
      {error && <div className="mb-3"><Err msg={error} /></div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
        {[
          { label: "Date", value: fmtD(m.meeting_date) },
          m.start_time && { label: "Start", value: `${hhmm(m.start_time)}${m.grace_minutes ? ` · +${m.grace_minutes}m grace` : ""}` },
          m.venue && { label: "Venue", value: m.venue },
          { label: "Location", value: m.location || "Home" },
          { label: "Fines", value: [m.fine_late > 0 ? `late ${money(m.fine_late)}` : null, m.fine_absent > 0 ? `absent ${money(m.fine_absent)}` : null].filter(Boolean).join(" · ") || "none" },
        ].filter(Boolean).map((t) => (
          <div key={t.label} className="bg-slate-50 dark:bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t.label}</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">{t.value}</p>
          </div>
        ))}
      </div>

      {/* Invite members — a copyable link + ready message to send via SMS / WhatsApp. */}
      {!readOnly && (
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <div className="mb-4">
            <button onClick={loadInvite} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
              <Link2 size={15} /> Invite members
            </button>
            {invite && (
              <div className="mt-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg p-3 space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">Share this with members via SMS or WhatsApp so they can log in and confirm attendance.</p>
                <div className="flex gap-2">
                  <input readOnly value={invite.link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 px-2 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-xs" />
                  <button onClick={() => copy(invite.link, "link")} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold"><Copy size={13} /> {copied === "link" ? "Copied!" : "Copy link"}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`https://wa.me/?text=${encodeURIComponent(invite.message)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Share on WhatsApp</a>
                  <button onClick={() => copy(invite.message, "msg")} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold"><Copy size={13} /> {copied === "msg" ? "Copied!" : "Copy message"}</button>
                </div>
              </div>
            )}
          </div>
        </PermissionGate>
      )}

      {data?.payout && (
        <div className="mb-4 flex items-center gap-2 text-sm bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
          <Gift size={15} className="text-violet-600" /> Handed out <span className="font-semibold">{money(data.payout.amount)}</span> to {data.payout.first_name} {data.payout.last_name}
        </div>
      )}
      {m.status === "scheduled" && data?.quorum && (
        <div className={`mb-4 text-sm rounded-lg px-3 py-2 border ${data.quorum.met ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-amber-50 border-amber-100 text-amber-800"}`}>
          <span className="font-semibold">{data.quorum.confirmed_count}/{data.quorum.needed}</span> members confirmed attendance
          {data.quorum.met ? " — quorum met ✓" : ` — quorum (50% + 1 of ${data.quorum.base}) not yet confirmed`}
        </div>
      )}

      {!loading && data && <AgendaSection client={client} basePath={basePath} meetingId={row.id} items={data.agenda || []} freeText={m.agenda} readOnly={readOnly} myMemberId={data.my_member_id} onChange={load} />}
      {!loading && data && <MinutesSection client={client} basePath={basePath} meetingId={row.id} minutes={data.minutes || []} readOnly={readOnly} canUploadMinutes={data.can_upload_minutes} onChange={load} />}

      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden mb-4">
        <button type="button" onClick={() => setAttOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-3.5 py-3 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100/70 dark:hover:bg-indigo-900/30 transition">
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <ChevronRight size={17} className={`transition-transform text-indigo-500 ${attOpen ? "rotate-90" : ""}`} />
            Attendance {roster.length > 0 && <span className="text-slate-400 dark:text-slate-500 font-normal">({roster.length})</span>}
          </span>
          <span className="flex items-center gap-2 text-xs">
            {!loading && roster.length > 0 && (
              <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
                <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{rsvp.yes}</span> in · <span className="text-rose-700 dark:text-rose-300 font-semibold">{rsvp.no}</span> out · {rsvp.none} no&nbsp;reply
              </span>
            )}
            {recorded && <span className="font-semibold text-emerald-700 inline-flex items-center gap-1"><Check size={13} /> Recorded</span>}
          </span>
        </button>
        {attOpen && (
          <div className="p-3.5">
            {!loading && roster.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                RSVP: <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{rsvp.yes} attending</span> · <span className="text-rose-700 dark:text-rose-300 font-semibold">{rsvp.no} can't make it</span> · <span className="font-semibold">{rsvp.none}</span> no reply
              </p>
            )}
            {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading roster…</p> : roster.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No active members.</p>
            ) : (
              <>
                {editable && <p className="text-xs text-slate-400 dark:text-slate-400 mb-2">Enter each member's arrival time. Anyone past {m.start_time ? `${hhmm(m.start_time)} + ${m.grace_minutes || 0} min grace` : "the start time"} is marked late; leave blank for a no-show, and tick <em>apology</em> to excuse them from the fine.</p>}
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {roster.map((mem) => {
                    const st = editable ? deriveStatus(mem.arrival_time, mem.apology, m) : mem.attendance_status;
                    const badge = ATT.find((x) => x.v === st) || { v: "none", label: "—", cls: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400" };
                    return (
                      <div key={mem.member_id} className="flex items-center gap-3">
                        <span className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{mem.first_name} {mem.last_name}</span>
                          {rsvpChip(mem.confirmed)}
                        </span>
                        {!editable ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums w-12 text-right">{hhmm(mem.arrival_time) || "—"}</span>
                        ) : (
                          <>
                            <input type="time" value={mem.arrival_time || ""} onChange={(e) => setArrival(mem.member_id, e.target.value)} className="px-2 py-1 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm" />
                            <label className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 select-none">
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
            {!readOnly && (
              <PermissionGate role={["admin", "manager", "loan_officer"]}>
                <div className="flex justify-end items-center gap-3 pt-3">
                  {recorded ? (
                    <span className="text-sm font-semibold text-emerald-700 inline-flex items-center gap-1.5"><Check size={16} /> Attendance recorded</span>
                  ) : (
                    <button onClick={save} disabled={busy || loading || roster.length === 0} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save attendance"}</button>
                  )}
                </div>
              </PermissionGate>
            )}
          </div>
        )}
      </div>

      {data?.fines?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Fines from this meeting ({data.fines.length})</p>
          <div className="space-y-1">
            {data.fines.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">{f.first_name} {f.last_name} <span className="text-xs text-slate-400 dark:text-slate-400">· {FT[f.trigger] || f.trigger}</span></span>
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
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-10`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700"><X size={20} /></button>
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
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
      <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : label}</button>
    </div>
  );
}
