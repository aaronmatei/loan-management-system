import React, { useEffect, useState } from "react";

// Always-visible reminder of which lender the customer is viewing.
function CurrentTenantBanner() {
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    try {
      setTenant(
        JSON.parse(localStorage.getItem("portal_current_tenant") || "null"),
      );
    } catch {
      /* ignore */
    }
  }, []);

  if (!tenant?.business_name) return null;
  const color = tenant.brand_color || "#4F46E5";

  return (
    <div
      className="text-white py-2 px-4 text-center text-sm shadow-md"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
      }}
    >
      You're viewing your loans at <strong>{tenant.business_name}</strong>
    </div>
  );
}

export default CurrentTenantBanner;
