import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";

function TenantPicker() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [selecting, setSelecting] = useState(null);

  useEffect(() => {
    const stored = JSON.parse(
      localStorage.getItem("portal_tenants") || "[]",
    );
    const c = JSON.parse(localStorage.getItem("portal_customer") || "{}");
    if (stored.length === 0) {
      navigate("/portal/login");
      return;
    }
    setTenants(stored);
    setCustomer(c);
  }, [navigate]);

  const selectTenant = async (tenant) => {
    setSelecting(tenant.tenant_id);
    try {
      const res = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: tenant.tenant_id,
      });
      localStorage.setItem("portal_token", res.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify(res.data.current_tenant),
      );
      // A welfare account is a chama membership, not a borrower relationship —
      // land on the member desk.
      navigate(
        res.data.current_tenant?.kind === "welfare"
          ? "/welfare/member"
          : "/portal/dashboard",
      );
    } catch {
      alert("Failed to select tenant");
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ocean-600 to-purple-700 p-4">
      <div className="max-w-2xl mx-auto pt-12">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Hi {customer?.first_name}!
          </h1>
          <p className="text-ocean-100 text-lg">
            You have accounts with {tenants.length} lenders
          </p>
          <p className="text-ocean-200 text-sm mt-2">
            Select a lender to view your loans
          </p>
        </div>

        <div className="space-y-3">
          {tenants.map((tenant) => (
            <button
              key={tenant.tenant_id}
              onClick={() => selectTenant(tenant)}
              disabled={selecting === tenant.tenant_id}
              className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 hover:shadow-2xl transition transform hover:-translate-y-1 disabled:opacity-50 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl"
                    style={{
                      backgroundColor: tenant.brand_color || "#0e8a6e",
                    }}
                  >
                    {tenant.business_name?.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-gray-800 dark:text-slate-100">
                      {tenant.business_name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      Member since{" "}
                      {new Date(tenant.linked_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-ocean-600">
                    {tenant.active_loans}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">active loans</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-slate-400">
                  Client Code:{" "}
                  <span className="font-mono font-semibold">
                    {tenant.client_code}
                  </span>
                </p>
                <span className="text-ocean-600 font-semibold">View →</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("portal_token");
              navigate("/portal/login");
            }}
            className="text-ocean-100 hover:text-white text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default TenantPicker;
