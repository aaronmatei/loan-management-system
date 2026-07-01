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
  CalendarCheck,
  Smartphone,
  ListChecks,
  FileText,
  LifeBuoy,
  ChevronRight,
  CheckCircle2,
  Clock,
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
import Skeleton from "../../components/Skeleton";
import { CARD, CARD_LG, INK, MUTED, LABEL } from "../theme";

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

// A single-loan borrower sees a warm, focused view (balance hero + next
// payment + summary + quick actions); a multi-lender borrower keeps the
// credit-analytics dashboard, restyled and topped with the same next-payment
// + quick-actions cards. Both read the one `/portal/customer/analytics` call.
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const daysUntil = (d) => {
  if (!d) return null;
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
};
const dueLabel = (d) => {
  const n = daysUntil(d);
  if (n == null) return "";
  if (n < 0) return `${Math.abs(n)} days overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  return `Due in ${n} days`;
};
// Brand-tinted hero gradient — top takes the lender's brand, anchored to a
// deep green so white text always reads (per the "brand accents" decision).
const heroBg = (brand) =>
  `linear-gradient(150deg, ${brand || "#0d8f63"} 0%, #0c241c 140%)`;

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
      <div className={`${CARD} p-5`}>
        <h2 className={`font-bold ${INK} mb-3 flex items-center gap-2`}>
          <PiggyBank size={18} className="text-emerald-600" /> My chamas &amp; welfares
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {welfareTenants.map((t) => (
            <button
              key={t.tenant_id}
              onClick={() => openWelfare(t)}
              className="border-2 border-emerald-100 hover:border-emerald-300 rounded-xl px-4 py-3 text-left flex items-center justify-between transition"
            >
              <span className="font-semibold text-slate-800 dark:text-slate-100">{t.business_name}</span>
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
        <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-52 w-full rounded-[22px] lg:col-span-2" />
            <Skeleton className="h-52 w-full rounded-[22px]" />
          </div>
          <Skeleton className="h-24 w-full rounded-[18px]" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-64 w-full rounded-[18px]" />
            <Skeleton className="h-64 w-full rounded-[18px]" />
          </div>
        </div>
      </PortalLayout>
    );
  }

  if (!d?.has_lenders) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-6">
          <WelfareCards />
          <div className={`${CARD_LG} p-10 text-center`}>
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={64} />
            </div>
            <h1 className={`text-2xl font-bold ${INK} mb-2`}>
              Welcome{customerName ? `, ${customerName}` : ""}!
            </h1>
            <p className={`${MUTED} mb-6 max-w-md mx-auto`}>
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

  // Soonest upcoming instalment across active loans (enriched server-side).
  const nextPay = [...loan_progress]
    .filter((l) => l.next_payment)
    .sort((a, b) => new Date(a.next_payment.due_date) - new Date(b.next_payment.due_date))[0];

  // Single-loan mode when the borrower has exactly one active loan.
  const single = loan_progress.length === 1 ? loan_progress[0] : null;

  // Quick actions — brand-neutral surfaces, warm accent chips.
  const quickActions = [
    single && {
      label: "View full schedule",
      icon: ListChecks,
      bg: "#eaf6ef",
      fg: "#0d8f63",
      onClick: () => openLoan(single),
    },
    single && {
      label: "Download statement",
      icon: FileText,
      bg: "#fbf3e7",
      fg: "#d9892a",
      onClick: () => openLoan(single),
    },
    {
      label: "Apply for a new loan",
      icon: PlusCircle,
      bg: "#f3ecfb",
      fg: "#8b5cf0",
      onClick: () => navigate("/lenders"),
    },
    {
      label: "Get help",
      icon: LifeBuoy,
      bg: "#eef3f7",
      fg: "#5b6ef0",
      onClick: () => navigate("/portal/support"),
    },
  ].filter(Boolean);

  const QuickActions = () => (
    <div className={`${CARD} p-5`}>
      <div className={`text-[14.5px] font-extrabold ${INK} mb-3.5`}>Quick actions</div>
      <div className="flex flex-col gap-2.5">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex items-center gap-3 p-3 rounded-[13px] border border-[#ece6da] dark:border-slate-700 hover:bg-[#faf6ec] dark:hover:bg-slate-700/60 transition text-left"
          >
            <span
              className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
              style={{ background: a.bg }}
            >
              <a.icon size={18} style={{ color: a.fg }} />
            </span>
            <span className={`flex-1 text-[13.5px] font-bold ${INK}`}>{a.label}</span>
            <ChevronRight size={15} className="text-[#c3bcab]" />
          </button>
        ))}
      </div>
    </div>
  );

  // Next-payment card — reused by both modes. `pay` is a loan_progress row.
  const NextPaymentCard = ({ pay }) => {
    if (!pay?.next_payment)
      return (
        <div className={`${CARD_LG} p-6 flex flex-col`}>
          <span className={LABEL}>Next payment</span>
          <div className={`mt-4 text-[15px] font-semibold ${MUTED}`}>
            Nothing due right now — you're all caught up. 🎉
          </div>
        </div>
      );
    const brand = pay.brand_color || "#0d8f63";
    const overdue = (daysUntil(pay.next_payment.due_date) ?? 0) < 0;
    return (
      <div className={`${CARD_LG} p-6 flex flex-col`}>
        <div className="flex items-center justify-between">
          <span className={LABEL}>Next payment</span>
          <span
            className="w-10 h-10 rounded-[12px] flex items-center justify-center"
            style={{ background: overdue ? "#fbe6e4" : `${brand}1c` }}
          >
            <CalendarCheck size={20} style={{ color: overdue ? "#c0453f" : brand }} />
          </span>
        </div>
        <div className={`text-[32px] font-extrabold ${INK} mt-3.5 tracking-tight leading-none`}>
          {KES(pay.next_payment.amount)}
        </div>
        <div
          className="text-[13px] font-bold mt-1.5"
          style={{ color: overdue ? "#c0453f" : "#8a8170" }}
        >
          {dueLabel(pay.next_payment.due_date)} · {fmtDate(pay.next_payment.due_date)}
        </div>
        {loan_progress.length > 1 && (
          <div className={`text-[12px] ${MUTED} font-medium mt-0.5 font-mono`}>
            {pay.loan_code} · {pay.lender}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={() => openLoan(pay)}
          className="w-full mt-5 text-white rounded-[13px] py-3.5 font-extrabold text-[14.5px] flex items-center justify-center gap-2 transition hover:brightness-110"
          style={{ background: brand }}
        >
          <Smartphone size={18} /> Pay with M-Pesa
        </button>
      </div>
    );
  };

  // Compact credit-score card (used in single-loan mode so analytics isn't lost).
  const CreditMini = () => (
    <div className={`${CARD} p-5`}>
      <span className={LABEL}>Credit score</span>
      <div className="flex items-center gap-4 mt-1">
        <div className="relative w-24 h-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="70%"
              outerRadius="100%"
              data={[{ value: rated ? credit_score : 0 }]}
              startAngle={220}
              endAngle={-40}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background={{ fill: "#f0ebe0" }} dataKey="value" cornerRadius={10} fill={scoreColor} angleAxisId={0} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-extrabold text-xl" style={{ color: scoreColor }}>
              {rated ? credit_score : "New"}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-bold" style={{ color: scoreColor }}>
            {risk?.label}
          </p>
          {rated ? (
            <div className="flex gap-4 mt-2 text-xs">
              <span><b className="text-green-600">{stats.on_time}</b> <span className={MUTED}>on-time</span></span>
              <span><b className="text-amber-600">{stats.late}</b> <span className={MUTED}>late</span></span>
              <span><b className="text-red-600">{stats.missed}</b> <span className={MUTED}>missed</span></span>
            </div>
          ) : (
            <p className={`text-xs ${MUTED} mt-2`}>Make your first payment to start building your score.</p>
          )}
        </div>
      </div>
    </div>
  );

  const RepayTrend = () => (
    <div className={`${CARD} p-5`}>
      <h2 className={`font-bold ${INK} mb-4`}>Repayments — last 6 months</h2>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={monthly_repayments} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="repayFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0d8f63" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#0d8f63" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#a39b8b" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={kCompact} tick={{ fontSize: 12, fill: "#a39b8b" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip formatter={(v) => [KES(v), "Repaid"]} contentStyle={{ borderRadius: 12, border: "1px solid #ece6da", fontSize: 13 }} />
            <Area type="monotone" dataKey="amount" stroke="#0d8f63" strokeWidth={2.5} fill="url(#repayFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // ── SINGLE-LOAN MODE ────────────────────────────────────────────────
  if (single) {
    const pct = single.total_due > 0 ? Math.min(100, (single.paid / single.total_due) * 100) : 0;
    const brand = single.brand_color || "#0d8f63";
    const interestTotal = Math.max(0, single.total_due - (single.principal || 0));
    const nextNo = single.next_payment?.number;
    const remaining = single.term_months && nextNo ? single.term_months - (nextNo - 1) : null;
    const summary = [
      { label: "Loan amount", value: KES(single.principal), sub: single.purpose || "Loan" },
      {
        label: "Interest",
        value: single.interest_rate != null ? `${single.interest_rate}%` : "—",
        sub: `${KES(interestTotal)} total`,
      },
      {
        label: "Term",
        value: single.term_months ? `${single.term_months} months` : "—",
        sub: remaining != null ? `${remaining} remaining` : "",
      },
      { label: "Disbursed", value: fmtDate(single.disbursed_date), sub: single.lender },
    ];
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
          <WelfareCards />
          {/* Hero + next payment */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
            <div className="rounded-[22px] p-7 text-white" style={{ background: heroBg(brand) }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#8fd3b6" }}>
                  Balance remaining
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full"
                  style={{ background: "#2ee0a01f", border: "1px solid #2ee0a04d", color: "#5fe3ab" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#2ee0a0" }} />
                  {pct >= 100 ? "Cleared" : "On track"}
                </span>
              </div>
              <div className="text-[44px] font-extrabold tracking-tight mt-2 leading-none">
                {KES(single.total_due - single.paid)}
              </div>
              <div className="h-2 rounded-full overflow-hidden mt-5" style={{ background: "#ffffff1f" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: "linear-gradient(90deg,#2ee0a0,#15a371)" }}
                />
              </div>
              <div className="flex justify-between mt-2.5 text-[12px] font-semibold" style={{ color: "#8fd3b6" }}>
                <span>{KES(single.paid)} paid of {KES(single.total_due)}</span>
                <span>{pct.toFixed(0)}% cleared</span>
              </div>
            </div>
            <NextPaymentCard pay={single} />
          </div>

          {/* Loan summary strip */}
          <div className={`${CARD} grid grid-cols-2 lg:grid-cols-4`}>
            {summary.map((s, i) => (
              <div
                key={s.label}
                className={`p-[18px] ${i < summary.length - 1 ? "border-r border-[#f0ebe0] dark:border-slate-700" : ""} ${i < 2 ? "border-b lg:border-b-0 border-[#f0ebe0] dark:border-slate-700" : ""}`}
              >
                <div className={LABEL}>{s.label}</div>
                <div className={`text-[18px] font-extrabold ${INK} mt-1.5 tabular-nums`}>{s.value}</div>
                <div className={`text-[11.5px] ${MUTED} font-medium mt-0.5 truncate`}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Next instalment + quick actions */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
            <div className={`${CARD} p-[22px]`}>
              <div className="flex items-center justify-between mb-3.5">
                <div className={`text-[14.5px] font-extrabold ${INK}`}>Your instalment</div>
                <button onClick={() => openLoan(single)} className="text-[12.5px] font-bold" style={{ color: brand }}>
                  Full schedule →
                </button>
              </div>
              {single.next_payment ? (
                <div className="flex items-center gap-3.5 py-2.5">
                  <span
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                    style={{ background: `${brand}1c`, color: brand }}
                  >
                    <Clock size={17} />
                  </span>
                  <div className="flex-1">
                    <div className={`text-[13.5px] font-bold ${INK}`}>
                      {KES(single.next_payment.amount)}
                    </div>
                    <div className={`text-[12px] ${MUTED} font-medium`}>
                      Instalment {single.next_payment.number} · {fmtDate(single.next_payment.due_date)}
                    </div>
                  </div>
                  <span
                    className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg"
                    style={{ background: "#fbe6e4", color: "#c0453f" }}
                  >
                    {dueLabel(single.next_payment.due_date)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-4 text-[14px] font-semibold" style={{ color: "#0d8f63" }}>
                  <CheckCircle2 size={20} /> All instalments settled.
                </div>
              )}
            </div>
            <QuickActions />
          </div>

          {/* Credit + trend (analytics preserved) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CreditMini />
            <RepayTrend />
          </div>
        </div>
      </PortalLayout>
    );
  }

  // ── MULTI-LENDER MODE (restyled analytics) ──────────────────────────
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
      <div className="p-4 lg:p-8 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={`text-2xl lg:text-3xl font-extrabold ${INK}`}>
              Hi {customerName || "there"}
            </h1>
            <p className={`${MUTED} mt-1`}>
              Your credit &amp; borrowing overview across {stats.lenders} lender
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

        {/* Next payment + quick actions (design bits, multi-lender data) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
          <NextPaymentCard pay={nextPay} />
          <QuickActions />
        </div>

        {/* Credit score + KPIs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${CARD} p-5`}>
            <p className={LABEL}>Credit Score</p>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="72%"
                  outerRadius="100%"
                  data={[{ value: rated ? credit_score : 0 }]}
                  startAngle={220}
                  endAngle={-40}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background={{ fill: "#f0ebe0" }} dataKey="value" cornerRadius={12} fill={scoreColor} angleAxisId={0} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-extrabold ${rated ? "text-4xl" : "text-2xl"}`} style={{ color: scoreColor }}>
                  {rated ? credit_score : "New"}
                </span>
                <span className={`text-xs ${MUTED}`}>{rated ? "out of 100" : "unrated"}</span>
              </div>
            </div>
            <p className="text-center font-semibold mt-1" style={{ color: scoreColor }}>
              {risk?.label}
            </p>
            {rated ? (
              <div className="mt-3 pt-3 border-t border-[#f0ebe0] dark:border-slate-700 grid grid-cols-3 text-center text-xs">
                <div><p className="font-bold text-green-600">{stats.on_time}</p><p className={MUTED}>on-time</p></div>
                <div><p className="font-bold text-amber-600">{stats.late}</p><p className={MUTED}>late</p></div>
                <div><p className="font-bold text-red-600">{stats.missed}</p><p className={MUTED}>missed</p></div>
              </div>
            ) : (
              <p className={`mt-3 pt-3 border-t border-[#f0ebe0] dark:border-slate-700 text-center text-xs ${MUTED}`}>
                Make your first payment to start building your score.
              </p>
            )}
          </div>

          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            {kpis.map((k) => (
              <div key={k.label} className={`${CARD} p-5 flex flex-col justify-between`}>
                <div className="flex items-start justify-between">
                  <p className={LABEL}>{k.label}</p>
                  <IconTile icon={k.icon} variant="ocean" size={36} />
                </div>
                <p className={`font-extrabold ${INK} mt-3 text-xl lg:text-2xl`}>{k.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${CARD} p-5 lg:col-span-2`}>
            <h2 className={`font-bold ${INK} mb-4`}>Repayments — last 6 months</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly_repayments} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="repayFill2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d8f63" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d8f63" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#a39b8b" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={kCompact} tick={{ fontSize: 12, fill: "#a39b8b" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v) => [KES(v), "Repaid"]} contentStyle={{ borderRadius: 12, border: "1px solid #ece6da", fontSize: 13 }} />
                  <Area type="monotone" dataKey="amount" stroke="#0d8f63" strokeWidth={2.5} fill="url(#repayFill2)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${CARD} p-5`}>
            <h2 className={`font-bold ${INK} mb-2`}>Loans by status</h2>
            {status_breakdown.length === 0 ? (
              <p className={`text-sm ${MUTED} py-12 text-center`}>No loans yet.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={status_breakdown} dataKey="count" nameKey="status" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {status_breakdown.map((s) => (
                        <Cell key={s.status} fill={STATUS_HEX[s.status] || "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, cap(n)]} contentStyle={{ borderRadius: 12, border: "1px solid #ece6da", fontSize: 13 }} />
                    <Legend formatter={(val) => <span className="text-xs text-slate-600 dark:text-slate-400">{cap(val)}</span>} />
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
            { label: "Completed", value: stats.completed_loans, color: STATUS_HEX.completed },
            { label: "Pending", value: stats.pending_loans, color: STATUS_HEX.pending },
            { label: "Interest paid", value: KES(stats.interest_paid), color: "#0d8f63", wide: true },
          ].map((s) => (
            <div key={s.label} className={`${CARD} p-4`}>
              <p className={LABEL}>{s.label}</p>
              <p className={`font-extrabold mt-1 ${s.wide ? "text-base" : "text-2xl"}`} style={{ color: s.color }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Loan repayment progress */}
        <div className={`${CARD} p-5`}>
          <h2 className={`font-bold ${INK} mb-4`}>Loan repayment progress</h2>
          {loan_progress.length === 0 ? (
            <p className={`text-sm ${MUTED} py-6 text-center`}>No active loans to track.</p>
          ) : (
            <div className="space-y-5">
              {loan_progress.map((l) => {
                const bc = lenderColor(l.brand_color, l.tenant_id);
                const pct = l.total_due > 0 ? Math.min(100, (l.paid / l.total_due) * 100) : 0;
                return (
                  <div key={l.loan_id} onClick={() => openLoan(l)} className="cursor-pointer group">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: bc }} />
                        <span className={`font-mono text-sm font-semibold ${INK} truncate group-hover:underline`}>
                          {l.loan_code}
                        </span>
                        <span className={`text-xs ${MUTED} truncate hidden sm:inline`}>· {l.lender}</span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: bc }}>{pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-3 bg-[#f0ebe0] dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: bc }} />
                    </div>
                    <div className={`flex justify-between mt-1 text-[11px] ${MUTED}`}>
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
