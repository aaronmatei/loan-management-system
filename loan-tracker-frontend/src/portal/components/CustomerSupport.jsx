import React, { useState, useEffect, useRef } from "react";
import portalApi from "../services/portalApi";
import Skeleton from "../../components/Skeleton";
import { LifeBuoy, Plus, ArrowLeft, Send } from "lucide-react";
import { StatusPill, PriorityPill } from "../../admin/components/SupportPills";
import { timeAgo } from "../../utils/timeAgo";
import { CARD, INK, MUTED } from "../theme";

const PRIORITIES = ["low", "normal", "high"];

// Customer -> tenant support ticketing, shared by the borrower portal (raise to
// your lender) and the welfare member portal (raise to your welfare admin).
// `providerLabel` just tunes the wording. Talks to /api/portal/support.
export default function CustomerSupport({ providerLabel = "your provider", kind }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | new | <id>
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ subject: "", priority: "normal", body: "" });
  const [submitting, setSubmitting] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [providers, setProviders] = useState(null); // null=loading
  const [tenantId, setTenantId] = useState(null); // selected provider
  const endRef = useRef(null);

  // Which providers this customer can contact; auto-select if there's only one.
  useEffect(() => {
    portalApi
      .get(`/portal/support/providers${kind ? `?kind=${kind}` : ""}`)
      .then((r) => {
        const list = r.data.data || [];
        setProviders(list);
        if (list.length) setTenantId((prev) => prev ?? list[0].id);
      })
      .catch(() => setProviders([]));
  }, [kind]);

  const loadList = (tid = tenantId) => {
    if (!tid) { setLoading(false); return; }
    setLoading(true);
    portalApi.get(`/portal/support/tickets?tenant_id=${tid}`).then((r) => setTickets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { if (tenantId) loadList(tenantId); /* eslint-disable-next-line */ }, [tenantId]);

  const openTicket = (id) => {
    setView(id); setDetail(null);
    portalApi.get(`/portal/support/tickets/${id}`).then((r) => setDetail(r.data.data)).catch(() => {});
  };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages?.length]);

  const createTicket = async () => {
    if (!form.subject.trim() || !form.body.trim()) return alert("Add a subject and a message");
    if (!tenantId) return alert(`Choose ${providerLabel} first`);
    setSubmitting(true);
    try {
      const r = await portalApi.post("/portal/support/tickets", { ...form, tenant_id: tenantId });
      setForm({ subject: "", priority: "normal", body: "" });
      loadList();
      openTicket(r.data.data.id);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create request");
    } finally { setSubmitting(false); }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await portalApi.post(`/portal/support/tickets/${view}/messages`, { body: reply.trim() });
      setReply("");
      const r = await portalApi.get(`/portal/support/tickets/${view}`);
      setDetail(r.data.data);
      loadList();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send");
    } finally { setSending(false); }
  };

  // ── New request ──
  if (view === "new") {
    return (
      <div className="space-y-3.5">
        <button onClick={() => setView("list")} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#0d8f63]">
          <ArrowLeft size={15} /> Support
        </button>
        <div className={`${CARD} p-5 space-y-4`}>
          <div className={`text-[15px] font-extrabold ${INK}`}>New request to {providerLabel}</div>
          <div>
            <label className={`block text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-1`}>Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200}
              placeholder="What do you need help with?"
              className="w-full px-3 py-2 border border-[#ece6da] dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d8f63]/30" />
          </div>
          <div>
            <label className={`block text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-1`}>Priority</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="text-sm font-semibold capitalize bg-white dark:bg-slate-900 border border-[#ece6da] dark:border-slate-600 rounded-xl px-3 py-2 cursor-pointer focus:outline-none">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className={`block text-[11px] font-bold uppercase tracking-wide ${MUTED} mb-1`}>Message</label>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5}
              placeholder="Describe your issue or question."
              className="w-full px-3 py-2 border border-[#ece6da] dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d8f63]/30 resize-y" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setView("list")} className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Cancel</button>
            <button onClick={createTicket} disabled={submitting} className="px-5 py-2 bg-[#0d8f63] text-white font-bold rounded-lg text-sm disabled:opacity-50">
              {submitting ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Thread ──
  if (view !== "list") {
    return (
      <div className="space-y-3.5">
        <button onClick={() => { setView("list"); loadList(); }} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#0d8f63]">
          <ArrowLeft size={15} /> Support
        </button>
        {!detail ? <Skeleton className="h-64 w-full rounded-[18px]" /> : (
          <>
            <div className={`${CARD} p-5`}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className={`text-[16px] font-extrabold ${INK}`}>{detail.subject}</div>
                  <div className={`text-[12.5px] ${MUTED}`}><span className="font-mono">{detail.code}</span> · opened {timeAgo(detail.created_at)}</div>
                </div>
                <PriorityPill priority={detail.priority} />
                <StatusPill status={detail.status} />
              </div>
            </div>
            <div className={`${CARD} p-5 space-y-3`}>
              {detail.messages.map((m) => {
                const mine = m.author_type === "customer";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${mine ? "bg-[#0d8f63] text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100"}`}>
                      <div className={`text-[11px] font-bold mb-1 ${mine ? "text-white/80" : MUTED}`}>
                        {mine ? "You" : (m.author_name || providerLabel)} · {timeAgo(m.created_at)}
                      </div>
                      <div className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.body}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            {detail.status !== "closed" && (
              <div className={`${CARD} p-4`}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Add a reply…"
                  className="w-full px-3 py-2 border border-[#ece6da] dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0d8f63]/30 resize-y" />
                <div className="flex justify-end mt-2">
                  <button onClick={sendReply} disabled={sending || !reply.trim()} className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#0d8f63] text-white font-bold rounded-lg text-sm disabled:opacity-50">
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
  if (providers && providers.length === 0) {
    return (
      <div className={`${CARD} p-8 text-center ${MUTED}`}>
        <LifeBuoy size={26} className="text-[#0d8f63] mx-auto mb-2" />
        You're not linked to {providerLabel} yet, so there's no one to contact here.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={`text-[15px] font-extrabold ${INK} flex items-center gap-2`}>
          <LifeBuoy size={18} className="text-[#0d8f63]" /> Contact {providerLabel}
        </div>
        <div className="flex items-center gap-2">
          {providers && providers.length > 1 && (
            <select
              value={tenantId || ""}
              onChange={(e) => setTenantId(Number(e.target.value))}
              className="text-sm font-semibold bg-white dark:bg-slate-900 border border-[#ece6da] dark:border-slate-600 rounded-lg px-2.5 py-2 cursor-pointer focus:outline-none"
            >
              {providers.map((p) => <option key={p.id} value={p.id}>{p.business_name}</option>)}
            </select>
          )}
          <button onClick={() => setView("new")} disabled={!tenantId} className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0d8f63] text-white font-bold rounded-lg text-sm disabled:opacity-50">
            <Plus size={15} /> New request
          </button>
        </div>
      </div>
      {loading ? (
        <div className={`${CARD} p-4 space-y-3`}>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
      ) : tickets.length === 0 ? (
        <div className={`${CARD} p-8 text-center ${MUTED}`}>No requests yet. Tap “New request” to reach {providerLabel}.</div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          {tickets.map((t) => (
            <button key={t.id} onClick={() => openTicket(t.id)}
              className="w-full flex items-center gap-4 px-5 py-4 border-b border-[#f0ebe0] dark:border-slate-700 last:border-0 hover:bg-black/[0.02] text-left transition">
              <div className="flex-1 min-w-0">
                <div className={`text-[13.5px] font-bold ${INK} truncate`}>{t.subject}</div>
                <div className={`text-[12px] ${MUTED} truncate`}>
                  <span className="font-mono">{t.code}</span> · {timeAgo(t.last_reply_at)}{t.message_count > 1 ? ` · ${t.message_count} messages` : ""}
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
