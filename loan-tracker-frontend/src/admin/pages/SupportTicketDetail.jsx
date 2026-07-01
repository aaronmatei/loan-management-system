import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import Skeleton from "../../components/Skeleton";
import { ArrowLeft, Send } from "lucide-react";
import { StatusPill } from "../components/SupportPills";
import { timeAgo } from "../../utils/timeAgo";

const STATUS_ACTIONS = ["open", "pending", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high"];

function SupportTicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const load = () =>
    platformApi
      .get(`/platform/support/tickets/${id}`)
      .then((r) => setTicket(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ticket?.messages?.length]);

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await platformApi.post(`/platform/support/tickets/${id}/messages`, { body: reply.trim() });
      setReply("");
      await load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status) => {
    try {
      const r = await platformApi.put(`/platform/support/tickets/${id}`, { status });
      setTicket((t) => ({ ...t, ...r.data.data, messages: t.messages }));
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update");
    }
  };
  const setPriority = async (priority) => {
    try {
      const r = await platformApi.put(`/platform/support/tickets/${id}`, { priority });
      setTicket((t) => ({ ...t, ...r.data.data, messages: t.messages }));
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update");
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8 max-w-[900px] mx-auto space-y-3.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </PlatformLayout>
    );
  }
  if (!ticket) return <PlatformLayout><div /></PlatformLayout>;

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[900px] mx-auto space-y-3.5">
        <button onClick={() => navigate("/admin/support")} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ocean-600">
          <ArrowLeft size={15} /> Support
        </button>

        {/* Header + triage */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3 flex-wrap">
            <span className="w-10 h-10 rounded-[11px] flex items-center justify-center text-white font-bold shrink-0" style={{ background: ticket.brand_color || "#0e8a6e" }}>
              {ticket.business_name?.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[17px] font-extrabold text-navy-900 dark:text-slate-100">{ticket.subject}</div>
              <div className="text-[12.5px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">{ticket.code}</span> · {ticket.business_name}
                {ticket.created_by_name ? ` · opened by ${ticket.created_by_name}` : ""}
              </div>
            </div>
            <StatusPill status={ticket.status} />
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-slate-50 dark:border-slate-700">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Status</span>
              {STATUS_ACTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-bold capitalize ${ticket.status === s ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Priority</span>
              <select
                value={ticket.priority}
                onChange={(e) => setPriority(e.target.value)}
                className="text-[12px] font-bold capitalize bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Thread */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm space-y-3">
          {ticket.messages.map((m) => {
            const platform = m.author_type === "platform";
            return (
              <div key={m.id} className={`flex ${platform ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${platform ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-navy-900 dark:text-slate-100"}`}>
                  <div className={`text-[11px] font-bold mb-1 ${platform ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
                    {m.author_name || (platform ? "Platform support" : "Tenant")} · {timeAgo(m.created_at)}
                  </div>
                  <div className="text-[13.5px] whitespace-pre-wrap leading-relaxed">{m.body}</div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* Reply */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Write a reply to the tenant…"
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl dark:bg-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500/30 resize-y"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={send}
              disabled={sending || !reply.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-ocean-gradient text-white font-bold rounded-lg text-sm disabled:opacity-50"
            >
              <Send size={14} /> {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </PlatformLayout>
  );
}

export default SupportTicketDetail;
