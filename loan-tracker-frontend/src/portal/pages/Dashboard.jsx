import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Wallet,
  Building2,
  CheckCircle2,
  Coins,
  PlusCircle,
  ArrowRight,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

// Aggregate landing for the global customer account. Shows combined stats
// across every linked lender (LoanFix ocean chrome) plus one card per
// lender (in that lender's own brand_color). Drilling into a lender mints a
// tenant-scoped token via /select-tenant and opens that lender's loans.
function CustomerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);

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
      .get("/portal/customer/all-loans")
      .then((r) => setData(r.data.data))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load dashboard"),
      )
      .finally(() => setLoading(false));
  }, []);

  // Open a specific lender: swap to a tenant-scoped session, then go to
  // that lender's loans. Keep brand_color so the per-lender pages theme.
  const openLender = async (t) => {
    setOpening(t.tenant_id);
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: t.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: t.brand_color }),
      );
      navigate("/loanfix/portal/loans");
    } catch {
      alert("Failed to open lender");
      setOpening(null);
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </PortalLayout>
    );
  }

  const summary = data?.summary;
  const lenders = summary?.by_tenant || [];

  if (lenders.length === 0) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={64} />
            </div>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              Welcome{customerName ? `, ${customerName}` : ""}! 👋
            </h1>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              You haven't linked a lender yet. Add your first lender to view
              your loans, apply, and make payments.
            </p>
            <button
              onClick={() => navigate("/loanfix/portal/add-lender")}
              className="inline-flex items-center gap-2 px-6 py-3 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile hover:shadow-lg transition"
            >
              <PlusCircle size={18} /> Add Your First Lender
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  const kpis = [
    { label: "Active Balance", value: KES(summary.total_balance), icon: Coins },
    { label: "Active Loans", value: summary.total_active || 0, icon: Wallet },
    { label: "Lenders", value: summary.total_lenders || 0, icon: Building2 },
    {
      label: "Completed",
      value: summary.total_completed || 0,
      icon: CheckCircle2,
    },
  ];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
            Hi {customerName || "there"} 👋
          </h1>
          <p className="text-slate-500 mt-1">All your lenders in one place</p>
        </div>

        {/* Combined stats — LoanFix ocean chrome (not lender-specific) */}
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
                <IconTile icon={k.icon} variant="ocean" size={36} />
              </div>
              <p className="font-bold text-navy-900 mt-3 text-xl lg:text-2xl">
                {k.value}
              </p>
            </div>
          ))}
        </div>

        {/* Your lenders — each card in that lender's own brand_color */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-navy-900">Your Lenders</h2>
            <button
              onClick={() => navigate("/loanfix/portal/add-lender")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-600 hover:text-ocean-700"
            >
              <PlusCircle size={16} /> Add Lender
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {lenders.map((t) => {
              const bc = t.brand_color || "#0086cc";
              const balance =
                parseFloat(t.total_due || 0) - parseFloat(t.total_paid || 0);
              return (
                <button
                  key={t.tenant_id}
                  onClick={() => openLender(t)}
                  disabled={opening === t.tenant_id}
                  className="text-left bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition overflow-hidden disabled:opacity-50"
                >
                  <div className="h-1.5" style={{ backgroundColor: bc }} />
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                        style={{ backgroundColor: bc }}
                      >
                        {t.business_name?.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-navy-900 truncate">
                          {t.business_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t.active_loans} active loan
                          {t.active_loans !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-slate-500">Balance</p>
                        <p className="font-bold text-navy-900">
                          {KES(Math.max(0, balance))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Total Loans</p>
                        <p className="font-bold text-navy-900">
                          {t.total_loans}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-end text-sm font-semibold" style={{ color: bc }}>
                      {opening === t.tenant_id ? "Opening…" : "View loans"}
                      <ArrowRight size={16} className="ml-1" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </PortalLayout>
  );
}

export default CustomerDashboard;
