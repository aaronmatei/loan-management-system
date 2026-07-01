import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { LifeBuoy } from "lucide-react";
import { StatusPill, PriorityPill, PriorityIcon } from "../components/SupportPills";
import { timeAgo } from "../../utils/timeAgo";

const TABS = [
  ["open", "Open"],
  ["pending", "Pending"],
  ["resolved", "Resolved"],
];

function Support() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("open");
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const loadCounts = () =>
    platformApi.get("/platform/support/summary").then((r) => setCounts(r.data.data || {})).catch(() => {});

  useEffect(() => {
    loadCounts();
  }, []);

  useEffect(() => {
    setLoading(true);
    platformApi
      .get(`/platform/support/tickets?status=${tab}`)
      .then((r) => setTickets(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto">
        <div className="flex gap-2 mb-4">
          {TABS.map(([v, label]) => {
            const on = tab === v;
            return (
              <button
                key={v}
                onClick={() => setTab(v)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] text-[13px] font-bold border transition"
                style={{
                  borderColor: on ? "#0e8a6e" : "#e3e7e0",
                  background: on ? "#e0f4ee" : "#fdfbf6",
                  color: on ? "#0a5c4c" : "#5b5b70",
                }}
              >
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
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="Nothing here" description={`No ${tab} tickets.`} />
        ) : (
          <div className="bg-surface rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
            {tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate(`/admin/support/${t.id}`)}
                className="w-full flex items-center gap-4 px-5 py-4 border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/40 text-left transition"
              >
                <PriorityIcon priority={t.priority} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-bold text-navy-900 dark:text-slate-100 truncate">{t.subject}</div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate">
                    <span className="font-mono">{t.code}</span> · {t.business_name} · {timeAgo(t.last_reply_at)}
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
    </PlatformLayout>
  );
}

export default Support;
