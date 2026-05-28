import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet,
  Coins,
  TrendingUp,
  AlertTriangle,
  PieChart as PieChartIcon,
  BarChart3,
  CreditCard,
  Users,
  Plus,
  PartyPopper,
  Crown,
  ClipboardList,
  Banknote,
  X,
  Receipt,
  ArrowUpDown,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  Label,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import IconTile from "../components/IconTile";
import PeriodNavigator, {
  periodToRange,
  periodLabel,
  usePersistentPeriod,
} from "../components/PeriodNavigator";

// Soft empty state for a chart card (fresh tenant / no data yet).
function EmptyChart({ label }) {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center text-slate-400">
      <BarChart3 size={40} className="mb-2" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

// Loan-status → ocean-aware colour. Semantic only where it's genuinely
// semantic (defaulted = rose, completed = emerald, pending = amber).
const STATUS_COLORS = {
  active: "#0086cc",
  completed: "#10b981",
  defaulted: "#ef4444",
  pending: "#f59e0b",
  approved: "#2cbeff",
  under_review: "#a78bfa",
  rejected: "#94a3b8",
  cancelled: "#64748b",
};

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [activities, setActivities] = useState({
    recent_loans: [],
    recent_payments: [],
  });
  const [trends, setTrends] = useState({ loans_trend: [], payments_trend: [] });
  const [poolStatus, setPoolStatus] = useState(null);
  const [portfolioBreakdown, setPortfolioBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showWelcome, setShowWelcome] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [period, setPeriod] = usePersistentPeriod();
  // Capital adjustments are admin-only on the backend.
  const isAdmin =
    JSON.parse(localStorage.getItem("user") || "{}").role === "admin";

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount <= 0) {
      alert("Enter a valid amount");
      return;
    }
    setTopUpBusy(true);
    try {
      await api.post("/capital/adjust", {
        type: "add",
        amount,
        description: "Capital top-up",
      });
      const poolRes = await api.get("/capital/status");
      setPoolStatus(poolRes.data.data);
      setShowTopUp(false);
      setTopUpAmount("");
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setTopUpBusy(false);
    }
  };

  // First-mount: if the tenant hasn't finished onboarding, send them
  // to the wizard. Also handle the ?welcome=true banner shown right
  // after the wizard's final "Take Me to My Dashboard" button.
  useEffect(() => {
    api
      .get("/onboarding/status")
      .then((r) => {
        if (r.data?.data && !r.data.data.onboarding_completed) {
          navigate("/onboarding");
        }
      })
      .catch(() => {
        /* non-fatal: stay on dashboard */
      });
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") === "true") {
      setShowWelcome(true);
      window.history.replaceState({}, "", "/");
    }
  }, [navigate]);

  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.mode, period.value]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const { from, to } = periodToRange(period);
      const q = from && to ? `?from=${from}&to=${to}` : "";
      const [summaryRes, activitiesRes, trendsRes] = await Promise.all([
        api.get(`/dashboard/summary${q}`),
        api.get(`/dashboard/recent-activities${q}`),
        api.get(`/dashboard/monthly-trends${q}`),
      ]);

      setMetrics(summaryRes.data.data);
      setActivities(activitiesRes.data.data);
      setTrends(trendsRes.data.data);

      // Pool status is best-effort; a failure here must not break the dashboard
      try {
        const poolRes = await api.get("/capital/status");
        setPoolStatus(poolRes.data.data);
      } catch (poolErr) {
        console.error("Failed to fetch pool status:", poolErr);
      }

      // Loan-status breakdown for the Portfolio Health donut. Reuses the
      // same endpoint the Analytics page uses. Best-effort — never breaks
      // the dashboard.
      try {
        const pbRes = await api.get(`/analytics/portfolio-breakdown${q}`);
        setPortfolioBreakdown(pbRes.data.data || []);
      } catch (pbErr) {
        console.error("Failed to fetch portfolio breakdown:", pbErr);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load dashboard");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  // Get max for trend bars
  const maxPaymentAmount = Math.max(
    ...trends.payments_trend.map((t) => parseFloat(t.total_amount)),
    1,
  );
  const maxLoanAmount = Math.max(
    ...trends.loans_trend.map((t) => parseFloat(t.total_amount)),
    1,
  );

  // ── Derived data for the redesigned insights row ──────────────────
  const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString()}`;
  const fmtAxis = (n) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
    return `${v}`;
  };

  // Chart 1: merge the monthly collected (payments_trend) + disbursed
  // (loans_trend) series the dashboard already fetches.
  const trendData = (trends.payments_trend || []).map((p) => {
    const l = (trends.loans_trend || []).find(
      (x) => x.month_label === p.month_label,
    );
    return {
      month: p.month_label,
      collected: parseFloat(p.total_amount || 0),
      disbursed: parseFloat(l?.total_amount || 0),
    };
  });
  const latestCollected = trendData.length
    ? trendData[trendData.length - 1].collected
    : null;

  // Chart 2: donut from the loan-status breakdown.
  const cap = (s) =>
    (s || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const donutData = (portfolioBreakdown || [])
    .map((s) => ({
      name: cap(s.status),
      value: parseInt(s.count, 10) || 0,
      color: STATUS_COLORS[s.status] || "#94a3b8",
    }))
    .filter((d) => d.value > 0);
  const donutTotal = donutData.reduce((a, b) => a + b.value, 0);
  const renderDonutCenter = ({ viewBox }) => {
    const { cx, cy } = viewBox;
    return (
      <g>
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 26, fontWeight: 700, fill: "#0f1b2d" }}
        >
          {donutTotal}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 10, fill: "#64748b", letterSpacing: 0.5 }}
        >
          TOTAL LOANS
        </text>
      </g>
    );
  };

  // Chart A — Loans by Age: borrower age buckets × loan status, so the
  // lender sees which age groups are actively borrowing, repaying in full
  // (completed) and defaulting. Force the bucket order (SQL would
  // alphabetise) and coerce counts to numbers so a real-data tenant never
  // falsely shows empty. Loans whose client has no DOB are excluded server-side.
  const AGE_ORDER = ["18–24", "25–34", "35–44", "45–54", "55+"];
  const ageData = AGE_ORDER.map((bucket) => {
    const row = (metrics.loan_age_distribution || []).find(
      (r) => r.bucket === bucket,
    );
    return {
      bucket,
      active: Number(row?.active || 0),
      completed: Number(row?.completed || 0),
      defaulted: Number(row?.defaulted || 0),
    };
  });
  const ageHasData = ageData.some(
    (d) => d.active + d.completed + d.defaulted > 0,
  );

  // Chart B — Loan-size histogram. Force the bucket order (SQL would
  // alphabetise the labels) and coerce to numbers so a real-data tenant
  // never falsely shows empty.
  const BUCKET_ORDER = ["<10K", "10–25K", "25–50K", "50–100K", "100–250K", "250K+"];
  const sizeData = BUCKET_ORDER.map((bucket) => {
    const row = (metrics.loan_size_buckets || []).find((r) => r.bucket === bucket);
    return {
      bucket,
      count: Number(row?.count || 0),
      total: Number(row?.total || 0),
    };
  });
  const sizeHasData = sizeData.some((d) => d.count > 0);

  // Chart C — Payment-method split. Ocean palette (channel mix isn't a
  // status, so no semantic colours); friendly labels for known methods.
  const METHOD_LABELS = {
    mpesa: "M-Pesa",
    "m-pesa": "M-Pesa",
    bank: "Bank",
    bank_transfer: "Bank",
    cash: "Cash",
    card: "Card",
    cheque: "Cheque",
  };
  const METHOD_COLORS = ["#0086cc", "#2cbeff", "#4f46e5", "#0d9488", "#94a3b8"];
  const methodData = (metrics.payment_method_split || [])
    .map((m, i) => ({
      name: METHOD_LABELS[(m.method || "").toLowerCase()] || cap(m.method),
      value: Number(m.count || 0),
      total: Number(m.total || 0),
      color: METHOD_COLORS[i % METHOD_COLORS.length],
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
            Dashboard
          </h1>
          <p className="text-gray-600 mt-2">
            Welcome back,{" "}
            <span className="font-semibold">{user?.first_name}</span>!
          </p>
        </div>
        <PeriodNavigator value={period} onChange={setPeriod} />
      </div>

      {showWelcome && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl p-4 mb-4 flex justify-between items-center">
          <div>
            <h3 className="font-bold flex items-center gap-2"><PartyPopper size={18} /> Welcome to your dashboard!</h3>
            <p className="text-sm">
              Your first loan application is in the Applications queue — review
              and disburse it from there.
            </p>
          </div>
          <button
            onClick={() => setShowWelcome(false)}
            className="text-white leading-none"
            aria-label="Dismiss"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {user?.is_platform_admin && (
        <button
          onClick={() => navigate("/admin/dashboard")}
          className="w-full bg-ocean-gradient text-white py-3 px-4 rounded-xl shadow-md mb-6 flex items-center justify-center gap-2 hover:shadow-lg transition"
        >
          <Crown size={18} />
          <span className="font-semibold">Go to Platform Admin</span>
        </button>
      )}

      {/* Capital Pool — light/glassy to match the rest of the dashboard */}
      {poolStatus && (
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-6 mb-6 bg-gradient-to-br from-ocean-100/70 via-white/55 to-indigo-100/60 backdrop-blur-md">
          {/* Laced colour: soft brand auroras drifting behind the frosted glass. */}
          <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-ocean-300/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-indigo-300/25 blur-3xl" />
          <div className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 w-56 h-56 rounded-full bg-emerald-200/20 blur-3xl" />

          {/* Header */}
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconTile icon={Coins} variant="ocean" size={44} />
              <div>
                <h2 className="text-lg font-bold text-navy-900">Capital Pool</h2>
                <p className="text-sm text-slate-500">Available for lending</p>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowTopUp(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ocean-200 bg-ocean-50 text-ocean-700 text-sm font-semibold hover:bg-ocean-100 transition"
              >
                <Plus size={16} /> Top up capital
              </button>
            )}
          </div>

          {/* Available capital + principal currently loaned out */}
          <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mt-6">
            <div>
              <p className="text-sm text-slate-500">Available Capital</p>
              <p className="text-3xl lg:text-4xl font-extrabold text-navy-900 leading-none mt-1">
                {fmtKES(poolStatus.available_pool)}
                <span className="text-sm font-medium text-slate-400 ml-2">
                  of {fmtKES(poolStatus.initial_capital)}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-500">Loaned Out</p>
              <p className="text-2xl lg:text-3xl font-extrabold text-ocean-600 leading-none mt-1">
                {fmtKES(poolStatus.outstanding_principal)}
              </p>
            </div>
          </div>

          {/* Utilization */}
          <div className="relative mt-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-slate-500">
                Utilization
              </span>
              <span className="text-sm font-bold text-ocean-600">
                {poolStatus.utilization_rate.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-white/50 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 rounded-full bg-gradient-to-r from-ocean-600 to-ocean-300 transition-all"
                style={{
                  width: `${Math.min(Math.max(poolStatus.utilization_rate, 0), 100)}%`,
                }}
              />
            </div>
          </div>

          {/* Cash story row — what went out, what came back, what was
              earned, how much we're collecting. Period P&L lives in
              its own row below the Capital Pool card. */}
          <div className="relative grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
            <div className="rounded-xl border border-white/70 bg-white/55 p-3 backdrop-blur-sm">
              <p className="text-xs text-slate-500">Total Disbursed</p>
              <p className="text-base sm:text-lg font-bold text-navy-900 whitespace-nowrap mt-1">
                {fmtKES(poolStatus.total_disbursed)}
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/55 p-3 backdrop-blur-sm">
              <p className="text-xs text-slate-500">Total Collected</p>
              <p className="text-base sm:text-lg font-bold text-navy-900 whitespace-nowrap mt-1">
                {fmtKES(poolStatus.total_collected)}
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/55 p-3 backdrop-blur-sm">
              <p className="text-xs text-slate-500">Interest from Loans</p>
              <p className="text-base sm:text-lg font-bold text-emerald-600 whitespace-nowrap mt-1">
                +{fmtKES(poolStatus.loan_interest_earned ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/55 p-3 backdrop-blur-sm">
              <p className="text-xs text-slate-500">Interest from Fines</p>
              <p className="text-base sm:text-lg font-bold text-amber-600 whitespace-nowrap mt-1">
                +{fmtKES(poolStatus.fines_collected ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/55 p-3 backdrop-blur-sm">
              <p className="text-xs text-slate-500">Collection Rate</p>
              <p className="text-base sm:text-lg font-bold text-navy-900 whitespace-nowrap mt-1">
                {metrics.collection_rate}%
              </p>
              <div className="w-full bg-white/60 rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="bg-ocean-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min(metrics.collection_rate, 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Period heading + compact one-row strip of cash + P&L tiles.
          Nine tiles in total. Wraps to a 5-col cash row + 4-col P&L row
          on lg, two equal halves on sm, two-up on mobile. */}
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm text-slate-600">
          Showing{" "}
          <span className="font-semibold text-navy-900">
            {periodLabel(period)}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 mb-4">
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <p className="text-[11px] text-slate-500">Total Disbursed</p>
          <p className="text-base font-bold text-navy-900 whitespace-nowrap mt-1">
            {fmtKES(metrics.total_principal || 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <p className="text-[11px] text-slate-500">Total Collected</p>
          <p className="text-base font-bold text-navy-900 whitespace-nowrap mt-1">
            {fmtKES(metrics.total_collected || 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <p className="text-[11px] text-slate-500">Interest from Loans</p>
          <p className="text-base font-bold text-emerald-600 whitespace-nowrap mt-1">
            +{fmtKES(metrics.interest_collected ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <p className="text-[11px] text-slate-500">Interest from Fines</p>
          <p className="text-base font-bold text-amber-600 whitespace-nowrap mt-1">
            +{fmtKES(metrics.fines_collected ?? 0)}
          </p>
        </div>
        <button
          onClick={() => navigate("/expenses")}
          className="text-left bg-white rounded-xl border border-slate-100 shadow-sm p-3 hover:border-amber-200 transition"
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] text-slate-500">Expenses</p>
            <Receipt size={12} className="text-amber-600 flex-shrink-0" />
          </div>
          <p className="text-base font-bold text-amber-700 whitespace-nowrap mt-1">
            −{fmtKES(metrics.expenses_this_month || 0)}
          </p>
        </button>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] text-slate-500">Processing Fees</p>
            <Banknote size={12} className="text-ocean-600 flex-shrink-0" />
          </div>
          <p className="text-base font-bold text-ocean-700 whitespace-nowrap mt-1">
            +{fmtKES(metrics.processing_fees || 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] text-slate-500">Income</p>
            <TrendingUp size={12} className="text-emerald-600 flex-shrink-0" />
          </div>
          <p className="text-base font-bold text-emerald-600 whitespace-nowrap mt-1">
            +{fmtKES(metrics.income_this_month || 0)}
          </p>
        </div>
        <div
          className={`bg-white rounded-xl border border-slate-100 shadow-sm p-3 ${
            (metrics.net_profit_this_month || 0) >= 0
              ? "ring-1 ring-emerald-200"
              : "ring-1 ring-rose-200"
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] text-slate-500">Net Profit</p>
            <ArrowUpDown
              size={12}
              className={`${
                (metrics.net_profit_this_month || 0) >= 0
                  ? "text-emerald-600"
                  : "text-rose-600"
              } flex-shrink-0`}
            />
          </div>
          <p
            className={`text-base font-bold whitespace-nowrap mt-1 ${
              (metrics.net_profit_this_month || 0) >= 0
                ? "text-emerald-700"
                : "text-rose-700"
            }`}
          >
            {(metrics.net_profit_this_month || 0) >= 0 ? "+" : ""}
            {fmtKES(metrics.net_profit_this_month || 0)}
          </p>
        </div>
      </div>

      {/* Top-up capital modal */}
      {showTopUp && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 text-gray-800 flex items-center gap-2">
              <Coins size={22} /> Top up capital pool
            </h3>
            {poolStatus && (
              <p className="text-sm text-gray-600 mb-4">
                Available now:{" "}
                <strong>
                  KES {poolStatus.available_pool.toLocaleString()}
                </strong>
              </p>
            )}
            <label className="block text-sm font-semibold mb-1 text-gray-700">
              Amount to add (KES) *
            </label>
            <input
              type="number"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              min="1"
              placeholder="e.g. 500000"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowTopUp(false)}
                disabled={topUpBusy}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleTopUp}
                disabled={topUpBusy || !topUpAmount}
                className="px-6 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg disabled:opacity-50"
              >
                {topUpBusy ? "Adding..." : "Add capital"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI strip: one tidy set of distinct KPIs, no duplicates ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
        {/* Total Portfolio — active receivable book (principal + interest
            for currently-active loans). Matches Analytics' "Active
            Portfolio" so the two pages don't disagree. */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
              Total Portfolio
            </p>
            <IconTile icon={Wallet} variant="ocean" size={40} />
          </div>
          <p className="text-2xl font-bold text-navy-900 mt-2">
            {fmtKES(
              metrics.active_portfolio ?? metrics.total_amount_due,
            )}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {metrics.active_loans} active • {metrics.total_loans} total
          </p>
        </div>

        {/* Receivable — book balance still owed (principal + interest). */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
              Receivable
            </p>
            <IconTile icon={Coins} variant="amber" size={40} />
          </div>
          <p className="text-2xl font-bold text-navy-900 mt-2">
            {fmtKES(metrics.outstanding_balance)}
          </p>
          <p className="text-xs text-slate-500 mt-1">To be collected</p>
        </div>

        {/* Overdue → keeps the navigation to the dedicated overdue page */}
        <button
          onClick={() => navigate("/overdue")}
          className="text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-5 hover:border-rose-200 hover:shadow transition"
        >
          <div className="flex items-start justify-between">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
              Overdue
            </p>
            <IconTile icon={AlertTriangle} variant="rose" size={40} />
          </div>
          <p className="text-2xl font-bold text-navy-900 mt-2">
            {Number(metrics.overdue_count || 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {fmtKES(metrics.overdue_amount)}
            {metrics.overdue_loans > 0 && ` • ${metrics.overdue_loans} loans`}
          </p>
        </button>

        {/* Collection Rate — period total_collected / total_amount_due */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
              Collection Rate
            </p>
            <IconTile icon={TrendingUp} variant="ocean" size={40} />
          </div>
          <p className="text-2xl font-bold text-navy-900 mt-2">
            {(metrics.collection_rate || 0).toFixed(1)}%
          </p>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="bg-ocean-500 h-1.5 rounded-full transition-all"
              style={{
                width: `${Math.min(metrics.collection_rate || 0, 100)}%`,
              }}
            />
          </div>
        </div>

      </div>

      {/* ── Insights row: trend chart + portfolio donut ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Chart 1 — Collections vs Disbursements (last 6 months) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <IconTile icon={TrendingUp} variant="ocean" size={36} />
            <div>
              <h3 className="font-bold text-navy-900">Collections Trend</h3>
              <p className="text-xs text-slate-500">
                {latestCollected != null
                  ? `Latest month: ${fmtKES(latestCollected)} collected`
                  : "Last 6 months"}
              </p>
            </div>
          </div>
          {trendData.length === 0 ? (
            <EmptyChart label="No collections yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={trendData}
                margin={{ top: 6, right: 8, left: -8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="collectedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0086cc" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0086cc" stopOpacity={0} />
                  </linearGradient>
                </defs>
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
                  tickFormatter={fmtAxis}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={(v, n) => [fmtKES(v), n]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="collected"
                  name="Collected"
                  stroke="#0086cc"
                  strokeWidth={2.5}
                  fill="url(#collectedFill)"
                />
                <Line
                  type="monotone"
                  dataKey="disbursed"
                  name="Disbursed"
                  stroke="#2cbeff"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart 2 — Portfolio Health donut */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <IconTile icon={PieChartIcon} variant="indigo" size={36} />
            <div>
              <h3 className="font-bold text-navy-900">Portfolio Health</h3>
              <p className="text-xs text-slate-500">Loan status breakdown</p>
            </div>
          </div>
          {donutTotal === 0 ? (
            <EmptyChart label="No loans yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={98}
                  paddingAngle={2}
                  stroke="none"
                >
                  {donutData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                  <Label content={renderDonutCenter} />
                </Pie>
                <Tooltip
                  formatter={(v, n) => [`${v} loans`, n]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value, entry) => `${value} (${entry.payload.value})`}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Distribution charts: age, loan size, payment method ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Chart A — Loans by Age: borrower age × loan status */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <IconTile icon={Users} variant="ocean" size={36} />
            <div>
              <h3 className="font-bold text-navy-900">Loans by Age</h3>
              <p className="text-xs text-slate-500">
                Borrower age × status
              </p>
            </div>
          </div>
          {!ageHasData ? (
            <EmptyChart label="No borrower ages yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={ageData}
                margin={{ top: 6, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef2f6"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="active"
                  name="Active"
                  fill={STATUS_COLORS.active}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill={STATUS_COLORS.completed}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
                <Bar
                  dataKey="defaulted"
                  name="Defaulted"
                  fill={STATUS_COLORS.defaulted}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart B — Loan-size histogram */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <IconTile icon={BarChart3} variant="indigo" size={36} />
            <div>
              <h3 className="font-bold text-navy-900">Loan Sizes</h3>
              <p className="text-xs text-slate-500">Loans by principal</p>
            </div>
          </div>
          {!sizeHasData ? (
            <EmptyChart label="No loans yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={sizeData}
                margin={{ top: 6, right: 8, left: -8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef2f6"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "#f1f5f9" }}
                  formatter={(v, n, p) => [
                    `${v} loans • ${fmtKES(p.payload.total)}`,
                    "Loans",
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Loans"
                  fill="#0086cc"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart C — Payment-method split */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-3">
            <IconTile icon={CreditCard} variant="teal" size={36} />
            <div>
              <h3 className="font-bold text-navy-900">Payment Methods</h3>
              <p className="text-xs text-slate-500">
                Share of completed payments
              </p>
            </div>
          </div>
          {methodData.length === 0 ? (
            <EmptyChart label="No payments yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={methodData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="none"
                >
                  {methodData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, n, p) => [
                    `${v} payments • ${fmtKES(p.payload.total)}`,
                    n,
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value, entry) => `${value} (${entry.payload.value})`}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Secondary Metrics — Total Interest dropped; it duplicated the
          Interest Earned KPI above (identical when there's no Capital Pool) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-ocean-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Total Clients
          </p>
          <p className="text-xl font-bold text-gray-800 mt-1">
            {metrics.total_clients}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {metrics.active_clients} active
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-green-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Completed Loans
          </p>
          <p className="text-xl font-bold text-green-600 mt-1">
            {metrics.completed_loans}
          </p>
          <p className="text-xs text-gray-500 mt-1">Fully repaid</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-yellow-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Upcoming (7 days)
          </p>
          <p className="text-xl font-bold text-yellow-600 mt-1">
            {metrics.upcoming_count}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            KES {metrics.upcoming_amount.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Trends Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Payments Trend */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Banknote size={20} /> Payments (Last 6 Months)
          </h3>
          {trends.payments_trend.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No payment data yet
            </p>
          ) : (
            <div className="space-y-3">
              {trends.payments_trend.map((item) => {
                const amount = parseFloat(item.total_amount);
                const percentage = (amount / maxPaymentAmount) * 100;
                return (
                  <div key={item.month}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-gray-700">
                        {item.month_label}
                      </span>
                      <span className="text-sm font-bold text-green-600">
                        KES {amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-green-500 to-emerald-600 h-3 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.count} payments
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Loans Trend */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Coins size={20} /> Loans Issued (Last 6 Months)
          </h3>
          {trends.loans_trend.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No loan data yet</p>
          ) : (
            <div className="space-y-3">
              {trends.loans_trend.map((item) => {
                const amount = parseFloat(item.total_amount);
                const percentage = (amount / maxLoanAmount) * 100;
                return (
                  <div key={item.month}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-gray-700">
                        {item.month_label}
                      </span>
                      <span className="text-sm font-bold text-ocean-600">
                        KES {amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className="bg-ocean-gradient h-3 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.count} loans
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Loans */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><ClipboardList size={20} /> Recent Loans</h3>
            <button
              onClick={() => navigate("/loans")}
              className="text-ocean-600 hover:text-ocean-700 text-sm font-semibold"
            >
              View all →
            </button>
          </div>
          {activities.recent_loans.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No loans yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activities.recent_loans.map((loan) => (
                <div
                  key={loan.id}
                  onClick={() => navigate(`/loans/${loan.id}`)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {loan.first_name} {loan.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {loan.loan_code} • {loan.phone_number}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-800">
                        KES {parseFloat(loan.principal_amount).toLocaleString()}
                      </p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${
                          loan.status === "active"
                            ? "bg-emerald-50 text-emerald-600"
                            : loan.status === "completed"
                              ? "bg-ocean-50 text-ocean-600"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {loan.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Banknote size={20} /> Recent Payments
            </h3>
            <button
              onClick={() => navigate("/payments")}
              className="text-green-600 hover:text-green-800 text-sm font-semibold"
            >
              View all →
            </button>
          </div>
          {activities.recent_payments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No payments yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activities.recent_payments.map((payment) => (
                <div
                  key={payment.id}
                  className="p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {payment.first_name} {payment.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {payment.loan_code} • {payment.payment_method}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(payment.payment_date).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        KES {parseFloat(payment.amount_paid).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">
                        {payment.transaction_code}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
