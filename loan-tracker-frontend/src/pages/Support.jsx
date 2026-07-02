import React, { useState, useEffect, useRef } from "react";
import api from "../services/api";
import Skeleton from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { LifeBuoy, Plus, ArrowLeft, Send } from "lucide-react";
import { StatusPill, PriorityPill } from "../admin/components/SupportPills";
import { timeAgo } from "../utils/timeAgo";
import StaffSupportInbox from "../components/StaffSupportInbox";

const PRIORITIES = ["low", "normal", "high"];

export default function StaffSupport() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | new | <ticketId>
  const [mode, setMode] = useState("mine"); // mine (to LenderFest) | inbox (from customers)
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ subject: "", priority: "normal", body: "" });
  const [submitting, setSubmitting] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadList = () => {
    setLoading(true);
    api.get("/support/tickets").then((r) => setTickets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => {
    loadList();
  }, []);

  const openTicket = (id) => {
    setView(id);
    setDetail(null);
    api.get(`/support/tickets/${id}`).then((r) => setDetail(r.data.data)).catch(() => {});
  };
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages?.length]);

  const createTicket = async () => {
    if (!form.subject.trim() || !form.body.trim()) return alert("Add a subject and a message");
    setSubmitting(true);
    try {
      const r = await api.post("/support/tickets", form);
      setForm({ subject: "", priority: "normal", body: "" });
      loadList();
      openTicket(r.data.data.id);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${view}/messages`, { body: reply.trim() });
      setReply("");
      const r = await api.get(`/support/tickets/${view}`);
      setDetail(r.data.data);
      loadList();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  // ── New ticket ──
  if (view === "new") {
    return (
      <div className="p-4 lg:p-8 max-w-[720px] mx-auto space-y-3.5">
        <button onClick={() => setView("list")} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ocean-600">
          <ArrowLeft size={15} /> Support
        </button>
        <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="text-[15px] font-extrabold text-navy-900 dark:text-slate-100">New support ticket</div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Subject</label>
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              maxLength={200}
              placeholder="Short summary of the issue"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Priority</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="text-sm font-semibold capitalize bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Message</label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={5}
              placeholder="Describe what's happening, with any details that help us reproduce it."
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500/30 resize-y"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setView("list")} className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Cancel</button>
            <button onClick={createTicket} disabled={submitting} className="px-5 py-2 bg-ocean-gradient text-white font-bold rounded-lg text-sm disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit ticket"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Ticket thread ──
  if (view !== "list") {
    return (
      <div className="p-4 lg:p-8 max-w-[820px] mx-auto space-y-3.5">
        <button onClick={() => { setView("list"); loadList(); }} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ocean-600">
          <ArrowLeft size={15} /> Support
        </button>
        {!detail ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : (
          <>
            <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] font-extrabold text-navy-900 dark:text-slate-100">{detail.subject}</div>
                  <div className="text-[12.5px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{detail.code}</span> · opened {timeAgo(detail.created_at)}
                  </div>
                </div>
                <PriorityPill priority={detail.priority} />
                <StatusPill status={detail.status} />
              </div>
            </div>

            <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
              {detail.messages.map((m) => {
                const mine = m.author_type === "tenant";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${mine ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-navy-900 dark:text-slate-100"}`}>
                      <div className={`text-[11px] font-bold mb-1 ${mine ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
                        {m.author_type === "platform" ? "LenderFest support" : m.author_name || "You"} · {timeAgo(m.created_at)}
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
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder="Add a reply…"
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500/30 resize-y"
                />
                <div className="flex justify-end mt-2">
                  <button onClick={sendReply} disabled={sending || !reply.trim()} className="inline-flex items-center gap-1.5 px-5 py-2 bg-ocean-gradient text-white font-bold rounded-lg text-sm disabled:opacity-50">
                    <Send size={14} /> {sending ? "Sending…" : "Send"}
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
    <div className="p-4 lg:p-8 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900 dark:text-slate-100 flex items-center gap-2">
            <LifeBuoy size={24} className="text-ocean-600" /> Support
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {mode === "mine" ? "Raise and track tickets with the LenderFest team." : "Requests from your borrowers & welfare members."}
          </p>
        </div>
        {mode === "mine" && (
          <button onClick={() => setView("new")} className="inline-flex items-center gap-1.5 px-4 py-2 bg-ocean-gradient text-white font-bold rounded-lg text-sm">
            <Plus size={15} /> New ticket
          </button>
        )}
      </div>

      {/* Channel toggle: our tickets to the platform vs incoming customer tickets */}
      <div className="flex gap-1.5 mb-4">
        {[["mine", "My requests"], ["inbox", "Customer tickets"]].map(([v, label]) => {
          const on = mode === v;
          return (
            <button key={v} onClick={() => setMode(v)}
              className="px-3.5 py-2 rounded-[10px] text-[13px] font-bold border transition"
              style={{ borderColor: on ? "#0e8a6e" : "#e3e7e0", background: on ? "#e0f4ee" : "#fff", color: on ? "#0a5c4c" : "#5b5b70" }}>
              {label}
            </button>
          );
        })}
      </div>

      {mode === "inbox" ? (
        <StaffSupportInbox />
      ) : loading ? (
        <div className="bg-surface rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No tickets yet" description="Open a ticket and the LenderFest team will get back to you here." />
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => openTicket(t.id)}
              className="w-full flex items-center gap-4 px-5 py-4 border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/40 text-left transition"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold text-navy-900 dark:text-slate-100 truncate">{t.subject}</div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                  <span className="font-mono">{t.code}</span> · {timeAgo(t.last_reply_at)}
                  {t.message_count > 1 ? ` · ${t.message_count} messages` : ""}
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
