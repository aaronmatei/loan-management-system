import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

// Wrapper for /admin/* routes. The backend platform routes already
// require is_platform_admin (see middleware/tenantContext.js
// requirePlatformAdmin), so this is UX scaffolding — keep staff
// users out of pages that would 403 anyway.
function PlatformAdminRoute({ children }) {
  const { user } = useAuth();
  // Send unauthed visitors to the platform-admin door, not the staff
  // one — they ended up at /admin/* for a reason.
  if (!user) return <Navigate to="/admin/login" replace />;
  if (!user.is_platform_admin) return <Navigate to="/" replace />;
  return children;
}

export default PlatformAdminRoute;
