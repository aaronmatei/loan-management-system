// Reports & Exports — combined page. The KPI block at the top is the
// historical Reports view; the Excel-download tiles below it absorbed
// what used to live on the separate Exports page.
//
// KPI data comes from /api/analytics/tenant; row-level exports come
// from /api/reports/export/{clients,loans,overdue,payments}.

import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Coins,
  FileText,
  Users,
  AlertTriangle,
  XCircle,
  Wallet,
  Gavel,
  Download,
  Calendar,
  Lightbulb,
  DollarSign,
  CheckCircle,
  TrendingUp,
  Clock,
  Eye,
  Receipt,
  ArrowUpDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  ComposedChart,
} from "recharts";
import api from "../services/api";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const fmtK = (n) => {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${v}`;
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

const today = () => new Date().toISOString().split("T")[0];

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

  // Row-export filter state — each export card has its own range so
  // they can be configured independently.
  const [clientsRange, setClientsRange] = useState({ from: "", to: "" });
  const [loansFilters, setLoansFilters] = useState({
    status: "all",
    from: "",
    to: "",
  });
  const [paymentsRange, setPaymentsRange] = useState({ from: "", to: today() });
  const [rowExporting, setRowExporting] = useState(null);

  const downloadRowExport = async (kind) => {
    setRowExporting(kind);
    try {
      const url = (() => {
        const qs = new URLSearchParams();
        if (kind === "clients") {
          if (clientsRange.from) qs.set("date_from", clientsRange.from);
          if (clientsRange.to) qs.set("date_to", clientsRange.to);
          return `/reports/export/clients${qs.toString() ? `?${qs}` : ""}`;
        }
        if (kind === "loans") {
          if (loansFilters.status !== "all") qs.set("status", loansFilters.status);
          if (loansFilters.from) qs.set("date_from", loansFilters.from);
          if (loansFilters.to) qs.set("date_to", loansFilters.to);
          return `/reports/export/loans${qs.toString() ? `?${qs}` : ""}`;
        }
        if (kind === "overdue") return "/reports/export/overdue";
        if (kind === "payments") {
          if (paymentsRange.from) qs.set("date_from", paymentsRange.from);
          if (paymentsRange.to) qs.set("date_to", paymentsRange.to);
          return `/reports/export/payments${qs.toString() ? `?${qs}` : ""}`;
        }
      })();
      const res = await api.get(url, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = blobUrl;
      const slug =
        kind === "loans" && loansFilters.status !== "all"
          ? `${loansFilters.status}_loans`
          : kind;
      a.download = `${slug}_${today()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert("Download failed: " + (err.response?.data?.error || err.message));
    } finally {
      setRowExporting(null);
    }
  };

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

  const { kpis, par, snapshot, expenseStats, cashFlow } = data;
  const expensesWindow = parseFloat(expenseStats?.total_in_window || 0);
  const incomeWindow =
    (parseFloat(kpis.interest_earned) || 0) +
    (parseFloat(kpis.fines_collected) || 0);
  const netProfitWindow = incomeWindow - expensesWindow;
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
              <BarChart3 size={28} /> Reports &amp; Exports
            </h1>
            <p className="text-gray-600 mt-1">
              {mode === "month"
                ? `Performance for ${monthLabel(pickedMonth)}`
                : "Your portfolio performance · download data for analysis"}
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

        {/* Portfolio Performance hero — investor-view summary of the
            selected window: how much capital was deployed vs how much
            income came back. Returns = loan-interest income + late-fee
            (fines) income; ROI = returns ÷ invested. Both figures are
            already period-filtered on the KPI side. */}
        {(() => {
          const invested = parseFloat(kpis.total_disbursed) || 0;
          const returns =
            (parseFloat(kpis.interest_earned) || 0) +
            (parseFloat(kpis.fines_collected) || 0);
          const roiPct =
            invested > 0 ? ((returns / invested) * 100).toFixed(1) : "0.0";
          const periodSubtitle =
            mode === "month"
              ? monthLabel(pickedMonth)
              : `Last ${months} months`;
          return (
            <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-6 mb-6 bg-gradient-to-br from-ocean-100/70 via-white/55 to-indigo-100/60 backdrop-blur-md">
              {/* Soft auroras behind the frosted glass, matching the
                  Capital Pool card on the Dashboard. */}
              <div className="pointer-events-none absolute -top-20 -right-12 w-64 h-64 rounded-full bg-ocean-300/30 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-indigo-300/25 blur-3xl" />

              <div className="relative flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-ocean-400 to-indigo-500 flex items-center justify-center shadow-sm">
                    <TrendingUp size={22} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-navy-900">
                      Portfolio Performance
                    </h2>
                    <p className="text-xs text-slate-500">
                      {periodSubtitle} · capital out vs income back
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-white/70 bg-white/55 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase font-semibold tracking-wide text-slate-500">
                    Amount Invested
                  </p>
                  <p className="text-2xl lg:text-3xl font-extrabold text-navy-900 mt-1 break-words">
                    {fmt(invested)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {kpis.total_loans} loan
                    {kpis.total_loans !== 1 ? "s" : ""} disbursed
                  </p>
                </div>

                <div className="rounded-xl border border-white/70 bg-white/55 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase font-semibold tracking-wide text-slate-500">
                    Returns Gained
                  </p>
                  <p className="text-2xl lg:text-3xl font-extrabold text-emerald-700 mt-1 break-words">
                    +{fmt(returns)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Interest {fmt(kpis.interest_earned)} · Fines{" "}
                    {fmt(kpis.fines_collected)}
                  </p>
                </div>

                <div className="rounded-xl border border-white/70 bg-white/55 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase font-semibold tracking-wide text-slate-500">
                    ROI
                  </p>
                  <p className="text-2xl lg:text-3xl font-extrabold text-ocean-700 mt-1">
                    {roiPct}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    of invested capital
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* KPI cards — clean white tile with a tinted icon-square in the
            top-left, brand-coloured icon inside. Identity comes from the
            icon, not the card body, so the row reads calmly. Period-
            filtered tiles always show; snapshot tiles (Outstanding /
            PAR / Overdue / Defaulted) describe today's state and hide
            in specific-month mode. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {/* ── Period-filtered (driven by the selected window) ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
              <DollarSign size={20} className="text-blue-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Total Disbursed
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.total_disbursed)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {kpis.total_loans} loans
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-3">
              <CheckCircle size={20} className="text-emerald-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Collected
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.total_collected)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {kpis.payment_count} payments
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mb-3">
              <TrendingUp size={20} className="text-indigo-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Interest from Loans
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.interest_earned)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">loan interest earned</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-fuchsia-50 flex items-center justify-center mb-3">
              <Gavel size={20} className="text-fuchsia-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Fines Collected
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.fines_collected)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              late-payment penalties
            </p>
          </div>

          {/* ── Snapshot tiles (today's state) — only shown in
              "Recent months" mode. In specific-month mode they'd be
              showing today's outstanding for a long-past month, which
              is misleading. */}
          {mode !== "month" && (
            <>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3">
                  <Clock size={20} className="text-amber-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Outstanding
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.outstanding_balance)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">to be collected</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                    parPct > 15
                      ? "bg-rose-50"
                      : parPct > 5
                        ? "bg-orange-50"
                        : "bg-teal-50"
                  }`}
                >
                  <Eye
                    size={20}
                    className={
                      parPct > 15
                        ? "text-rose-600"
                        : parPct > 5
                          ? "text-orange-600"
                          : "text-teal-600"
                    }
                  />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Portfolio at Risk
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900">
                  {par.par_percentage}%
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {par.at_risk_count} of {par.total_active} loans
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center mb-3">
                  <AlertTriangle size={20} className="text-orange-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Overdue
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.overdue_amount)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {snap.overdue_count} payment
                  {snap.overdue_count !== 1 ? "s" : ""}
                  {snap.overdue_loans > 0 && ` · ${snap.overdue_loans} loans`}
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center mb-3">
                  <XCircle size={20} className="text-rose-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Defaulted
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.defaulted_amount)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {snap.defaulted_count} loan
                  {snap.defaulted_count !== 1 ? "s" : ""}
                </p>
              </div>
            </>
          )}

          {/* Expenses + Net Profit for the selected window — period-
              filtered, so they live with the other period tiles. */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3">
              <Receipt size={20} className="text-amber-700" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Expenses
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(expensesWindow)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {expenseStats?.count_in_window || 0} entries
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                netProfitWindow >= 0 ? "bg-emerald-50" : "bg-rose-50"
              }`}
            >
              <ArrowUpDown
                size={20}
                className={
                  netProfitWindow >= 0 ? "text-emerald-600" : "text-rose-600"
                }
              />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Net Profit
            </p>
            <p
              className={`text-xl lg:text-2xl font-bold mt-1 break-words ${
                netProfitWindow >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {netProfitWindow >= 0 ? "+" : ""}
              {fmt(netProfitWindow)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">income − expenses</p>
          </div>
        </div>

        {/* ── Income vs Expenses monthly trend ──────────────────── */}
        {Array.isArray(cashFlow) && cashFlow.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <ArrowUpDown size={18} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">
                  Income vs Expenses
                </h3>
                <p className="text-xs text-gray-500">
                  What's coming in (interest + fines) versus going out
                  (operating expenses), month by month.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={cashFlow}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef2f6"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtK}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(v, n) => [fmt(v), n]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses"
                  fill="#d97706"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="#0086cc"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#0086cc" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Excel exports ────────────────────────────────────── */}
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2 mt-2">
          <Download size={22} /> Excel Exports
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Clients export — optional join-date window */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Users size={18} className="text-ocean-600" /> Clients
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Full client list with totals borrowed and paid.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Joined from
                </label>
                <input
                  type="date"
                  value={clientsRange.from}
                  onChange={(e) =>
                    setClientsRange({ ...clientsRange, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Joined to
                </label>
                <input
                  type="date"
                  value={clientsRange.to}
                  onChange={(e) =>
                    setClientsRange({ ...clientsRange, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("clients")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "clients" ? "Downloading…" : "Download Clients"}
            </button>
          </div>

          {/* Loans export — status filter + optional disbursement window */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Coins size={18} className="text-ocean-600" /> Loans
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Filter by status, narrow by disbursement date.
                </p>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Status
              </label>
              <select
                value={loansFilters.status}
                onChange={(e) =>
                  setLoansFilters({ ...loansFilters, status: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white text-sm"
              >
                <option value="all">All loans</option>
                <option value="active">Active only</option>
                <option value="completed">Completed only</option>
                <option value="defaulted">Defaulted only</option>
                <option value="overdue">With overdue payments</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Disbursed from
                </label>
                <input
                  type="date"
                  value={loansFilters.from}
                  onChange={(e) =>
                    setLoansFilters({ ...loansFilters, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Disbursed to
                </label>
                <input
                  type="date"
                  value={loansFilters.to}
                  onChange={(e) =>
                    setLoansFilters({ ...loansFilters, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("loans")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "loans" ? "Downloading…" : "Download Loans"}
            </button>
          </div>

          {/* Payments export — date range */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Calendar size={18} className="text-green-600" /> Payments
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Every transaction recorded in a date window.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  From
                </label>
                <input
                  type="date"
                  value={paymentsRange.from}
                  onChange={(e) =>
                    setPaymentsRange({ ...paymentsRange, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  To
                </label>
                <input
                  type="date"
                  value={paymentsRange.to}
                  onChange={(e) =>
                    setPaymentsRange({ ...paymentsRange, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("payments")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "payments" ? "Downloading…" : "Download Payments"}
            </button>
          </div>

          {/* Overdue export — no filters needed */}
          <div className="bg-white rounded-xl shadow-md p-5 flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-orange-600" />{" "}
                  Overdue Payments
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Every past-due installment with days late.
                </p>
              </div>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => downloadRowExport("overdue")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "overdue" ? "Downloading…" : "Download Overdue"}
            </button>
          </div>
        </div>

        {/* About */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
            <Lightbulb size={18} /> About reports
          </h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>
              • The PDF / Excel buttons at the top export the portfolio summary
              for the period you've picked above.
            </li>
            <li>
              • The four cards below export raw rows — clients, loans, payments,
              and overdue installments — for accounting or further analysis.
            </li>
            <li>
              • PDF statements for an individual client or loan live on their
              respective detail pages.
            </li>
            <li>
              • Exports always reflect current data — regenerate any time.
            </li>
          </ul>
        </div>
    </div>
  );
}

export default Reports;
