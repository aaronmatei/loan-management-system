import React from "react";
import { Navigate } from "react-router-dom";

// Guards the customer-portal pages. The portal is a single global account
// that aggregates lenders, so a logged-in customer may have NO lender
// selected (they pick one from the dashboard). We therefore only require a
// token here; per-lender pages redirect to the dashboard themselves when no
// lender is selected.
//
// KYC gate: when the backend flags a customer as needing identity documents
// (needs_kyc — set both at self-signup and on a lender-added client's first
// login), every page redirects to the upload screen until it's done. The
// upload screen itself passes allowIncompleteKyc so it stays reachable.
function PortalProtectedRoute({ children, allowIncompleteKyc = false }) {
  const token = localStorage.getItem("portal_token");
  if (!token) {
    return <Navigate to="/portal/login" replace />;
  }
  if (!allowIncompleteKyc) {
    let needsKyc = false;
    try {
      needsKyc =
        JSON.parse(localStorage.getItem("portal_customer") || "{}")
          .needs_kyc === true;
    } catch {
      /* ignore malformed storage */
    }
    if (needsKyc) {
      return <Navigate to="/portal/verify-identity" replace />;
    }
  }
  return children;
}

export default PortalProtectedRoute;
