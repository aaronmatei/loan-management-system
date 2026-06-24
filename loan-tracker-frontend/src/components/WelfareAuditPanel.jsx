import React, { useState, useEffect, useCallback } from "react";
import { ScrollText, Search, ChevronLeft, ChevronRight } from "lucide-react";
import api from "../services/api";

const fmtDate = (d) =>
  new Date(d).toLocaleString("en-KE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const pretty = (a) => (a || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const sevCls = (s) =>
  s === "critical" || s === "error"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    : s === "warning"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";

// Read-only activity log for a welfare (its tenant's audit_logs). Who did what,
// to what, and when. Filter by action + free-text search; paginated.
export default function WelfareAuditPanel({ welfareId, client = api, basePath = `/welfares/${welfareId}` }) {
  const [rows, setRows] = useState([]);
  const [actions, setActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q) params.set("search", q);
      if (action) params.set("action", action);
      const r = await client.get(`${basePath}/audit?${params.toString()}`);
      setRows(r.data.data || []);
      setTotal(r.data.total || 0);
      if (r.data.actions) setActions(r.data.actions);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [basePath, page, q, action]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const applySearch = () => { setQ(search.trim()); setPage(1); };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-indigo-100 dark:border-slate-700 mb-6 overflow-hidden">
      <div className="bg-indigo-50 dark:bg-slate-900 px-5 py-3 border-b border-indigo-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ScrollText size={18} className="text-indigo-600" /> Audit log
          <span className="text-xs font-normal text-slate-400 dark:text-slate-400">{total.toLocaleString()} entries</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              onBlur={applySearch}
              placeholder="Search description, code, user…"
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-indigo-400 focus:outline-none w-56"
            />
          </div>
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1); }}
            className="py-1.5 px-2 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-indigo-400 focus:outline-none max-w-[12rem]"
          >
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}
          </select>
        </div>
      </div>

      <div className="p-0">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 p-5">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 p-5">No activity recorded{q || action ? " for this filter" : ""} yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2 whitespace-nowrap">When</th>
                  <th className="text-left px-4 py-2">Who</th>
                  <th className="text-left px-4 py-2">Action</th>
                  <th className="text-left px-4 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700 align-top">
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {r.user_name || r.user_email || "System"}
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${r.source === "member" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"}`}>{r.source === "member" ? "Member" : "Staff"}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${sevCls(r.severity)}`}>{pretty(r.action)}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {r.description || "—"}
                      {r.entity_code && <span className="text-xs text-slate-400 dark:text-slate-500"> · {r.entity_code}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-700 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1"><ChevronLeft size={15} /> Prev</button>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">Next <ChevronRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
