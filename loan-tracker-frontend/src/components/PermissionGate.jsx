import React from "react";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";

/**
 * Conditionally render children based on the current user's role.
 * Usage:
 *   <PermissionGate permission="loans:create"><button>Create</button></PermissionGate>
 *   <PermissionGate role={["admin","manager"]}>...</PermissionGate>
 */
function PermissionGate({ permission, role, children, fallback = null }) {
  const { user } = useAuth();

  if (permission && !hasPermission(user?.role, permission)) {
    return fallback;
  }

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(user?.role)) {
      return fallback;
    }
  }

  return <>{children}</>;
}

export default PermissionGate;
