import React, { useState, useEffect, useRef } from "react";
import portalApi from "../services/portalApi";

function TenantSwitcher() {
  const [showDropdown, setShowDropdown] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [currentTenant, setCurrentTenant] = useState(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setTenants(JSON.parse(localStorage.getItem("portal_tenants") || "[]"));
    setCurrentTenant(
      JSON.parse(localStorage.getItem("portal_current_tenant") || "null"),
    );
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const switchTenant = async (tenant) => {
    if (
      tenant.tenant_id ===
      (currentTenant?.tenant_id || currentTenant?.id)
    ) {
      setShowDropdown(false);
      return;
    }
    try {
      const res = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: tenant.tenant_id,
      });
      localStorage.setItem("portal_token", res.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify(res.data.current_tenant),
      );
      window.location.href = "/portal/dashboard";
    } catch {
      alert("Failed to switch tenant");
    }
  };

  if (tenants.length <= 1) return null;

  const currentId = currentTenant?.tenant_id || currentTenant?.id;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white"
      >
        <span>{currentTenant?.business_name || "Switch lender"}</span>
        <span className="text-xs">⇆</span>
      </button>
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border z-50">
          <div className="p-3 border-b">
            <p className="text-xs text-gray-500">SWITCH LENDER</p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {tenants.map((tenant) => (
              <button
                key={tenant.tenant_id}
                onClick={() => switchTenant(tenant)}
                className={`w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 ${
                  tenant.tenant_id === currentId ? "bg-indigo-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-800">
                      {tenant.business_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {tenant.active_loans} active loans
                    </p>
                  </div>
                  {tenant.tenant_id === currentId && (
                    <span className="text-indigo-600 text-sm">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TenantSwitcher;
