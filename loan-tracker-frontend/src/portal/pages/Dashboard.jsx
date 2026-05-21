import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet,
  CheckCircle2,
  Coins,
  CalendarClock,
  FileText,
  Layers,
  Calculator,
  ArrowRight,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import BrandTile from "../components/BrandTile";
import { getPortalBrand } from "../brand";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

function CustomerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Quick Calculator state — calc widget at the bottom of the dashboard
  const [calcPolicy, setCalcPolicy] = useState(null);
  const [calcAmount, setCalcAmount] = useState(50000);
  const [calcDuration, setCalcDuration] = useState(6);

  // White-label theme: every accent derives from the current lender's color.
  const { brand, gradient: brandGradient, rgba } = getPortalBrand();
  const Tile = ({ icon, size = 40 }) => <BrandTile icon={icon} size={size} />;

  // Tenant-less customers (just registered / no lender linked yet) have no
  // current tenant — show an "add your first lender" prompt instead of
  // calling the tenant-scoped dashboard endpoint.
  const hasLender = (() => {
    try {
      return !!JSON.parse(
        localStorage.getItem("portal_current_tenant") || "null",
      );
    } catch {
      return false;
    }
  })();
  const customerName = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_customer") || "{}")
        .first_name;
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    if (!hasLender) {
      setLoading(false);
      return;
    }
    portalApi
      .get("/portal/customer/dashboard")
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/loanfix/portal/select-tenant");
        } else {
          alert(err.response?.data?.error || "Failed to load dashboard");
        }
      })
      .finally(() => setLoading(false));
    // Best-effort fetch for the Quick Calculator. If it fails (e.g. no
    // active link yet), the widget simply hides itself.
    portalApi
      .get("/portal/customer/calculator-policies")
      .then((r) => {
        const list = r.data.data || [];
        const current = (() => {
          try {
            return JSON.parse(
              localStorage.getItem("portal_current_tenant") || "{}",
            );
          } catch {
            return {};
          }
        })();
        const pick =
          list.find((t) => t.tenant_id === current?.id) || list[0] || null;
        setCalcPolicy(pick);
      })
      .catch(() => {});
  }, [navigate]);

  // Live compute (memo-light — three primitives so this is fine inline)
  const calcResult = (() => {
    if (!calcPolicy || !calcAmount || !calcDuration) return null;
    const p = parseFloat(calcAmount);
    const m = parseInt(calcDuration, 10);
    const r = parseFloat(calcPolicy.default_interest_rate) / 12 / 100;
    const interest = p * r * m;
    const total = p + interest;
    return { monthly: total / m, interest, total };
  })();

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!hasLender) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
            <div className="text-6xl mb-4">🏦</div>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              Welcome{customerName ? `, ${customerName}` : ""}! 👋
            </h1>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              You haven't linked a lender yet. Add your first lender to view
              your loans, apply, and make payments.
            </p>
            <button
              onClick={() => navigate("/loanfix/portal/add-lender")}
              className="inline-flex items-center gap-2 px-6 py-3 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition"
              style={{ background: brandGradient }}
            >
              ➕ Add Your First Lender
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }
  if (!data) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-slate-500">No data.</div>
      </PortalLayout>
    );
  }

  const { client, active_loans, next_payment, stats, pending_applications } =
    data;

  let lenderCount = 0;
  try {
    lenderCount = JSON.parse(
      localStorage.getItem("portal_tenants") || "[]",
    ).length;
  } catch {
    lenderCount = 0;
  }

  const kpis = [
    { label: "Active Loans", value: stats?.active_loans || 0, icon: Wallet },
    {
      label: "Completed",
      value: stats?.completed_loans || 0,
      icon: CheckCircle2,
    },
    {
      label: "Active Due",
      value: KES(stats?.active_total_due),
      icon: Coins,
      small: true,
    },
    {
      label: "Next Payment",
      value: next_payment
        ? `${KES(next_payment.amount_due)} · ${new Date(
            next_payment.due_date,
          ).toLocaleDateString()}`
        : "—",
      icon: CalendarClock,
      small: true,
    },
  ];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
            Hi {client?.first_name} 👋
          </h1>
          <p className="text-slate-500 mt-1">{client?.client_code}</p>
        </div>

        {/* Primary actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/loanfix/portal/apply")}
            className="text-white py-4 px-6 rounded-2xl shadow-md hover:shadow-lg transition flex items-center justify-between"
            style={{ background: brandGradient }}
          >
            <span className="flex items-center gap-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                <FileText size={20} color="#fff" />
              </span>
              <span className="text-left">
                <span className="block font-bold text-lg">Apply for New Loan</span>
                <span className="block text-sm text-white/80">
                  Quick approval • 24–48 hours
                </span>
              </span>
            </span>
            <ArrowRight size={22} />
          </button>

          {lenderCount > 1 && (
            <button
              onClick={() => navigate("/loanfix/portal/all-loans")}
              className="bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition flex items-center justify-between px-6 py-4"
            >
              <span className="flex items-center gap-3">
                <Tile icon={Layers} size={40} />
                <span className="text-left">
                  <span className="block font-bold text-navy-900">
                    All Loans
                  </span>
                  <span className="block text-sm text-slate-500">
                    Across all your lenders
                  </span>
                </span>
              </span>
              <ArrowRight size={20} style={{ color: brand }} />
            </button>
          )}
        </div>

        {/* KPI cards — white rounded cards with brand gradient tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                  {k.label}
                </p>
                <Tile icon={k.icon} size={36} />
              </div>
              <p
                className={`font-bold text-navy-900 mt-3 ${
                  k.small ? "text-base" : "text-2xl lg:text-3xl"
                }`}
              >
                {k.value}
              </p>
            </div>
          ))}
        </div>

        {/* Active loans */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <h2 className="px-5 py-4 font-bold text-navy-900 border-b border-slate-100">
            Active Loans
          </h2>
          {active_loans?.length ? (
            active_loans.map((l) => (
              <button
                key={l.id}
                onClick={() => navigate(`/loanfix/portal/loans/${l.id}`)}
                className="w-full text-left px-5 py-4 border-b border-slate-50 last:border-0 flex justify-between hover:bg-slate-50 transition"
              >
                <div>
                  <p className="font-mono text-sm font-semibold" style={{ color: brand }}>
                    {l.loan_code}
                  </p>
                  <p className="text-xs text-slate-500">
                    Principal {KES(l.principal_amount)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-navy-900">
                    Paid {KES(l.total_paid)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Due {KES(l.total_amount_due)}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <p className="px-5 py-6 text-slate-500 text-sm">No active loans.</p>
          )}
        </section>

        {/* Quick calculator */}
        {calcPolicy && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-navy-900 flex items-center gap-2">
                <Calculator size={18} style={{ color: brand }} /> Quick Loan
                Calculator
              </h2>
              <button
                onClick={() => navigate("/loanfix/portal/calculator")}
                className="text-xs font-semibold hover:underline"
                style={{ color: brand }}
              >
                Open full calculator →
              </button>
            </div>
            <div className="p-5 grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Amount (KES)
                  </label>
                  <input
                    type="number"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(e.target.value)}
                    min={calcPolicy.min_amount}
                    max={calcPolicy.max_amount}
                    step="1000"
                    onFocus={(e) => (e.target.style.borderColor = brand)}
                    onBlur={(e) => (e.target.style.borderColor = "")}
                    className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:outline-none font-bold text-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Duration
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 3, 6, 12, 18, 24].map((m) => {
                      const active = calcDuration === m;
                      return (
                        <button
                          key={m}
                          onClick={() => setCalcDuration(m)}
                          className={`py-2 rounded-lg text-sm font-semibold transition ${
                            active
                              ? "text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                          style={active ? { backgroundColor: brand } : undefined}
                        >
                          {m}mo
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div
                className="rounded-xl p-4 flex flex-col justify-between"
                style={{ backgroundColor: rgba(0.07) }}
              >
                {calcResult ? (
                  <>
                    <div>
                      <p className="text-xs text-slate-600">Monthly Payment</p>
                      <p className="text-2xl font-bold" style={{ color: brand }}>
                        {KES(calcResult.monthly)}
                      </p>
                      <div className="mt-2 space-y-1 text-xs">
                        <p className="text-slate-600">
                          Total interest:{" "}
                          <span className="font-semibold text-orange-600">
                            {KES(calcResult.interest)}
                          </span>
                        </p>
                        <p className="text-slate-600">
                          Total to repay:{" "}
                          <span className="font-semibold text-navy-900">
                            {KES(calcResult.total)}
                          </span>
                        </p>
                        <p className="text-slate-500">
                          @ {calcPolicy.default_interest_rate}% p.a.
                          {calcPolicy.business_name
                            ? ` · ${calcPolicy.business_name}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        navigate(
                          `/loanfix/portal/apply?amount=${calcAmount}&duration=${calcDuration}`,
                        )
                      }
                      className="mt-3 w-full py-2 text-white font-bold rounded-lg text-sm"
                      style={{ background: brandGradient }}
                    >
                      Apply for This Loan →
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">
                    Enter amount and duration.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Applications */}
        {pending_applications?.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <h2 className="px-5 py-4 font-bold text-navy-900 border-b border-slate-100">
              Applications
            </h2>
            {pending_applications.map((a) => (
              <div
                key={a.id}
                className="px-5 py-3 border-b border-slate-50 last:border-0 flex justify-between text-sm"
              >
                <span className="font-mono font-semibold" style={{ color: brand }}>
                  {a.loan_code || `#${a.id}`}
                </span>
                <span className="text-navy-900">{KES(a.principal_amount)}</span>
                <span className="capitalize text-slate-600">
                  {a.status?.replace("_", " ")}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </PortalLayout>
  );
}

export default CustomerDashboard;
