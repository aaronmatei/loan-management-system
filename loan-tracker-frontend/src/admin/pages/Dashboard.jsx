import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import {
  Building2,
  TrendingUp,
  HandCoins,
  Wallet,
  Percent,
  PieChart,
  CheckCircle,
  Clock,
  ArrowUpRight,
  UserPlus,
} from "lucide-react";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { formatKES } from "../../utils/money";

const M = (v) => formatKES(v);

// Design KPI card: tinted icon circle + optional real delta + value + label.
const ACCENT = {
  ocean: "#0e8a6e",
  emerald: "#16a34a",
  indigo: "#5b6ef0",
  amber: "#d9892a",
  rose: "#e5484d",
  teal: "#0fb6c4",
};
function Kpi({ icon: Icon, accent = "ocean", value, label, delta }) {
  const c = ACCENT[accent] || ACCENT.ocean;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-[18px] shadow-sm">
      <div className="flex items-center justify-between">
        <span
          className="w-[38px] h-[38px] rounded-[11px] flex items-center justify-center"
          style={{ background: `${c}1c`, color: c }}
        >
          <Icon size={18} />
        </span>
        {delta && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
            <ArrowUpRight size={11} /> {delta}
          </span>
        )}
      </div>
      <div className="text-[25px] font-extrabold tracking-tight text-navy-900 dark:text-slate-100 mt-3.5 tabular-nums">
        {value}
      </div>
      <div className="text-[12.5px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function MiniStat({ icon: Icon, accent = "ocean", label, value }) {
  const c = ACCENT[accent] || ACCENT.ocean;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: c }} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      </div>
      <div className="text-[17px] font-extrabold text-navy-900 dark:text-slate-100 mt-1.5 tabular-nums">{value}</div>
    </div>
  );
}

// Status → pill colour.
const STATUS = {
  active: { c: "#16a34a", b: "#e4f5ec" },
  trial: { c: "#0e8a6e", b: "#e0f4ee" },
  suspended: { c: "#e5484d", b: "#fbe6e4" },
  cancelled: { c: "#8b8aa0", b: "#f0f0f7" },
};
function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.cancelled;
  return (
    <span
      className="inline-flex items-center text-[11.5px] font-bold px-2.5 py-1 rounded-lg capitalize"
      style={{ background: s.b, color: s.c }}
    >
      {status}
    </span>
  );
}

function PlatformDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platformApi
      .get("/platform/admin/dashboard")
      .then((r) => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8 max-w-[1240px] mx-auto space-y-3.5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </PlatformLayout>
    );
  }
  if (!data) return <PlatformLayout><div /></PlatformLayout>;

  const {
    tenants_overview: to,
    platform_metrics: pm,
    recent_signups,
    top_tenants,
    monthly_revenue = [],
  } = data;

  const paid = parseFloat(pm.total_revenue || 0);
  const expectedShare = parseFloat(pm.expected_share || 0);
  const pending = Math.max(0, expectedShare - paid);
  const maxRev = Math.max(...monthly_revenue.map((r) => r.revenue), 1);

  // Tenants-by-status breakdown (real; a plan breakdown lands with the catalog).
  const statusRows = [
    { label: "Active", n: to.active_tenants, color: "#16a34a" },
    { label: "Trial", n: to.trial_tenants, color: "#0e8a6e" },
    { label: "Suspended", n: to.suspended_tenants, color: "#e5484d" },
  ];
  const maxStatus = Math.max(...statusRows.map((r) => r.n), 1);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto space-y-3.5">
        {/* Headline KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Kpi
            icon={Building2}
            accent="indigo"
            value={to.active_tenants}
            label="Active tenants"
            delta={to.new_this_month > 0 ? `+${to.new_this_month}` : null}
          />
          <Kpi icon={TrendingUp} accent="emerald" value={M(pm.total_revenue)} label="Platform revenue" />
          <Kpi icon={HandCoins} accent="ocean" value={M(pm.total_disbursed)} label="Loans disbursed" />
          <Kpi icon={Wallet} accent="teal" value={M(pm.total_collected)} label="Collected" />
        </div>

        {/* Revenue by month + tenants by status */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5">
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100">Platform revenue</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium">Fees collected across all tenants · by month</div>
            {monthly_revenue.length === 0 ? (
              <EmptyState tone="muted" icon={TrendingUp} title="No revenue yet" description="Appears as tenants pay their invoices." />
            ) : (
              <div className="flex items-end gap-2.5 h-[150px] mt-5">
                {monthly_revenue.map((r, i) => (
                  <div key={r.month} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                    <div
                      className="w-full max-w-[30px] rounded-t-lg"
                      style={{
                        height: `${Math.max(4, (r.revenue / maxRev) * 100)}%`,
                        background: i === monthly_revenue.length - 1 ? "linear-gradient(180deg,#22b488,#0a5c4c)" : "#d7ece4",
                      }}
                      title={M(r.revenue)}
                    />
                    <span className="text-[10.5px] text-slate-400 font-semibold">{r.month?.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100">Tenants by status</div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium">{to.total_tenants} total</div>
            <div className="flex flex-col gap-4 mt-5">
              {statusRows.map((r) => (
                <div key={r.label}>
                  <div className="flex justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                      <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: r.color }} />
                      {r.label}
                    </span>
                    <span className="text-[13px] font-extrabold text-navy-900 dark:text-slate-100">{r.n}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.n / maxStatus) * 100}%`, background: r.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Financial detail */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MiniStat icon={Percent} accent="indigo" label="Contract interest" value={M(pm.total_contract_interest)} />
          <MiniStat icon={TrendingUp} accent="amber" label="Interest collected" value={M(pm.total_interest_collected)} />
          <MiniStat icon={PieChart} accent="ocean" label="Expected share" value={M(expectedShare)} />
          <MiniStat icon={CheckCircle} accent="emerald" label="Fees paid" value={M(paid)} />
          <MiniStat icon={Clock} accent="rose" label="Fees pending" value={M(pending)} />
        </div>

        {/* Top tenants */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100">Top tenants</div>
            <button onClick={() => navigate("/admin/tenants")} className="text-[12.5px] font-bold text-ocean-600">
              View all →
            </button>
          </div>
          <div className="grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 px-5 py-2.5 bg-slate-50/60 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <div>Tenant</div><div className="text-right">Clients</div><div className="text-right">Loans</div><div className="text-right">Portfolio</div><div className="text-right">Status</div>
          </div>
          {top_tenants.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/admin/tenants/${t.id}`)}
              className="w-full grid grid-cols-[2fr_1fr_1fr_1.2fr_1fr] gap-3 px-5 py-3 border-b border-slate-50 dark:border-slate-700 last:border-0 items-center text-left hover:bg-slate-50/60 dark:hover:bg-slate-700/40 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white font-bold text-sm shrink-0"
                  style={{ backgroundColor: t.brand_color || "#0e8a6e" }}
                >
                  {t.business_name?.charAt(0)}
                </span>
                <span className="font-bold text-navy-900 dark:text-slate-100 truncate">{t.business_name}</span>
              </div>
              <div className="text-right text-slate-600 dark:text-slate-300 tabular-nums">{t.client_count}</div>
              <div className="text-right text-slate-600 dark:text-slate-300 tabular-nums">{t.loan_count}</div>
              <div className="text-right font-extrabold text-navy-900 dark:text-slate-100 tabular-nums">{M(t.active_portfolio)}</div>
              <div className="text-right"><StatusPill status={t.status} /></div>
            </button>
          ))}
        </div>

        {/* Recent signups */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100 mb-3 flex items-center gap-2">
            <UserPlus size={18} className="text-ocean-600" /> Recent signups
          </div>
          {recent_signups.length === 0 ? (
            <EmptyState tone="muted" icon={UserPlus} title="No recent signups" description="New tenants show up here." />
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-700">
              {recent_signups.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/admin/tenants/${t.id}`)}
                  className="w-full flex justify-between items-center py-3 hover:bg-slate-50/60 dark:hover:bg-slate-700/40 rounded-lg px-2 -mx-2 text-left transition"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-navy-900 dark:text-slate-100 truncate">{t.business_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t.subdomain} · joined{" "}
                      {new Date(t.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right text-sm shrink-0">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{t.client_count} clients</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t.loan_count} loans</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </PlatformLayout>
  );
}

export default PlatformDashboard;
