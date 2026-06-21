import React, { useEffect, useState } from "react";
import { Vote, Plus, Check, X, MinusCircle, Gavel } from "lucide-react";
import Spinner from "./Spinner";

// Shared governance-voting UI for the welfare admin app and the member portal.
// Admin opens/closes motions and watches tallies (staff don't vote); members
// propose + vote in the portal. Backend: routes/welfareDecisions.js (admin) and
// portal/member.js decisions. A motion passes when approvals reach the quorum.
const STATUS = {
  open: "bg-sky-100 text-sky-800",
  passed: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-600",
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : null);
// Static class strings (Tailwind can't see interpolated color names).
const VOTE_BTN = {
  approve: { Icon: Check, active: "bg-emerald-600 text-white border-emerald-600" },
  reject: { Icon: X, active: "bg-rose-600 text-white border-rose-600" },
  abstain: { Icon: MinusCircle, active: "bg-slate-500 text-white border-slate-500" },
};

export default function WelfareDecisionsPanel({ client, path, membersPath, admin = false }) {
  const [decisions, setDecisions] = useState([]);
  const [isOfficer, setIsOfficer] = useState(false);
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ type: "motion", title: "", description: "", quorum_percent: 50, closes_at: "", target_member_id: "", target_role: "chair" });
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const canElect = admin || isOfficer;

  const load = async () => {
    setLoading(true);
    try {
      const data = (await client.get(path)).data?.data;
      if (Array.isArray(data)) { setDecisions(data); setIsOfficer(false); setMyId(null); }
      else { setDecisions(data?.decisions || []); setIsOfficer(!!data?.is_officer); setMyId(data?.my_member_id ?? null); }
      setError("");
    } catch (e) { setError(e.response?.data?.error || "Failed to load decisions"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMembers = async () => {
    if (!membersPath || members.length) return;
    try {
      const data = (await client.get(membersPath)).data?.data;
      setMembers(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  };
  const setType = (type) => {
    setForm({ ...form, type });
    if (type === "election") loadMembers();
  };

  const propose = async (e) => {
    e.preventDefault();
    const election = form.type === "election";
    if (!election && !form.title.trim()) { alert("Give the motion a title."); return; }
    if (election && !form.target_member_id) { alert("Choose the member to elect."); return; }
    setBusy(true);
    try {
      const body = {
        title: form.title.trim() || undefined, description: form.description.trim() || undefined,
        quorum_percent: Number(form.quorum_percent) || 50, closes_at: form.closes_at || undefined,
      };
      if (election) { body.type = "election"; body.target_member_id = Number(form.target_member_id); body.target_role = form.target_role; }
      await client.post(path, body);
      setForm({ type: "motion", title: "", description: "", quorum_percent: 50, closes_at: "", target_member_id: "", target_role: "chair" });
      load();
    } catch (e2) { alert(e2.response?.data?.error || "Failed to open the decision"); }
    finally { setBusy(false); }
  };

  const act = async (id, action, body) => {
    try { await client.post(`${path}/${id}/${action}`, body || {}); load(); }
    catch (e) { alert(e.response?.data?.error || "Action failed"); }
  };
  const canManage = (d) => admin || isOfficer || d.opened_by_member === myId;
  const canVote = !admin; // staff have no member identity

  return (
    <div className="space-y-6 max-w-3xl">
      <form onSubmit={propose} className="bg-white rounded-xl shadow-md border border-slate-100 p-5">
        <h2 className="font-bold text-slate-900 mb-1 flex items-center gap-2"><Plus size={18} className="text-emerald-600" /> Propose a decision</h2>
        <p className="text-sm text-slate-500 mb-4">Put a decision to the group — a rule change, a purchase, or electing an officer. It passes when approvals reach the quorum.</p>
        {canElect && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mb-3 text-sm font-semibold">
            <button type="button" onClick={() => setType("motion")} className={`px-3 py-1.5 rounded-md ${form.type === "motion" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Motion</button>
            <button type="button" onClick={() => setType("election")} className={`px-3 py-1.5 rounded-md ${form.type === "election" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Officer election</button>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {form.type === "election" ? (
            <>
              <label className="text-sm text-slate-600 sm:col-span-1">Candidate
                <select value={form.target_member_id} onChange={(e) => setForm({ ...form, target_member_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200">
                  <option value="">Choose a member…</option>
                  {members.map((m) => {
                    const id = m.member_id ?? m.id;
                    const name = m.name || `${m.first_name || ""} ${m.last_name || ""}`.trim();
                    return <option key={id} value={id}>{name}</option>;
                  })}
                </select>
              </label>
              <label className="text-sm text-slate-600 sm:col-span-1">Role
                <select value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200">
                  <option value="chair">Chair</option>
                  <option value="treasurer">Treasurer</option>
                  <option value="secretary">Secretary</option>
                </select>
              </label>
            </>
          ) : (
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What are we deciding?" className="px-3 py-2 rounded-lg border border-slate-200 sm:col-span-2" />
          )}
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Details (optional)" rows={2} className="px-3 py-2 rounded-lg border border-slate-200 sm:col-span-2" />
          <label className="text-sm text-slate-600">Quorum %
            <input type="number" min={1} max={100} value={form.quorum_percent} onChange={(e) => setForm({ ...form, quorum_percent: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200" />
          </label>
          <label className="text-sm text-slate-600">Closes (optional)
            <input type="date" value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200" />
          </label>
        </div>
        <button type="submit" disabled={busy} className="mt-4 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 inline-flex items-center gap-2"><Gavel size={16} /> {busy ? "Opening…" : form.type === "election" ? "Open election" : "Open motion"}</button>
      </form>

      {loading ? <div className="p-8"><Spinner centered label="Loading decisions…" /></div>
        : error ? <p className="text-center text-rose-600">{error}</p>
        : decisions.length === 0 ? <p className="text-center text-slate-500 py-6">No decisions yet.</p>
        : decisions.map((d) => {
          const req = d.required_approvals || 1;
          const pct = Math.min(100, Math.round((d.tally.approve / req) * 100));
          return (
            <div key={d.id} className="bg-white rounded-xl shadow-md border border-slate-100 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Vote size={16} className="text-slate-400" /> {d.title}
                    {d.type === "election" && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 capitalize">election · {d.target_role}</span>}
                  </h3>
                  {d.description && <p className="text-sm text-slate-500 mt-1">{d.description}</p>}
                  <p className="text-xs text-slate-400 mt-1">by {d.opened_by_name || "—"}{d.closes_at ? ` · closes ${fmtDate(d.closes_at)}` : ""}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize shrink-0 ${STATUS[d.status] || "bg-slate-100 text-slate-600"}`}>{d.status}</span>
              </div>

              <div className="mt-3">
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-slate-500 mt-1">{d.tally.approve}/{req} approvals needed · {d.tally.reject} against · {d.tally.abstain} abstaining · {d.active_members} members</p>
              </div>

              {(canVote && d.status === "open") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {["approve", "reject", "abstain"].map((v) => {
                    const { Icon, active } = VOTE_BTN[v];
                    return (
                      <button key={v} onClick={() => act(d.id, "vote", { vote: v })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 border-2 capitalize ${d.my_vote === v ? active : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                        <Icon size={14} /> {v}
                      </button>
                    );
                  })}
                </div>
              )}

              {(d.status === "open" && canManage(d)) && (
                <div className="mt-3 flex gap-3 text-sm">
                  <button onClick={() => act(d.id, "close")} className="font-semibold text-slate-700 hover:text-slate-900">Close now</button>
                  <button onClick={() => act(d.id, "cancel")} className="font-semibold text-rose-600 hover:text-rose-800">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
