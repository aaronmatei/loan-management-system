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
  ArrowUpRight,
  ArrowDownLeft,
  Target,
  Sparkles,
  Receipt,
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
  usePersistentPeriod,
} from "../components/PeriodNavigator";
import Spinner from "../components/Spinner";

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
  active: "#0e8a6e",
  completed: "#10b981",
  defaulted: "#ef4444",
  pending: "#f59e0b",
  approved: "#22b488",
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
        <div className="bg-white rounded-xl shadow-md p-12">
          <Spinner centered label="Loading dashboard…" />
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
    (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  const BUCKET_ORDER = [
    "<10K",
    "10–25K",
    "25–50K",
    "50–100K",
    "100–250K",
    "250K+",
  ];
  const sizeData = BUCKET_ORDER.map((bucket) => {
    const row = (metrics.loan_size_buckets || []).find(
      (r) => r.bucket === bucket,
    );
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
  const METHOD_COLORS = ["#0e8a6e", "#22b488", "#0a5c4c", "#0d9488", "#94a3b8"];
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
        <PeriodNavigator
          value={period}
          onChange={setPeriod}
          modes={["year"]}
        />
      </div>

      {showWelcome && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl p-4 mb-4 flex justify-between items-center">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              <PartyPopper size={18} /> This is your dashboard!
            </h3>
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

      {/* Capital Pool — soft-light premium treatment. Single card:
          header + Top up capital on top, hero numbers, utilization
          bar, then the five pastel All-time tiles all live INSIDE. */}
      {poolStatus && (
        <div className="relative overflow-hidden rounded-3xl ring-1 ring-slate-200/60 shadow-[0_10px_40px_-20px_rgba(15,30,60,0.18)] p-6 lg:p-8 mb-6 bg-gradient-to-br from-slate-50 via-ocean-50 to-ocean-50/70">
          {/* Soft tinted glows for that premium light-mode feel. */}
          <div className="pointer-events-none absolute -top-32 -right-24 w-96 h-96 rounded-full bg-ocean-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-ocean-200/30 blur-3xl" />

          {/* Header — icon chip + title on the left, Top up capital
              pill on the right. */}
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative w-11 h-11 rounded-2xl bg-white ring-1 ring-slate-200/70 shadow-sm flex items-center justify-center">
                <Coins size={20} className="text-ocean-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                Capital Pool
              </h2>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowTopUp(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ocean-700 text-white text-sm font-medium hover:bg-ocean-800 transition shadow-sm"
              >
                Top up capital
                <Plus size={15} />
              </button>
            )}
          </div>

          {/* Available capital left, Net Profit pill centre, Loaned
              Out right — the three hero figures sit as siblings on
              one row. The centre pill catches the eye with a soft
              emerald glow when profit is positive (rose when it dips
              negative), so the bottom-line number reads at a glance
              without competing with the two principal-side figures. */}
          <div className="relative mt-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-6">
            <div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
                <p className="text-5xl lg:text-6xl font-extrabold text-slate-900 leading-none tracking-tight">
                  {fmtKES(poolStatus.available_pool)}
                </p>
                <p className="text-sm text-slate-400 pb-1.5">
                  of {fmtKES(poolStatus.initial_capital)} total pool
                </p>
              </div>
              <p className="text-sm text-slate-500 mt-2">Available Capital</p>
            </div>

            {/* Net Profit pill — "catchy" hero in the centre. */}
            {poolStatus.net_profit_lifetime != null && (() => {
              const netProfit = poolStatus.net_profit_lifetime || 0;
              const positive = netProfit >= 0;
              return (
                <div className="flex-1 min-w-[200px] flex justify-center">
                  <div
                    className={`relative overflow-hidden rounded-2xl px-5 py-3 ring-1 ${
                      positive
                        ? "ring-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-100/70"
                        : "ring-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-100/70"
                    } shadow-[0_8px_24px_-10px_rgba(16,185,129,0.35)]`}
                  >
                    {/* Aurora glow behind the figure. */}
                    <div
                      className={`pointer-events-none absolute -top-10 -right-6 w-32 h-32 rounded-full blur-2xl ${
                        positive ? "bg-emerald-300/40" : "bg-rose-300/40"
                      }`}
                    />
                    <div className="relative flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${
                          positive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        <Sparkles size={18} />
                      </div>
                      <div className="text-left">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-semibold">
                          Net Profit · All Time
                        </p>
                        <p
                          className={`text-2xl lg:text-3xl font-extrabold leading-none tracking-tight mt-0.5 ${
                            positive ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {positive ? "+" : ""}
                          {fmtKES(netProfit)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="text-right">
              <p className="text-3xl lg:text-4xl font-extrabold text-slate-900 leading-none tracking-tight">
                {fmtKES(poolStatus.outstanding_principal)}
              </p>
              <p className="text-sm text-slate-500 mt-2">Loaned Out</p>
            </div>
          </div>

          {/* Utilization — segmented capacity blocks. 10 rounded pills;
              each filled block fades along a cyan → violet ramp based
              on its position so the gradient reads as "intensity grows
              as the pool fills". Block count rounds to nearest 10%. */}
          <div className="relative mt-7">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Utilization</span>
              <span className="text-sm font-semibold text-slate-700">
                {poolStatus.utilization_rate.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: 10 }).map((_, i) => {
                const filledCount = Math.round(
                  Math.min(Math.max(poolStatus.utilization_rate, 0), 100) / 10,
                );
                const filled = i < filledCount;
                // brand green #22B488 (34,180,136) → teal-deep #0A5C4C (10,92,76)
                const t = i / 9;
                const r = Math.round(34 + (10 - 34) * t);
                const g = Math.round(180 + (92 - 180) * t);
                const b = Math.round(136 + (76 - 136) * t);
                return (
                  <div
                    key={i}
                    className={`flex-1 h-2.5 rounded-full transition-colors ${
                      filled ? "" : "bg-slate-200/80"
                    }`}
                    style={
                      filled
                        ? {
                            backgroundColor: `rgb(${r}, ${g}, ${b})`,
                            boxShadow: `0 0 12px rgba(${r}, ${g}, ${b}, 0.35)`,
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>

          {/* ── All-time tiles — pastel-tinted cards INSIDE the Capital
              Pool block, sitting under the utilization bar. */}
          <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-7">
            {/* All time Disbursed — neutral slate */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-white/70 to-slate-100/40 ring-1 ring-slate-200/60 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-white ring-1 ring-slate-200/60 flex items-center justify-center shadow-sm">
                  <ArrowUpRight size={15} className="text-slate-500" />
                </div>
                <ArrowUpRight size={12} className="text-slate-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Lifetime disbursement
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-slate-900 mt-1 tracking-tight whitespace-nowrap">
                {fmtKES(poolStatus.total_disbursed)}
              </p>
            </div>

            {/* All time Collected — soft emerald */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-emerald-50/80 to-emerald-100/40 ring-1 ring-emerald-200/50 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-white ring-1 ring-emerald-200/60 flex items-center justify-center shadow-sm">
                  <ArrowDownLeft size={15} className="text-emerald-600" />
                </div>
                <ArrowDownLeft size={12} className="text-emerald-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Net collection
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-slate-900 mt-1 tracking-tight whitespace-nowrap">
                {fmtKES(poolStatus.total_collected)}
              </p>
            </div>

            {/* All time Interest from Loans — emerald accent */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-emerald-100/80 to-emerald-50/40 ring-1 ring-emerald-200/60 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 ring-1 ring-emerald-200/70 flex items-center justify-center shadow-sm">
                  <TrendingUp size={15} className="text-emerald-600" />
                </div>
                <TrendingUp size={12} className="text-emerald-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Net Interest
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-emerald-700 mt-1 tracking-tight whitespace-nowrap">
                +{fmtKES(poolStatus.loan_interest_earned ?? 0)}
              </p>
            </div>

            {/* All time Interest from Fines — warm amber */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-amber-50/90 to-amber-100/40 ring-1 ring-amber-200/50 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-amber-100 ring-1 ring-amber-200/70 flex items-center justify-center shadow-sm">
                  <AlertTriangle size={15} className="text-amber-600" />
                </div>
                <AlertTriangle size={12} className="text-amber-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Total Fines
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-amber-700 mt-1 tracking-tight whitespace-nowrap">
                +{fmtKES(
                  poolStatus.fines_collected_gross ??
                    poolStatus.fines_collected ??
                    0,
                )}
              </p>
            </div>

            {/* All time Processing Fees — cool indigo, sits between
                Total Fines and Collection Rate so the revenue-side
                tiles read Interest → Fines → Fees → Collection Rate
                in one sweep. Fee is retained at disbursement time
                (booked into capital_pool.total_interest_earned) but
                surfacing it separately makes the income story
                explicit instead of bundled into Net Interest. */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-ocean-50/80 to-violet-100/40 ring-1 ring-ocean-200/60 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-ocean-100 ring-1 ring-ocean-200/70 flex items-center justify-center shadow-sm">
                  <Receipt size={15} className="text-ocean-600" />
                </div>
                <Receipt size={12} className="text-ocean-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Processing Fees
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-ocean-700 mt-1 tracking-tight whitespace-nowrap">
                +{fmtKES(poolStatus.processing_fees ?? 0)}
              </p>
            </div>

            {/* All time Collection Rate — soft sky */}
            <div className="relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br from-ocean-50/90 to-ocean-50/60 ring-1 ring-ocean-200/60 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-white ring-1 ring-ocean-200/70 flex items-center justify-center shadow-sm">
                  <Target size={15} className="text-ocean-500" />
                </div>
                <Target size={12} className="text-ocean-300" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mt-3">
                Lifetime Collection Rate
              </p>
              <p className="text-lg lg:text-xl font-extrabold text-slate-900 mt-1 tracking-tight">
                {metrics.collection_rate}%
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                All-time collection rate
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Period-scoped cash + P&L tiles moved to Reports. Dashboard
          now stays focused on lifetime Capital Pool figures + the
          snapshot KPI strip below. */}

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
            {fmtKES(metrics.active_portfolio ?? metrics.total_amount_due)}
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
                  <linearGradient
                    id="collectedFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#0e8a6e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#0e8a6e" stopOpacity={0} />
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
                  stroke="#0e8a6e"
                  strokeWidth={2.5}
                  fill="url(#collectedFill)"
                />
                <Line
                  type="monotone"
                  dataKey="disbursed"
                  name="Disbursed"
                  stroke="#22b488"
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
                  formatter={(value, entry) =>
                    `${value} (${entry.payload.value})`
                  }
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
              <p className="text-xs text-slate-500">Borrower age × status</p>
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
                  fill="#0e8a6e"
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
                  formatter={(value, entry) =>
                    `${value} (${entry.payload.value})`
                  }
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
                        {new Date(payment.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
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

        {/* Recent Loans */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <ClipboardList size={20} /> Recent Loans
            </h3>
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
      </div>
    </div>
  );
}

export default Dashboard;
