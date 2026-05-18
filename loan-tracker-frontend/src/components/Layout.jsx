import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { hasPermission, getRoleBadge } from "../utils/permissions";

function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);

  // Overdue badge — best-effort, ignore failures (preserved feature)
  useEffect(() => {
    let mounted = true;
    api
      .get("/dashboard/summary")
      .then((res) => {
        if (mounted) setOverdueCount(res.data.data?.overdue_count || 0);
      })
      .catch(() => {});
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
    { path: "/backup", label: "Backup", icon: "💾", roles: ["admin"] },
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

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const getCurrentPageTitle = () => {
    const current = visibleMenuItems.find(
      (item) => item.path === location.pathname,
    );
    if (current) return `${current.icon} ${current.label}`;
    if (location.pathname.startsWith("/clients/")) return "👥 Client";
    if (location.pathname.startsWith("/loans/")) return "💰 Loan";
    return "LMS";
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, static on lg+ */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-gradient-to-b from-gray-800 to-gray-900 text-white transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } flex flex-col`}
      >
        <div className="p-6 pb-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">LMS</h2>
            <p className="text-gray-400 text-xs">Loan Manager</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white text-2xl"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-1">
            {visibleMenuItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                    location.pathname === item.path
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-gray-300 hover:bg-gray-700 hover:text-white"
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge > 0 && (
                    <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-gray-700">
          <div className="mb-3">
            <p className="text-sm font-semibold truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${roleBadge.color}`}
            >
              {roleBadge.label}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition"
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <header className="lg:hidden bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              aria-label="Open menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-800">
              {getCurrentPageTitle()}
            </h1>
            <div className="w-10" />
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export default Layout;
