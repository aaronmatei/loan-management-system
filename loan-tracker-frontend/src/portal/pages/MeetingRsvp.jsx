// Public (no-login) meeting RSVP page. A member opens the shared link, enters
// their name + phone, and taps "I'll attend" / "Can't make it". The backend
// matches the phone to their chama membership and records the confirmation.
import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
const fld = "w-full px-3 py-2.5 border-2 border-slate-200 rounded-lg focus:border-emerald-500 focus:outline-none";

export default function MeetingRsvp() {
  const { meetingId, token } = useParams();
  const [meeting, setMeeting] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [form, setForm] = useState({ name: "", phone: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    axios.get(`${API}/public/meetings/${meetingId}/${token}`)
      .then((r) => setMeeting(r.data.data))
      .catch((e) => setLoadErr(e.response?.data?.error || "This link is invalid or has expired."));
  }, [meetingId, token]);

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
  const submit = async (attending) => {
    if (!form.phone.trim()) return setErr("Enter your phone number.");
    setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API}/public/meetings/${meetingId}/${token}/rsvp`, { name: form.name, phone: form.phone, attending });
      setDone(r.data.data);
    } catch (e) { setErr(e.response?.data?.error || "Failed to record your response."); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {loadErr ? (
          <p className="text-center text-rose-600 font-semibold py-6">{loadErr}</p>
        ) : !meeting ? (
          <p className="text-center text-slate-500 py-6">Loading…</p>
        ) : done ? (
          <div className="text-center space-y-2 py-4">
            <div className="text-5xl">{done.attending ? "✅" : "🗓️"}</div>
            <h2 className="text-xl font-bold text-slate-900">Thanks, {done.member_name}!</h2>
            <p className="text-slate-600">{done.attending ? "We've recorded that you'll attend." : "We've recorded that you can't make it."}</p>
            <p className="text-xs text-slate-400 pt-2">You can close this page.</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">{meeting.welfare_name}</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">{meeting.title || "Meeting"}</h1>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p>🗓️ {fmtDate(meeting.meeting_date)}{meeting.start_time ? ` at ${String(meeting.start_time).slice(0, 5)}` : ""}</p>
              {(meeting.venue || meeting.location) && <p>📍 {[meeting.venue, meeting.location].filter(Boolean).join(", ")}</p>}
            </div>
            {meeting.status !== "scheduled" ? (
              <p className="mt-4 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">This meeting is no longer open for confirmation.</p>
            ) : (
              <div className="mt-5 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Will you attend?</p>
                {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" className={fld} />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number (e.g. 0712 345678)" className={fld} />
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button disabled={busy} onClick={() => submit(true)} className="py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">I'll attend</button>
                  <button disabled={busy} onClick={() => submit(false)} className="py-3 rounded-lg bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold disabled:opacity-50">Can't make it</button>
                </div>
                <p className="text-xs text-slate-400 text-center">We match your phone number to your chama membership.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
