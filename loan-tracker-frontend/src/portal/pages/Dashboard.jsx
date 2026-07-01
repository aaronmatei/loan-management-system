import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet,
  Building2,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  PlusCircle,
  CalendarCheck,
  Smartphone,
  ListChecks,
  CreditCard,
  LifeBuoy,
  ChevronRight,
  CheckCircle2,
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
} from "recharts";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
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

const RISK_HEX = { green: "#16a34a", yellow: "#ca8a04", orange: "#ea580c", red: "#dc2626" };

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
const daysUntil = (d) => {
  if (!d) return null;
  const ms = new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
};
const dueLabel = (d) => {
  const n = daysUntil(d);
  if (n == null) return "";
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  return `Due in ${n}d`;
};
// Brand-tinted hero gradient — anchored to a deep green so white text always
// reads. Passing no brand gives the neutral aggregate (cross-lender) hero.
const heroBg = (brand) => `linear-gradient(150deg, ${brand || "#0d8f63"} 0%, #0c241c 140%)`;

function CustomerDashboard() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  const customerName = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_customer") || "{}").first_name;
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    portalApi
      .get("/portal/customer/analytics")
      .then((r) => setD(r.data.data))
      .catch((err) => alert(err.response?.data?.error || "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  // Open a loan: scope the session to its lender, then go to its detail page.
  const openLoan = async (l) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", { tenant_id: l.tenant_id });
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

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            <Skeleton className="h-52 w-full rounded-[22px]" />
            <Skeleton className="h-52 w-full rounded-[22px]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-[18px]" />
            ))}
          </div>
        </div>
      </PortalLayout>
    );
  }

  if (!d?.has_lenders) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
          <div className={`${CARD_LG} p-10 text-center`}>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "#eaf6ef" }}>
                <Building2 size={30} className="text-[#0d8f63]" />
              </div>
            </div>
            <h1 className={`text-2xl font-extrabold ${INK} mb-2`}>
              Welcome{customerName ? `, ${customerName}` : ""}!
            </h1>
            <p className={`${MUTED} mb-6 max-w-md mx-auto`}>
              Link your first lender to start borrowing and unlock your loan dashboard.
            </p>
            <button
              onClick={() => navigate("/lenders")}
              className="inline-flex items-center gap-2 px-6 py-3 text-white font-bold rounded-[13px] transition hover:brightness-110"
              style={{ background: "#0d8f63" }}
            >
              Browse lenders <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  const { rated, credit_score, risk, stats, monthly_repayments, loan_progress } = d;
  const scoreColor = rated ? RISK_HEX[risk?.color] || "#0d8f63" : "#94a3b8";

  // Soonest upcoming instalment across active loans (enriched server-side).
  const nextPay = [...loan_progress]
    .filter((l) => l.next_payment)
    .sort((a, b) => new Date(a.next_payment.due_date) - new Date(b.next_payment.due_date))[0];

  // Single-loan mode: exactly one active loan.
  const single = loan_progress.length === 1 ? loan_progress[0] : null;

  // ── shared cards ────────────────────────────────────────────────────
  const NextPaymentCard = ({ pay }) => {
    if (!pay?.next_payment)
      return (
        <div className={`${CARD_LG} p-6 flex flex-col justify-center`}>
          <span className={LABEL}>Next payment</span>
          <div className={`mt-3 text-[15px] font-semibold ${MUTED} flex items-center gap-2`}>
            <CheckCircle2 size={18} className="text-[#0d8f63]" /> All caught up — nothing due.
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
        <div className="text-[13px] font-bold mt-1.5" style={{ color: overdue ? "#c0453f" : "#8a8170" }}>
          {dueLabel(pay.next_payment.due_date)} · {fmtDate(pay.next_payment.due_date)}
        </div>
        {loan_progress.length > 1 && (
          <div className={`text-[12px] ${MUTED} font-medium mt-0.5 font-mono truncate`}>
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

  const ActionGrid = ({ items, cols }) => (
    <div className={`grid ${cols} gap-3`}>
      {items.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className={`${CARD} flex items-center gap-3 p-3 hover:bg-[#faf6ec] dark:hover:bg-slate-700/60 transition text-left`}
        >
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: a.bg }}>
            <a.icon size={18} style={{ color: a.fg }} />
          </span>
          <span className={`flex-1 text-[13.5px] font-bold ${INK}`}>{a.label}</span>
          <ChevronRight size={15} className="text-[#c3bcab]" />
        </button>
      ))}
    </div>
  );

  const CreditMini = () => (
    <div className={`${CARD} p-5`}>
      <span className={LABEL}>Credit score</span>
      <div className="flex items-center gap-4 mt-1">
        <div className="relative w-24 h-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ value: rated ? credit_score : 0 }]} startAngle={220} endAngle={-40}>
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background={{ fill: "#f0ebe0" }} dataKey="value" cornerRadius={10} fill={scoreColor} angleAxisId={0} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-extrabold text-xl" style={{ color: scoreColor }}>
              {rated ? credit_score : "New"}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-bold" style={{ color: scoreColor }}>{risk?.label}</p>
          {rated ? (
            <div className="flex gap-3 mt-2 text-xs">
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

  // A single loan across the borrower's lenders — brand-accented card.
  const LoanCard = ({ l }) => {
    const bc = lenderColor(l.brand_color, l.tenant_id);
    const pct = l.total_due > 0 ? Math.min(100, (l.paid / l.total_due) * 100) : 0;
    const overdue = l.next_payment && (daysUntil(l.next_payment.due_date) ?? 0) < 0;
    return (
      <button onClick={() => openLoan(l)} className={`${CARD} p-5 text-left w-full hover:shadow-[0_10px_30px_-18px_rgba(15,30,60,0.25)] transition group`}>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-sm font-extrabold shrink-0" style={{ background: bc }}>
            {(l.lender || "?").charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-[13.5px] font-bold ${INK} truncate`}>{l.lender}</div>
            <div className={`text-[11.5px] ${MUTED} font-mono truncate`}>{l.loan_code}</div>
          </div>
          <ChevronRight size={16} className="text-[#c3bcab] group-hover:text-[#8a8170] transition" />
        </div>

        <div className="mt-4">
          <div className={LABEL}>Balance</div>
          <div className={`text-[22px] font-extrabold ${INK} tracking-tight leading-none mt-1`}>
            {KES(l.total_due - l.paid)}
          </div>
          <div className={`text-[11.5px] ${MUTED} font-medium mt-0.5`}>of {KES(l.total_due)}</div>
        </div>

        <div className="h-2 rounded-full overflow-hidden mt-3" style={{ background: "#f0ebe0" }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bc }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[12px] font-bold" style={{ color: bc }}>{pct.toFixed(0)}% repaid</span>
          {l.next_payment ? (
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-lg"
              style={{ background: overdue ? "#fbe6e4" : "#f0ebe0", color: overdue ? "#c0453f" : "#8a8170" }}
            >
              {dueLabel(l.next_payment.due_date)}
            </span>
          ) : (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ background: "#eaf6ef", color: "#0d8f63" }}>
              Paid up
            </span>
          )}
        </div>
      </button>
    );
  };

  // ── SINGLE-LOAN MODE ────────────────────────────────────────────────
  if (single) {
    const pct = single.total_due > 0 ? Math.min(100, (single.paid / single.total_due) * 100) : 0;
    const brand = single.brand_color || "#0d8f63";
    const interestTotal = Math.max(0, single.total_due - (single.principal || 0));
    const nextNo = single.next_payment?.number;
    const remaining = single.term_months && nextNo ? single.term_months - (nextNo - 1) : null;
    const summary = [
      { label: "Loan amount", value: KES(single.principal), sub: single.purpose || "Loan" },
      { label: "Interest", value: single.interest_rate != null ? `${single.interest_rate}%` : "—", sub: `${KES(interestTotal)} total` },
      { label: "Term", value: single.term_months ? `${single.term_months} months` : "—", sub: remaining != null ? `${remaining} remaining` : "" },
      { label: "Disbursed", value: fmtDate(single.disbursed_date), sub: single.lender },
    ];
    const actions = [
      { label: "View full schedule", icon: ListChecks, bg: "#eaf6ef", fg: "#0d8f63", onClick: () => openLoan(single) },
      { label: "Apply for a new loan", icon: PlusCircle, bg: "#f3ecfb", fg: "#8b5cf0", onClick: () => navigate("/portal/apply") },
      { label: "Get help", icon: LifeBuoy, bg: "#fbf3e7", fg: "#d9892a", onClick: () => navigate("/portal/support") },
    ];
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
            <div className="rounded-[22px] p-7 text-white" style={{ background: heroBg(brand) }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#8fd3b6" }}>Balance remaining</span>
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full" style={{ background: "#2ee0a01f", border: "1px solid #2ee0a04d", color: "#5fe3ab" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#2ee0a0" }} />
                  {pct >= 100 ? "Cleared" : "On track"}
                </span>
              </div>
              <div className="text-[44px] font-extrabold tracking-tight mt-2 leading-none">{KES(single.total_due - single.paid)}</div>
              <div className="h-2 rounded-full overflow-hidden mt-5" style={{ background: "#ffffff1f" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#2ee0a0,#15a371)" }} />
              </div>
              <div className="flex justify-between mt-2.5 text-[12px] font-semibold" style={{ color: "#8fd3b6" }}>
                <span>{KES(single.paid)} paid of {KES(single.total_due)}</span>
                <span>{pct.toFixed(0)}% cleared</span>
              </div>
            </div>
            <NextPaymentCard pay={single} />
          </div>

          {/* Outer cells' extra right/bottom hairlines tuck under the card
              border, giving clean dividers at both 2-col and 4-col. */}
          <div className={`${CARD} grid grid-cols-2 lg:grid-cols-4 overflow-hidden`}>
            {summary.map((s) => (
              <div key={s.label} className="p-[18px] border-r border-b border-[#f0ebe0] dark:border-slate-700">
                <div className={LABEL}>{s.label}</div>
                <div className={`text-[18px] font-extrabold ${INK} mt-1.5 tabular-nums`}>{s.value}</div>
                <div className={`text-[11.5px] ${MUTED} font-medium mt-0.5 truncate`}>{s.sub}</div>
              </div>
            ))}
          </div>

          <ActionGrid items={actions} cols="grid-cols-1 sm:grid-cols-3" />

          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
            <RepayTrend />
            <CreditMini />
          </div>
        </div>
      </PortalLayout>
    );
  }

  // ── MULTI-LENDER MODE — loans across lenders ────────────────────────
  const clearedPct =
    stats.total_repaid + stats.outstanding > 0
      ? Math.min(100, (stats.total_repaid / (stats.total_repaid + stats.outstanding)) * 100)
      : 0;
  const actions = [
    { label: "All my loans", icon: Wallet, bg: "#eaf6ef", fg: "#0d8f63", onClick: () => navigate("/portal/loans") },
    { label: "Payment history", icon: CreditCard, bg: "#eef3f7", fg: "#5b6ef0", onClick: () => navigate("/portal/payments") },
    { label: "Apply for a new loan", icon: PlusCircle, bg: "#f3ecfb", fg: "#8b5cf0", onClick: () => navigate("/portal/apply") },
    { label: "Get help", icon: LifeBuoy, bg: "#fbf3e7", fg: "#d9892a", onClick: () => navigate("/portal/support") },
  ];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={`text-2xl lg:text-[28px] font-extrabold ${INK}`}>Hi {customerName || "there"}</h1>
            <p className={`${MUTED} mt-1`}>
              {stats.active_loans} active loan{stats.active_loans !== 1 ? "s" : ""} across {stats.lenders} lender{stats.lenders !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => navigate("/portal/apply")}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white font-bold rounded-[12px] transition hover:brightness-110"
            style={{ background: "#0d8f63" }}
          >
            <PlusCircle size={18} /> Apply for a loan
          </button>
        </div>

        {/* Aggregate outstanding + next payment */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
          <div className="rounded-[22px] p-7 text-white" style={{ background: heroBg() }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "#8fd3b6" }}>Total outstanding</span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full" style={{ background: "#2ee0a01f", border: "1px solid #2ee0a04d", color: "#5fe3ab" }}>
                <Wallet size={13} /> {stats.active_loans} active
              </span>
            </div>
            <div className="text-[44px] font-extrabold tracking-tight mt-2 leading-none">{KES(stats.outstanding)}</div>
            <div className="h-2 rounded-full overflow-hidden mt-5" style={{ background: "#ffffff1f" }}>
              <div className="h-full rounded-full" style={{ width: `${clearedPct}%`, background: "linear-gradient(90deg,#2ee0a0,#15a371)" }} />
            </div>
            <div className="flex justify-between mt-2.5 text-[12px] font-semibold" style={{ color: "#8fd3b6" }}>
              <span>{KES(stats.total_repaid)} repaid</span>
              <span>{clearedPct.toFixed(0)}% cleared</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-6 pt-5" style={{ borderTop: "1px solid #ffffff1a" }}>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: "#ffffff14" }}>
                  <ArrowUpRight size={16} style={{ color: "#8fd3b6" }} />
                </span>
                <div>
                  <div className="text-[11px] font-semibold" style={{ color: "#8fd3b6" }}>Borrowed</div>
                  <div className="text-[15px] font-extrabold tabular-nums">{KES(stats.total_borrowed)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: "#ffffff14" }}>
                  <ArrowDownLeft size={16} style={{ color: "#5fe3ab" }} />
                </span>
                <div>
                  <div className="text-[11px] font-semibold" style={{ color: "#8fd3b6" }}>Repaid</div>
                  <div className="text-[15px] font-extrabold tabular-nums">{KES(stats.total_repaid)}</div>
                </div>
              </div>
            </div>
          </div>
          <NextPaymentCard pay={nextPay} />
        </div>

        {/* Loans across lenders — the centrepiece */}
        <div className="flex items-center justify-between pt-1">
          <h2 className={`text-[15px] font-extrabold ${INK}`}>Your loans</h2>
          <button onClick={() => navigate("/portal/loans")} className="text-[12.5px] font-bold text-[#0d8f63]">
            View all →
          </button>
        </div>
        {loan_progress.length === 0 ? (
          <div className={`${CARD} p-8 text-center ${MUTED}`}>
            No active loans right now.{" "}
            <button onClick={() => navigate("/portal/apply")} className="font-bold text-[#0d8f63]">Apply for one →</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {loan_progress.map((l) => (
              <LoanCard key={l.loan_id} l={l} />
            ))}
          </div>
        )}

        {/* Quick actions */}
        <ActionGrid items={actions} cols="grid-cols-2 lg:grid-cols-4" />

        {/* Repayment trend + credit */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
          <RepayTrend />
          <CreditMini />
        </div>
      </div>
    </PortalLayout>
  );
}

export default CustomerDashboard;
