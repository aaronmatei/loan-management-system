import React, { useState, useEffect } from "react";
import { MessageSquare, Send, RefreshCw, X, AlertTriangle, BellRing } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const fmt = (d) => (d ? new Date(d).toLocaleString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const TYPE = {
  welfare_broadcast: "Broadcast",
  welfare_contribution_due: "Contribution due",
  welfare_contribution_receipt: "Contribution receipt",
  welfare_penalty_notice: "Penalty notice",
  welfare_meeting_reminder: "Meeting reminder",
};

// Welfare SMS: broadcast to members, fire contribution-due reminders, and read
// the message log. Receipts/penalty notices flow in automatically.
export default function WelfareSmsPanel({ welfareId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/sms/logs`);
      setRows(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const remind = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/sms/contribution-reminders`, {});
      alert(`${r.data.sent} contribution reminder${r.data.sent === 1 ? "" : "s"} sent.`);
      load();
    } catch (e) {
      alert(e.response?.data?.error || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-indigo-100 mb-6 overflow-hidden">
      <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <MessageSquare size={18} className="text-indigo-600" /> SMS
        </h2>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </button>
          <PermissionGate role={["admin", "manager"]}>
            <button onClick={remind} disabled={busy} className="px-3 py-1.5 bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
              <BellRing size={14} /> Send due reminders
            </button>
            <button onClick={() => setShowSend(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
              <Send size={14} /> Broadcast
            </button>
          </PermissionGate>
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No messages yet. Broadcasts, reminders and receipts appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">To</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Message</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{fmt(t.created_at)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{t.phone_number}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{TYPE[t.message_type] || t.message_type}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={t.message}>{t.message}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.status === "sent" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSend && <BroadcastModal welfareId={welfareId} onClose={() => setShowSend(false)} onSent={() => { setShowSend(false); load(); }} />}
    </div>
  );
}

function BroadcastModal({ welfareId, onClose, onSent }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!message.trim()) return setError("Type a message.");
    setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/sms/broadcast`, { message: message.trim() });
      alert(`Sent to ${r.data.sent} of ${r.data.recipients} member(s).`);
      onSent();
    } catch (err) {
      setError(err.response?.data?.error || "Failed."); setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Broadcast to members</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <p className="text-xs text-slate-500 dark:text-slate-400">Goes to every active member with a phone number, prefixed with the chama name.</p>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={300} placeholder="e.g. Reminder: meeting this Saturday at 2pm." className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-indigo-500 focus:outline-none" autoFocus />
          <p className="text-xs text-slate-400 dark:text-slate-400 text-right">{message.length}/300</p>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700">{busy ? "Sending…" : "Send"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
