import React, { useState, useEffect, useRef } from "react";
import api from "../services/api";
import Skeleton from "./Skeleton";
import EmptyState from "./EmptyState";
import { LifeBuoy, ArrowLeft, Send } from "lucide-react";
import { StatusPill, PriorityPill } from "../admin/components/SupportPills";
import { timeAgo } from "../utils/timeAgo";

// Tenant staff inbox for tickets raised BY this tenant's customers (borrowers /
// welfare members). Hits /api/support/inbox. Staff read, reply, and triage.
const TABS = [["open", "Open"], ["pending", "Pending"], ["resolved", "Resolved"]];
const STATUS_ACTIONS = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high"];

export default function StaffSupportInbox() {
  const [tab, setTab] = useState("open");
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | <id>
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadCounts = () => api.get("/support/inbox/summary").then((r) => setCounts(r.data.data || {})).catch(() => {});
  const loadList = () => {
    setLoading(true);
    api.get(`/support/inbox?status=${tab}`).then((r) => setTickets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { loadCounts(); }, []);
  useEffect(() => { if (view === "list") loadList(); /* eslint-disable-next-line */ }, [tab, view]);

  const open = (id) => {
    setView(id); setDetail(null);
    api.get(`/support/inbox/${id}`).then((r) => setDetail(r.data.data)).catch(() => {});
  };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages?.length]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/inbox/${view}/messages`, { body: reply.trim() });
      setReply("");
      const r = await api.get(`/support/inbox/${view}`);
      setDetail(r.data.data);
      loadCounts();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send");
    } finally { setSending(false); }
  };

  const setField = async (patch) => {
    try {
      const r = await api.put(`/support/inbox/${view}`, patch);
      setDetail((d) => ({ ...d, ...r.data.data, messages: d.messages }));
      loadCounts();
    } catch (err) { alert(err.response?.data?.error || "Failed to update"); }
  };

  const who = (t) => `${t.first_name || ""} ${t.last_name || ""}`.trim() || t.created_by_name || "Customer";

  // ── Thread ──
  if (view !== "list") {
    return (
      <div className="space-y-3.5">
        <button onClick={() => { setView("list"); }} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ocean-600">
          <ArrowLeft size={15} /> Inbox
        </button>
        {!detail ? <Skeleton className="h-64 w-full rounded-2xl" /> : (
          <>
            <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-extrabold text-navy-900 dark:text-slate-100">{detail.subject}</div>
                  <div className="text-[12.5px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{detail.code}</span> · {who(detail)}{detail.phone_number ? ` · ${detail.phone_number}` : ""}
                  </div>
                </div>
                <StatusPill status={detail.status} />
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-slate-50 dark:border-slate-700">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Status</span>
                  {STATUS_ACTIONS.map((s) => (
                    <button key={s} onClick={() => setField({ status: s })}
                      className={`px-2.5 py-1 rounded-lg text-[12px] font-bold capitalize ${detail.status === s ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Priority</span>
                  <select value={detail.priority} onChange={(e) => setField({ priority: e.target.value })}
                    className="text-[12px] font-bold capitalize bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 cursor-pointer focus:outline-none">
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
              {detail.messages.map((m) => {
                const staff = m.author_type === "tenant";
                return (
                  <div key={m.id} className={`flex ${staff ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${staff ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-navy-900 dark:text-slate-100"}`}>
                      <div className={`text-[11px] font-bold mb-1 ${staff ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
                        {staff ? (m.author_name || "Support") : who(detail)} · {timeAgo(m.created_at)}
                      </div>
                      <div className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.body}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            {detail.status !== "closed" && (
              <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Reply to the customer…"
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500/30 resize-y" />
                <div className="flex justify-end mt-2">
                  <button onClick={send} disabled={sending || !reply.trim()} className="inline-flex items-center gap-1.5 px-5 py-2 bg-ocean-gradient text-white font-bold rounded-lg text-sm disabled:opacity-50">
                    <Send size={14} /> {sending ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── List ──
  return (
    <div>
      <div className="flex gap-2 mb-4">
        {TABS.map(([v, label]) => {
          const on = tab === v;
          return (
            <button key={v} onClick={() => setTab(v)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] text-[13px] font-bold border transition"
              style={{ borderColor: on ? "#0e8a6e" : "#e3e7e0", background: on ? "#e0f4ee" : "#fff", color: on ? "#0a5c4c" : "#5b5b70" }}>
              {label}
              <span className="text-[11px] font-extrabold px-1.5 rounded-full" style={{ background: on ? "#0e8a6e" : "#f0f2ed", color: on ? "#fff" : "#8b8aa0" }}>
                {counts[v] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      {loading ? (
        <div className="bg-surface rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Nothing here" description={`No ${tab} customer tickets.`} />
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => open(t.id)}
              className="w-full flex items-center gap-4 px-5 py-4 border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/40 text-left transition">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold text-navy-900 dark:text-slate-100 truncate">{t.subject}</div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                  <span className="font-mono">{t.code}</span> · {who(t)} · {timeAgo(t.last_reply_at)}
                </div>
              </div>
              <PriorityPill priority={t.priority} />
              <StatusPill status={t.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
