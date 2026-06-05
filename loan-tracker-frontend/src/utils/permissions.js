// Frontend permission map. Mirrors the role gating enforced on the
// backend by middleware/auth.js `authorize(...)`. This is UI-only
// (hides menus/buttons); the backend is the real security boundary.
export const PERMISSIONS = {
  admin: ["*"],
  manager: [
    "clients:view",
    "clients:create",
    "clients:edit",
    "loans:view",
    "loans:create",
    "loans:edit_status",
    "payments:view",
    "payments:create",
    "payments:refund",
    "capital:view",
    "overdue:view",
    "reports:view",
    "sms:send",
    "email:send",
    "audit:view",
    "dashboard:view",
  ],
  loan_officer: [
    "clients:view",
    "clients:create",
    "clients:edit",
    "loans:view",
    "loans:create",
    "payments:view",
    "payments:create",
    "overdue:view",
    "reports:view",
    "sms:send",
    "email:send",
    "dashboard:view",
  ],
  viewer: [
    "clients:view",
    "loans:view",
    "payments:view",
    "overdue:view",
    "reports:view",
    "dashboard:view",
  ],
};

export const hasPermission = (userRole, permission) => {
  if (!userRole) return false;
  const rolePermissions = PERMISSIONS[userRole] || [];
  if (rolePermissions.includes("*")) return true;
  return rolePermissions.includes(permission);
};

export const canAccess = (userRole, requiredRoles) => {
  if (!userRole) return false;
  return requiredRoles.includes(userRole);
};

export const getRoleBadge = (role) => {
  const badges = {
    admin: { label: "👑 Admin", color: "bg-purple-100 text-purple-700" },
    manager: { label: "📊 Manager", color: "bg-ocean-100 text-ocean-700" },
    loan_officer: {
      label: "💼 Loan Officer",
      color: "bg-green-100 text-green-700",
    },
    viewer: { label: "👁️ Viewer", color: "bg-gray-100 text-gray-700" },
  };
  return badges[role] || { label: role, color: "bg-gray-100 text-gray-700" };
};
