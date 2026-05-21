import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

const TABS = [
  { value: "all", label: "All", emoji: "📋" },
  { value: "active", label: "Active", emoji: "🟢" },
  { value: "completed", label: "Completed", emoji: "✅" },
  { value: "defaulted", label: "Defaulted", emoji: "⚠️" },
  { value: "pending", label: "Pending", emoji: "⏳" },
];

// My Loans is the cross-lender loan list: every loan the customer holds at
// any linked lender, in one place. Each row is colored by its own lender's
// brand_color. Opening a loan scopes the session to that lender, then goes
// to the loan detail page.
function MyLoans() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const tenantFilter = searchParams.get("tenant_id") || "all";

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (tenantFilter !== "all") p.append("tenant_id", tenantFilter);
    if (status !== "all") p.append("status", status);
    portalApi
      .get(`/portal/customer/all-loans?${p}`)
      .then((r) => setData(r.data.data))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load loans"),
      )
      .finally(() => setLoading(false));
  }, [status, tenantFilter]);

  // Scope the session to the loan's lender, then open its detail page.
  const openLoan = async (loan) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: loan.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({
          ...r.data.current_tenant,
          brand_color: loan.tenant_brand_color,
        }),
      );
      navigate(`/loanfix/portal/loans/${loan.id}`);
    } catch {
      alert("Failed to open loan");
    }
  };

  const setTenantFilter = (val) => {
    const next = new URLSearchParams(searchParams);
    if (val === "all") next.delete("tenant_id");
    else next.set("tenant_id", String(val));
    setSearchParams(next);
  };

  const loans = data?.loans || [];
  const lenders = data?.summary?.by_tenant || [];

  // client_code per lender isn't in the loans summary — pull it from the
  // lender list cached at login so each "Your Lenders" card can show it.
  const linkInfo = (() => {
    try {
      const map = {};
      JSON.parse(localStorage.getItem("portal_tenants") || "[]").forEach(
        (t) => (map[t.tenant_id] = t),
      );
      return map;
    } catch {
      return {};
    }
  })();

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 mb-1">
          💰 My Loans
        </h1>
        <p className="text-slate-500 mb-5">
          Every loan across all your lenders, in one place
        </p>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-2 mb-3 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition ${
                status === t.value
                  ? "bg-ocean-gradient text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {/* Your Lenders — your account at each lender (tap to filter) */}
        {lenders.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-navy-900 uppercase tracking-wide">
                Your Lenders
              </h2>
              {tenantFilter !== "all" && (
                <button
                  onClick={() => setTenantFilter("all")}
                  className="text-xs font-semibold text-ocean-600 hover:text-ocean-700"
                >
                  Show all
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {lenders.map((t) => {
                const bc = t.brand_color || "#0086cc";
                const bal =
                  parseFloat(t.total_due || 0) - parseFloat(t.total_paid || 0);
                const info = linkInfo[t.tenant_id] || {};
                const active = tenantFilter === String(t.tenant_id);
                return (
                  <button
                    key={t.tenant_id}
                    onClick={() =>
                      setTenantFilter(active ? "all" : t.tenant_id)
                    }
                    className={`text-left bg-white rounded-xl p-3 border-2 transition ${
                      active
                        ? ""
                        : "border-transparent shadow-sm hover:shadow"
                    }`}
                    style={active ? { borderColor: bc } : undefined}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: bc }}
                      >
                        {t.business_name?.charAt(0)}
                      </div>
                      <p className="font-semibold text-navy-900 text-sm truncate">
                        {t.business_name}
                      </p>
                    </div>
                    {info.client_code && (
                      <p className="text-[11px] text-slate-500 font-mono">
                        {info.client_code}
                      </p>
                    )}
                    <div className="flex justify-between mt-1 text-xs">
                      <span className="text-slate-500">
                        {t.active_loans} active
                      </span>
                      <span className="font-semibold text-red-600">
                        {KES(Math.max(0, bal))}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            Loading…
          </div>
        ) : loans.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            <p className="text-5xl mb-3">📭</p>
            <p>No loans found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map((loan) => {
              const due = parseFloat(loan.total_amount_due || 0);
              const paid = parseFloat(loan.total_paid || 0);
              const balance = Math.max(0, due - paid);
              const progress = due > 0 ? Math.min((paid / due) * 100, 100) : 0;
              const bc = loan.tenant_brand_color || "#0086cc";
              return (
                <button
                  key={loan.id}
                  onClick={() => openLoan(loan)}
                  className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition overflow-hidden"
                >
                  {/* Lender banner */}
                  <div
                    className="px-4 py-2 flex justify-between items-center"
                    style={{
                      backgroundColor: `${bc}15`,
                      borderLeft: `4px solid ${bc}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: bc }}
                      >
                        {loan.tenant_name?.charAt(0)}
                      </div>
                      <span
                        className="font-semibold text-sm"
                        style={{ color: bc }}
                      >
                        {loan.tenant_name}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold capitalize ${
                        STATUS_BADGE[loan.status] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {String(loan.status || "").replace("_", " ")}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-mono font-bold" style={{ color: bc }}>
                          {loan.loan_code || `#${loan.id}`}
                        </p>
                        <p className="text-sm text-gray-500">
                          {loan.purpose || "Loan"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Principal</p>
                        <p className="font-bold">{KES(loan.principal_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total Due</p>
                        <p className="font-bold">{KES(due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Paid</p>
                        <p className="font-bold text-green-600">{KES(paid)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Balance</p>
                        <p className="font-bold text-red-600">{KES(balance)}</p>
                      </div>
                    </div>
                    {["active", "completed"].includes(loan.status) && (
                      <>
                        <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full"
                            style={{ width: `${progress}%`, backgroundColor: bc }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {progress.toFixed(1)}% repaid
                        </p>
                      </>
                    )}
                    <div className="mt-3 pt-3 border-t flex justify-between items-center text-xs text-gray-500">
                      <span>
                        📅{" "}
                        {loan.created_at
                          ? new Date(loan.created_at).toLocaleDateString()
                          : "—"}
                      </span>
                      <span className="font-semibold" style={{ color: bc }}>
                        View Details →
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default MyLoans;
