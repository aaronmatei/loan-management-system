import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Coins,
  Wallet,
  TrendingUp,
  Percent,
  Building2,
  ArrowRight,
  PlusCircle,
  PiggyBank,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";
import { lenderColor } from "../lenderColor";
import Spinner from "../../components/Spinner";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const kCompact = (v) =>
  v >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1e3
      ? `${Math.round(v / 1e3)}k`
      : `${v}`;

const RISK_HEX = {
  green: "#16a34a",
  yellow: "#ca8a04",
  orange: "#ea580c",
  red: "#dc2626",
};
const STATUS_HEX = {
  active: "#16a34a",
  completed: "#2563eb",
  defaulted: "#dc2626",
  pending: "#d97706",
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Customer dashboard = a personal credit & borrowing analytics view across
// every linked lender: credit score gauge, portfolio KPIs, a 6-month
// repayment trend, and a loan-status breakdown.
function CustomerDashboard() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  const customerName = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_customer") || "{}")
        .first_name;
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    portalApi
      .get("/portal/customer/analytics")
      .then((r) => setD(r.data.data))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load dashboard"),
      )
      .finally(() => setLoading(false));
  }, []);

  // Open a loan: scope the session to its lender, then go to its detail page.
  const openLoan = async (l) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: l.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: l.brand_color }),
      );
      // Pawnbroker loans are pledges — open the pledge view.
      navigate(
        r.data.current_tenant?.kind === "pawnbroker"
          ? `/portal/pledges/${l.loan_id}`
          : `/portal/loans/${l.loan_id}`,
      );
    } catch {
      alert("Failed to open loan");
    }
  };

  // Welfare/chama links this person holds — they're a MEMBER there, not a
  // borrower, so they enter the member desk (a separate per-welfare experience).
  const welfareTenants = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_tenants") || "[]").filter(
        (t) => t?.kind === "welfare",
      );
    } catch {
      return [];
    }
  })();
  const openWelfare = async (t) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", { tenant_id: t.tenant_id });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem("portal_current_tenant", JSON.stringify(r.data.current_tenant));
      navigate("/welfare/member");
    } catch {
      alert("Failed to open chama");
    }
  };
  const WelfareCards = () =>
    welfareTenants.length === 0 ? null : (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <h2 className="font-bold text-navy-900 mb-3 flex items-center gap-2">
          <PiggyBank size={18} className="text-emerald-600" /> My chamas &amp; welfares
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {welfareTenants.map((t) => (
            <button
              key={t.tenant_id}
              onClick={() => openWelfare(t)}
              className="border-2 border-emerald-100 hover:border-emerald-300 rounded-xl px-4 py-3 text-left flex items-center justify-between transition"
            >
              <span className="font-semibold text-slate-800">{t.business_name}</span>
              <span className="text-emerald-600 font-semibold inline-flex items-center gap-1">
                Open <ArrowRight size={16} />
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  if (loading) {
    return (
      <PortalLayout>
        <Spinner centered className="py-20" label="Loading…" />
      </PortalLayout>
    );
  }

  if (!d?.has_lenders) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-6">
          <WelfareCards />
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={64} />
            </div>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              Welcome{customerName ? `, ${customerName}` : ""}!
            </h1>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              Link your first lender to start borrowing and unlock your credit
              dashboard.
            </p>
            <button
              onClick={() => navigate("/lenders")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile hover:shadow-lg transition"
            >
              Browse lenders <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  const {
    rated,
    credit_score,
    risk,
    stats,
    monthly_repayments,
    loan_progress,
    status_breakdown,
  } = d;
  const scoreColor = rated ? RISK_HEX[risk?.color] || "#0e8a6e" : "#94a3b8";

  const kpis = [
    { label: "Total Borrowed", value: KES(stats.total_borrowed), icon: Coins },
    { label: "Total Repaid", value: KES(stats.total_repaid), icon: TrendingUp },
    { label: "Outstanding", value: KES(stats.outstanding), icon: Wallet },
    {
      label: "On-time Rate",
      value: stats.on_time_rate == null ? "—" : `${stats.on_time_rate}%`,
      icon: Percent,
    },
  ];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
              Hi {customerName || "there"}
            </h1>
            <p className="text-slate-500 mt-1">
              Your credit & borrowing overview across {stats.lenders} lender
              {stats.lenders !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => navigate("/lenders")}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile hover:shadow-lg transition"
          >
            <PlusCircle size={18} /> Apply for a loan
          </button>
        </div>

        <WelfareCards />

        {/* Credit score + KPIs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Credit score gauge */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
              Credit Score
            </p>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%"
                  outerRadius="100%"
                  data={[{ value: rated ? credit_score : 0 }]}
                  startAngle={220}
                  endAngle={-40}
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    angleAxisId={0}
                    tick={false}
                  />
                  <RadialBar
                    background={{ fill: "#eef2f6" }}
                    dataKey="value"
                    cornerRadius={12}
                    fill={scoreColor}
                    angleAxisId={0}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className={`font-extrabold ${rated ? "text-4xl" : "text-2xl"}`}
                  style={{ color: scoreColor }}
                >
                  {rated ? credit_score : "New"}
                </span>
                <span className="text-xs text-slate-400">
                  {rated ? "out of 100" : "unrated"}
                </span>
              </div>
            </div>
            <p
              className="text-center font-semibold mt-1"
              style={{ color: scoreColor }}
            >
              {risk?.label}
            </p>
            {rated ? (
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 text-center text-xs">
                <div>
                  <p className="font-bold text-green-600">{stats.on_time}</p>
                  <p className="text-slate-400">on-time</p>
                </div>
                <div>
                  <p className="font-bold text-amber-600">{stats.late}</p>
                  <p className="text-slate-400">late</p>
                </div>
                <div>
                  <p className="font-bold text-red-600">{stats.missed}</p>
                  <p className="text-slate-400">missed</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 pt-3 border-t border-slate-100 text-center text-xs text-slate-400">
                Make your first payment to start building your score.
              </p>
            )}
          </div>

          {/* KPI cards */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            {kpis.map((k) => (
              <div
                key={k.label}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                    {k.label}
                  </p>
                  <IconTile icon={k.icon} variant="ocean" size={36} />
                </div>
                <p className="font-bold text-navy-900 mt-3 text-xl lg:text-2xl">
                  {k.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Repayment trend */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 lg:col-span-2">
            <h2 className="font-bold text-navy-900 mb-4">
              Repayments — last 6 months
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={monthly_repayments}
                  margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="repayFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0e8a6e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0e8a6e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={kCompact}
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    formatter={(v) => [KES(v), "Repaid"]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      fontSize: 13,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#0e8a6e"
                    strokeWidth={2.5}
                    fill="url(#repayFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Loan status breakdown */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h2 className="font-bold text-navy-900 mb-2">Loans by status</h2>
            {status_breakdown.length === 0 ? (
              <p className="text-sm text-slate-400 py-12 text-center">
                No loans yet.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={status_breakdown}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {status_breakdown.map((s) => (
                        <Cell
                          key={s.status}
                          fill={STATUS_HEX[s.status] || "#94a3b8"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [v, cap(n)]}
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid #e2e8f0",
                        fontSize: 13,
                      }}
                    />
                    <Legend
                      formatter={(val) => (
                        <span className="text-xs text-slate-600">
                          {cap(val)}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Secondary counts */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Active", value: stats.active_loans, color: STATUS_HEX.active },
            {
              label: "Completed",
              value: stats.completed_loans,
              color: STATUS_HEX.completed,
            },
            {
              label: "Pending",
              value: stats.pending_loans,
              color: STATUS_HEX.pending,
            },
            {
              label: "Interest paid",
              value: KES(stats.interest_paid),
              color: "#0e8a6e",
              wide: true,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4"
            >
              <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                {s.label}
              </p>
              <p
                className={`font-bold mt-1 ${s.wide ? "text-base" : "text-2xl"}`}
                style={{ color: s.color }}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Loan repayment progress */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h2 className="font-bold text-navy-900 mb-4">Loan repayment progress</h2>
          {loan_progress.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No active loans to track.
            </p>
          ) : (
            <div className="space-y-5">
              {loan_progress.map((l) => {
                const bc = lenderColor(l.brand_color, l.tenant_id);
                const pct =
                  l.total_due > 0
                    ? Math.min(100, (l.paid / l.total_due) * 100)
                    : 0;
                return (
                  <div
                    key={l.loan_id}
                    onClick={() => openLoan(l)}
                    className="cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: bc }}
                        />
                        <span className="font-mono text-sm font-semibold text-navy-900 truncate group-hover:underline">
                          {l.loan_code}
                        </span>
                        <span className="text-xs text-slate-400 truncate hidden sm:inline">
                          · {l.lender}
                        </span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: bc }}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: bc }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[11px] text-slate-400">
                      <span>{KES(l.paid)} repaid</span>
                      <span>{KES(l.total_due)} total</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default CustomerDashboard;
