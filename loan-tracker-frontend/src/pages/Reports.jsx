// Reports & Analytics — the visual dashboard. Pairs with the
// Exports page (Excel bulk downloads at /exports) which serves the
// older row-export tiles. This page bundles charts + KPIs and offers
// PDF / Excel exports of the portfolio summary itself.
//
// Data comes from /api/analytics/tenant (one round-trip aggregate
// powered by services/analyticsService.js). The per-chart endpoints
// in routes/analytics.js still serve pages/Analytics.jsx separately.

import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Coins,
  TrendingUp,
  Clock,
  FileText,
  Users,
  AlertTriangle,
  XCircle,
  Wallet,
  Gavel,
} from "lucide-react";
import api from "../services/api";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
// Compact form ("12.5K", "1.2M") for chart Y-axis ticks only — long
// shilling figures crowd the gridlines. KPI cards use the full fmt above.
const fmtK = (n) => {
  const v = parseFloat(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
};

// Last calendar day of a YYYY-MM value, as "YYYY-MM-DD".
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m, 0).toISOString().split("T")[0];
};
const monthStart = (ym) => `${ym}-01`;
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
};

function Reports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // "recent" → rolling last-N months; "month" → a single calendar month.
  const [mode, setMode] = useState("recent");
  const [months, setMonths] = useState(6);
  const [pickedMonth, setPickedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, months, pickedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params =
        mode === "month"
          ? `from=${monthStart(pickedMonth)}&to=${monthEnd(pickedMonth)}`
          : `months=${months}`;
      const res = await api.get(`/analytics/tenant?${params}`);
      setData(res.data.data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format) => {
    setExporting(format);
    try {
      // Same params the data fetch uses — exports reflect what's on screen.
      const params =
        mode === "month"
          ? `from=${monthStart(pickedMonth)}&to=${monthEnd(pickedMonth)}`
          : `months=${months}`;
      const res = await api.get(`/analytics/export/${format}?${params}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      const periodSlug =
        mode === "month"
          ? pickedMonth
          : `last-${months}-months`;
      a.download = `portfolio-report-${periodSlug}.${format === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Loading analytics…</div>
    );
  }
  if (!data) return null;

  const {
    kpis,
    par,
    snapshot,
    collectionTrend,
    disbursementTrend,
    aging,
    officers,
    statusDist,
  } = data;
  const snap = snapshot || {
    outstanding_balance: 0,
    overdue_count: 0,
    overdue_amount: 0,
    overdue_loans: 0,
    defaulted_count: 0,
    defaulted_amount: 0,
  };
  const parPct = parseFloat(par.par_percentage);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 size={28} /> Reports &amp; Analytics
            </h1>
            <p className="text-gray-600 mt-1">
              {mode === "month"
                ? `Performance for ${monthLabel(pickedMonth)}`
                : "Your portfolio performance"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white text-sm"
              title="Time range mode"
            >
              <option value="recent">Recent months</option>
              <option value="month">Specific month</option>
            </select>
            {mode === "recent" ? (
              <select
                value={months}
                onChange={(e) => setMonths(parseInt(e.target.value, 10))}
                className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white text-sm"
              >
                <option value={3}>Last 3 months</option>
                <option value={6}>Last 6 months</option>
                <option value={12}>Last 12 months</option>
              </select>
            ) : (
              <input
                type="month"
                value={pickedMonth}
                onChange={(e) => setPickedMonth(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white text-sm"
              />
            )}
            <button
              onClick={() => exportReport("pdf")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {exporting === "pdf" ? "…" : <><FileText size={15} /> PDF</>}
            </button>
            <button
              onClick={() => exportReport("excel")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {exporting === "excel" ? "…" : <><BarChart3 size={15} /> Excel</>}
            </button>
          </div>
        </div>

        {/* KPI cards. Period-filtered tiles always show; snapshot tiles
            (Outstanding / PAR / Overdue / Defaulted) describe today's
            state, so they're hidden when the user has zoomed into a
            historical specific month. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {/* ── Period-filtered (driven by the selected window) ── */}
          <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-4">
            <p className="text-ocean-100 text-xs uppercase">Total Disbursed</p>
            <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
              {fmt(kpis.total_disbursed)}
            </p>
            <p className="text-xs text-ocean-100">{kpis.total_loans} loans</p>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-4">
            <p className="text-green-100 text-xs uppercase">Collected</p>
            <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
              {fmt(kpis.total_collected)}
            </p>
            <p className="text-xs text-green-100">
              {kpis.payment_count} payments
            </p>
          </div>
          <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-4">
            <p className="text-ocean-100 text-xs uppercase">Interest from Loans</p>
            <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
              {fmt(kpis.interest_earned)}
            </p>
            <p className="text-xs text-ocean-100">loan interest earned</p>
          </div>
          <div className="rounded-xl shadow-lg p-4 text-white bg-gradient-to-br from-purple-600 to-fuchsia-700">
            <p className="text-white/85 text-xs uppercase flex items-center gap-1">
              <Gavel size={12} /> Fines Collected
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
              {fmt(kpis.fines_collected)}
            </p>
            <p className="text-xs text-white/85">late-payment penalties</p>
          </div>

          {/* ── Snapshot tiles (today's state) — only shown in
              "Recent months" mode. In specific-month mode they'd be
              showing today's outstanding for a long-past month, which
              is misleading. */}
          {mode !== "month" && (
            <>
              <div className="rounded-xl shadow-lg p-4 text-white bg-gradient-to-br from-amber-500 to-orange-600">
                <p className="text-white/85 text-xs uppercase flex items-center gap-1">
                  <Wallet size={12} /> Outstanding
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
                  {fmt(snap.outstanding_balance)}
                </p>
                <p className="text-xs text-white/85">To be collected</p>
              </div>
              <div
                className={`rounded-xl shadow-lg p-4 text-white ${
                  parPct > 15
                    ? "bg-gradient-to-br from-red-500 to-rose-600"
                    : parPct > 5
                      ? "bg-gradient-to-br from-orange-500 to-amber-600"
                      : "bg-gradient-to-br from-teal-500 to-cyan-600"
                }`}
              >
                <p className="text-white/80 text-xs uppercase">
                  Portfolio at Risk
                </p>
                <p className="text-2xl font-bold mt-1">{par.par_percentage}%</p>
                <p className="text-xs text-white/80">
                  {par.at_risk_count} of {par.total_active} loans
                </p>
              </div>
              <div className="rounded-xl shadow-lg p-4 text-white bg-gradient-to-br from-orange-500 to-amber-600">
                <p className="text-white/85 text-xs uppercase flex items-center gap-1">
                  <AlertTriangle size={12} /> Overdue
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
                  {fmt(snap.overdue_amount)}
                </p>
                <p className="text-xs text-white/85">
                  {snap.overdue_count} payment
                  {snap.overdue_count !== 1 ? "s" : ""}
                  {snap.overdue_loans > 0 && ` · ${snap.overdue_loans} loans`}
                </p>
              </div>
              <div className="rounded-xl shadow-lg p-4 text-white bg-gradient-to-br from-rose-600 to-red-700">
                <p className="text-white/85 text-xs uppercase flex items-center gap-1">
                  <XCircle size={12} /> Defaulted
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 break-words">
                  {fmt(snap.defaulted_amount)}
                </p>
                <p className="text-xs text-white/85">
                  {snap.defaulted_count} loan
                  {snap.defaulted_count !== 1 ? "s" : ""}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Coins size={18} /> Collection Trend</h3>
            {collectionTrend.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">
                No collections in this window
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={collectionTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Line
                    type="monotone"
                    dataKey="collected"
                    stroke="#10B981"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><TrendingUp size={18} /> Disbursement Trend</h3>
            {disbursementTrend.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">
                No disbursements in this window
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={disbursementTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="disbursed" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Charts Row 2 — snapshot panels (today's state). Hidden in
            specific-month mode since the figures describe right-now, not
            the historical month the user picked. */}
        {mode !== "month" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Clock size={18} /> Aging Analysis</h3>
            {aging.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">
                No outstanding payments
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={aging} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={fmtK}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="bucket"
                    tick={{ fontSize: 11 }}
                    width={80}
                  />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {aging.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.bucket === "Current"
                            ? "#10B981"
                            : entry.bucket === "90+ days"
                              ? "#EF4444"
                              : "#F59E0B"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><BarChart3 size={18} /> Loan Status</h3>
            {statusDist.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-sm text-gray-400">
                No loans yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={statusDist}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e) => `${e.status}: ${e.count}`}
                  >
                    {statusDist.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        )}

        {/* Loan officer performance — snapshot (all-time per officer),
            hidden in specific-month mode. */}
      {mode !== "month" && officers.length > 0 && (
        <div className="bg-white rounded-xl shadow-md p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Users size={18} /> Loan Officer Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Officer</th>
                  <th className="text-right p-2">Loans Created</th>
                  <th className="text-right p-2">Total Disbursed</th>
                </tr>
              </thead>
              <tbody>
                {officers.map((o, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-semibold">{o.officer_name}</td>
                    <td className="text-right p-2">{o.loans_created}</td>
                    <td className="text-right p-2 font-bold">
                      {fmt(o.total_disbursed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Reports;
