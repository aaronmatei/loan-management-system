import React from "react";
import { Navigate } from "react-router-dom";

// Guards the customer-portal pages. Mirrors the localStorage keys the
// rest of the portal uses (set by Login/Register/TenantPicker):
//   - no portal_token            -> must log in
//   - token but no current tenant -> must pick a lender first
function PortalProtectedRoute({ children }) {
  const token = localStorage.getItem("portal_token");
  if (!token) {
    return <Navigate to="/portal/login" replace />;
  }

  let currentTenant = null;
  try {
    currentTenant = JSON.parse(
      localStorage.getItem("portal_current_tenant") || "null",
    );
  } catch {
    currentTenant = null;
  }
  if (!currentTenant || !currentTenant.subdomain) {
    return <Navigate to="/portal/select-tenant" replace />;
  }

  return children;
}

export default PortalProtectedRoute;
