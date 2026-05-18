import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { hasPermission, getRoleBadge } from "../utils/permissions";

function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [overdueCount, setOverdueCount] = useState(0);

  const isActive = (path) => location.pathname === path;

  useEffect(() => {
    let mounted = true;
    api
      .get("/dashboard/summary")
      .then((res) => {
        if (mounted) setOverdueCount(res.data.data?.overdue_count || 0);
      })
      .catch(() => {
        /* badge is best-effort; ignore failures */
      });
    return () => {
      mounted = false;
    };
  }, []);

  const menuItems = [
    { path: "/", label: "Dashboard", icon: "📊", permission: "dashboard:view" },
    {
      path: "/clients",
      label: "Clients",
      icon: "👥",
      permission: "clients:view",
    },
    { path: "/loans", label: "Loans", icon: "💰", permission: "loans:view" },
    {
      path: "/payments",
      label: "Payments",
      icon: "💵",
      permission: "payments:view",
    },
    {
      path: "/overdue",
      label: "Overdue",
      icon: "⚠️",
      badge: overdueCount,
      permission: "overdue:view",
    },
    {
      path: "/reports",
      label: "Reports",
      icon: "📈",
      permission: "reports:view",
    },
    { path: "/sms", label: "SMS", icon: "📱", permission: "sms:send" },
    { path: "/email", label: "Email", icon: "✉️", permission: "email:send" },
    {
      path: "/audit",
      label: "Audit Log",
      icon: "🔍",
      permission: "audit:view",
    },
    { path: "/users", label: "Users", icon: "👤", roles: ["admin"] },
    { path: "/settings", label: "Settings", icon: "⚙️", roles: ["admin"] },
  ];

  // Hide nav entries the current role can't use. Backend authorize()
  // is the real gate; this is UX only.
  const visibleMenuItems = menuItems.filter((item) => {
    if (item.permission) return hasPermission(user?.role, item.permission);
    if (item.roles) return item.roles.includes(user?.role);
    return true;
  });

  const roleBadge = getRoleBadge(user?.role);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <nav className="w-64 bg-gradient-to-b from-gray-800 to-gray-900 text-white p-6 flex flex-col">
        <div className="mb-8 pb-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold">LMS</h2>
          <p className="text-gray-400 text-sm mt-1">Loan Manager</p>
        </div>

        <ul className="flex-1 space-y-2">
          {visibleMenuItems.map((item) => (
            <li key={item.path}>
              <button
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  isActive(item.path)
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="font-medium flex-1 text-left">
                  {item.label}
                </span>
                {item.badge > 0 && (
                  <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                    {item.badge}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* User info & Logout */}
        <div className="pt-6 border-t border-gray-700">
          <div className="mb-3">
            <p className="text-sm font-semibold">
              {user?.first_name} {user?.last_name}
            </p>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${roleBadge.color}`}
            >
              {roleBadge.label}
            </span>
          </div>
          <button
            onClick={logout}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export default Layout;
