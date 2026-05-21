import React from "react";
import { Navigate } from "react-router-dom";

// Guards the customer-portal pages. The portal is a single global account
// that aggregates lenders, so a logged-in customer may have NO lender
// selected (they pick one from the dashboard). We therefore only require a
// token here; per-lender pages redirect to the dashboard themselves when no
// lender is selected.
function PortalProtectedRoute({ children }) {
  const token = localStorage.getItem("portal_token");
  if (!token) {
    return <Navigate to="/loanfix/portal/login" replace />;
  }
  return children;
}

export default PortalProtectedRoute;
