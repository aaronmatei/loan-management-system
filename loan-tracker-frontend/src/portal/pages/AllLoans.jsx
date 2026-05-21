import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { getPortalBrand } from "../brand";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-[var(--brand)]/15 text-[var(--brand)]",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

function AllLoans() {
  const navigate = useNavigate();
  const { brand } = getPortalBrand();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenantFilter, setTenantFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (tenantFilter !== "all") p.append("tenant_id", tenantFilter);
    if (statusFilter !== "all") p.append("status", statusFilter);
    p.append("sort", sortBy);
    portalApi
      .get(`/portal/customer/all-loans?${p}`)
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/loanfix/portal/select-tenant");
        }
      })
      .finally(() => setLoading(false));
  }, [tenantFilter, statusFilter, sortBy, navigate]);

  // Switch the active tenant session, then go where requested.
  const switchTenant = async (tenantId, to) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: tenantId,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify(r.data.current_tenant),
      );
      if (to === "dashboard") window.location.href = "/loanfix/portal/dashboard";
      else navigate(to);
    } catch {
      alert("Failed to switch lender");
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const { loans, summary } = data;
  const totalBalance = parseFloat(summary?.total_balance || 0);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-6xl mx-auto" style={{ "--brand": brand }}>
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
          📊 All My Loans
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          Every loan across all your lenders, in one place.
        </p>

        <div className="bg-gradient-to-br from-[var(--brand)] via-[var(--brand)] to-pink-600 text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <p className="text-white/85 text-sm">
            Total Active Balance Across All Lenders
          </p>
          <p className="text-4xl lg:text-5xl font-bold mt-2">
            {KES(totalBalance)}
          </p>
          <div className="flex flex-wrap gap-3 mt-4 text-sm">
            <span className="bg-white/20 rounded-lg px-3 py-1">
              🏦 {summary?.total_lenders} Lender
              {summary?.total_lenders !== 1 ? "s" : ""}
            </span>
            <span className="bg-white/20 rounded-lg px-3 py-1">
              📋 {summary?.total_loans} Loans
            </span>
            <span className="bg-white/20 rounded-lg px-3 py-1">
              🟢 {summary?.total_active} Active
            </span>
            {summary?.total_completed > 0 && (
              <span className="bg-white/20 rounded-lg px-3 py-1">
                ✅ {summary.total_completed} Completed
              </span>
            )}
            {summary?.total_defaulted > 0 && (
              <span className="bg-white/20 rounded-lg px-3 py-1">
                ⚠️ {summary.total_defaulted} Defaulted
              </span>
            )}
          </div>
        </div>

        {summary?.by_tenant?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-navy-900 mb-3">
              📈 By Lender
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.by_tenant.map((t) => {
                const bal =
                  parseFloat(t.total_due) - parseFloat(t.total_paid);
                return (
                  <div
                    key={t.tenant_id}
                    className="bg-white rounded-xl shadow p-4 relative overflow-hidden"
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-1"
                      style={{
                        backgroundColor: t.brand_color || "#4F46E5",
                      }}
                    />
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{
                          backgroundColor: t.brand_color || "#4F46E5",
                        }}
                      >
                        {t.business_name?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-navy-900 truncate">
                          {t.business_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t.active_loans} active loan
                          {t.active_loans !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Total Loans</p>
                        <p className="font-bold">{t.total_loans}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Balance</p>
                        <p className="font-bold text-red-600">
                          {KES(bal)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        switchTenant(t.tenant_id, "dashboard")
                      }
                      className="w-full mt-3 py-2 text-xs font-semibold text-white rounded"
                      style={{
                        backgroundColor: t.brand_color || "#4F46E5",
                      }}
                    >
                      View {t.business_name} Only →
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                FILTER BY LENDER
              </label>
              <select
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] bg-white"
              >
                <option value="all">All Lenders</option>
                {summary?.by_tenant?.map((t) => (
                  <option key={t.tenant_id} value={t.tenant_id}>
                    {t.business_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                FILTER BY STATUS
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="active">🟢 Active</option>
                <option value="completed">✅ Completed</option>
                <option value="defaulted">⚠️ Defaulted</option>
                <option value="pending">⏳ Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                SORT BY
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] bg-white"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="highest_balance">Highest Balance</option>
                <option value="lowest_balance">Lowest Balance</option>
              </select>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t flex flex-wrap gap-2">
            <button
              onClick={() => {
                setTenantFilter("all");
                setStatusFilter("all");
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                tenantFilter === "all" && statusFilter === "all"
                  ? "bg-[var(--brand)] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              📋 All
            </button>
            <button
              onClick={() => setStatusFilter("active")}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                statusFilter === "active"
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              🟢 Active Only
            </button>
            {summary?.by_tenant?.map((t) => (
              <button
                key={t.tenant_id}
                onClick={() => setTenantFilter(String(t.tenant_id))}
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  tenantFilter === String(t.tenant_id)
                    ? "text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
                style={
                  tenantFilter === String(t.tenant_id)
                    ? { backgroundColor: t.brand_color || "#4F46E5" }
                    : {}
                }
              >
                🏦 {t.business_name}
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          Showing {loans.length} loan{loans.length !== 1 ? "s" : ""}
        </p>

        {loans.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center text-gray-500">
            <p className="text-5xl mb-3">📭</p>
            <p>No loans match your filters.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map((loan) => {
              const due = parseFloat(loan.total_amount_due || 0);
              const paid = parseFloat(loan.total_paid || 0);
              const balance = Math.max(0, due - paid);
              const progress =
                due > 0 ? Math.min((paid / due) * 100, 100) : 0;
              const bc = loan.tenant_brand_color || "#4F46E5";
              return (
                <button
                  key={loan.id}
                  onClick={() =>
                    switchTenant(loan.tenant_id, `/loanfix/portal/loans/${loan.id}`)
                  }
                  className="w-full text-left bg-white rounded-xl shadow hover:shadow-lg transition overflow-hidden"
                >
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
                        STATUS_BADGE[loan.status] ||
                        "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {String(loan.status || "").replace("_", " ")}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-mono font-bold text-[var(--brand)] text-sm">
                          {loan.loan_code}
                        </p>
                        <p className="text-sm text-gray-700 mt-1">
                          {loan.purpose || "General loan"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Client Code</p>
                        <p className="text-xs font-mono">
                          {loan.client_code}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Principal</p>
                        <p className="font-bold">
                          {KES(loan.principal_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total Due</p>
                        <p className="font-bold">{KES(due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Paid</p>
                        <p className="font-bold text-green-600">
                          {KES(paid)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Balance</p>
                        <p className="font-bold text-red-600">
                          {KES(balance)}
                        </p>
                      </div>
                    </div>
                    {["active", "completed"].includes(loan.status) && (
                      <>
                        <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: bc,
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {progress.toFixed(1)}% repaid
                        </p>
                      </>
                    )}
                    {loan.next_payment && (
                      <div className="mt-3 pt-3 border-t flex justify-between items-center text-sm">
                        <div>
                          <p className="text-xs text-gray-500">
                            Next Payment
                          </p>
                          <p className="font-semibold">
                            {KES(loan.next_payment.amount_due)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Due</p>
                          <p className="font-semibold">
                            {new Date(
                              loan.next_payment.due_date,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2 bg-gray-50 border-t flex justify-between items-center text-xs">
                    <span className="text-gray-500">
                      📅{" "}
                      {loan.created_at
                        ? new Date(loan.created_at).toLocaleDateString()
                        : "—"}
                    </span>
                    <span className="font-semibold" style={{ color: bc }}>
                      View Details →
                    </span>
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

export default AllLoans;
