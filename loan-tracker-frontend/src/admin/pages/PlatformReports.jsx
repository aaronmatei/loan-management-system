// Platform-admin analytics dashboard. Backed by /api/analytics/platform,
// which guards on req.user.is_platform_admin and aggregates KPIs +
// revenue trend + leaderboard in one round-trip. Demo and founding
// (LenderFest, id=1) tenants are excluded server-side so this view is
// always "real paying customers".

import React, { useState, useEffect } from "react";
import PlatformLayout from "../components/PlatformLayout";
import PeriodNavigator, {
  periodToRange,
  periodLabel,
  usePersistentPeriod,
} from "../../components/PeriodNavigator";
import platformApi from "../services/platformApi";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, Download, Banknote, Trophy, Building2, Clock, Wallet } from "lucide-react";
import Skeleton, { SkeletonText } from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { formatKES } from "../../utils/money";
import StatCard from "../components/StatCard";

const fmt = (n) => formatKES(n);
// Full figures (no K abbreviation) — e.g. 2,000,000, not 2.0K. Used by the
// KPI cards and the revenue-trend Y-axis.
const fmtK = (n) =>
  parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });

function PlatformReports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = usePersistentPeriod();
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.mode, period.value]);

  // Always scope to the picked period (month or year).
  const buildQuery = () => {
    const { from, to } = periodToRange(period);
    return `from=${from}&to=${to}`;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await platformApi.get(
        `/analytics/platform?${buildQuery()}`,
      );
      setData(res.data.data);
    } catch (err) {
      console.error("Failed to load platform analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  // Download the platform report as a PDF or Excel file.
  const download = async (format) => {
    setDownloading(format);
    try {
      const res = await platformApi.get(
        `/analytics/platform/export/${format}?${buildQuery()}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `platform-report-${period.value}.${
        format === "pdf" ? "pdf" : "xlsx"
      }`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download report");
    } finally {
      setDownloading("");
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8 max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-6">
            <div>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl shadow-md p-4">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-7 w-28 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="bg-surface rounded-xl shadow-md p-4 mb-4">
            <Skeleton className="h-5 w-56 mb-3" />
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </div>
          <div className="bg-surface rounded-xl shadow-md p-4">
            <Skeleton className="h-5 w-40 mb-3" />
            <SkeletonText lines={5} />
          </div>
        </div>
      </PlatformLayout>
    );
  }
  if (!data) return null;

  const { kpis, revenueTrend, leaderboard } = data;

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
              <BarChart3 size={28} className="text-gray-700 dark:text-slate-200" /> Platform Analytics
            </h1>
            <p className="text-gray-600 dark:text-slate-400 mt-1">
              Performance for {periodLabel(period)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PeriodNavigator value={period} onChange={setPeriod} />
            <button
              onClick={() => download("pdf")}
              disabled={!!downloading}
              className="px-3 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 bg-surface text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {downloading === "pdf" ? "…" : <span className="inline-flex items-center gap-1"><Download size={14} /> PDF</span>}
            </button>
            <button
              onClick={() => download("excel")}
              disabled={!!downloading}
              className="px-3 py-2 rounded-lg bg-ocean-gradient text-white text-sm font-semibold hover:shadow-lg disabled:opacity-50"
            >
              {downloading === "excel" ? "…" : <span className="inline-flex items-center gap-1"><Download size={14} /> Excel</span>}
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            accent="ocean"
            icon={Banknote}
            label="Total Revenue"
            value={fmt(kpis.revenue.total_revenue)}
            sub="all-time invoice receipts"
          />
          <StatCard
            accent="green"
            icon={Building2}
            label="Active Tenants"
            value={kpis.tenants.active_tenants}
            sub={`+${kpis.tenants.new_this_month} this month`}
          />
          <StatCard
            accent="amber"
            icon={Clock}
            label="Outstanding"
            value={fmt(kpis.revenue.outstanding)}
            sub="unpaid invoices"
          />
          <StatCard
            accent="violet"
            icon={Wallet}
            label="Platform Loans"
            value={kpis.platform_loans.total_loans}
            sub={`${fmt(kpis.platform_loans.total_disbursed)} disbursed`}
          />
        </div>

        {/* Revenue trend */}
        <div className="bg-surface rounded-xl shadow-md p-4 mb-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Banknote size={18} /> Revenue Trend (Platform Fees)</h3>
          {revenueTrend.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-gray-400 dark:text-slate-400">
              No invoice payments in this window
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#0a5c4c"
                  strokeWidth={3}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leaderboard */}
        <div className="bg-surface rounded-xl shadow-md p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Trophy size={18} /> Tenant Leaderboard</h3>
          {leaderboard.length === 0 ? (
            <EmptyState
              icon={Trophy}
              tone="muted"
              title="No paying tenants yet"
              description="Tenants appear here once they record loan activity in this period."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900">
                  <tr>
                    <th className="text-left p-2">#</th>
                    <th className="text-left p-2">Tenant</th>
                    <th className="text-right p-2">Loans</th>
                    <th className="text-right p-2">Disbursed</th>
                    <th className="text-right p-2">Total Collected</th>
                    <th className="text-right p-2">Contract Interest</th>
                    <th className="text-right p-2">Interest Collected</th>
                    <th className="text-right p-2">Fees Paid</th>
                    <th className="text-center p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((t, i) => (
                    <tr key={t.id} className="border-b hover:bg-gray-50 dark:hover:bg-slate-700">
                      <td className="p-2 font-bold text-gray-400 dark:text-slate-400">{i + 1}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs"
                            style={{
                              backgroundColor: t.brand_color || "#0e8a6e",
                            }}
                          >
                            {t.business_name.charAt(0)}
                          </div>
                          <span className="font-semibold">
                            {t.business_name}
                          </span>
                        </div>
                      </td>
                      <td className="text-right p-2">{t.loans}</td>
                      <td className="text-right p-2">{fmt(t.disbursed)}</td>
                      <td className="text-right p-2">{fmt(t.total_collected)}</td>
                      <td className="text-right p-2">
                        {fmt(t.contract_interest)}
                      </td>
                      <td className="text-right p-2 text-green-700">
                        {fmt(t.interest_collected)}
                      </td>
                      <td className="text-right p-2 font-bold text-green-600">
                        {fmt(t.fees_paid)}
                      </td>
                      <td className="text-center p-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            t.status === "active"
                              ? "bg-green-100 text-green-700"
                              : t.status === "suspended"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PlatformLayout>
  );
}

export default PlatformReports;
