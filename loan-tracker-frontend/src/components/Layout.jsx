import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { hasPermission, getRoleBadge } from "../utils/permissions";
import NotificationBell from "./NotificationBell";

// ── Sidebar nav data ────────────────────────────────────────────────
// Standalone items render at the top of the nav, ungrouped. Everything
// else is bucketed into a collapsible group. Each entry keeps the same
// `permission` / `roles` gate the previous flat menu had so role
// visibility is preserved exactly — backend `authorize()` is still the
// real gate; this is UX only.
const standaloneItems = [
  // Dashboard's path is "/" — match it EXACTLY so it doesn't light up
  // on every page (startsWith("/") would be always-true).
  { path: "/", label: "Dashboard", icon: "📊", permission: "dashboard:view", exact: true },
  { path: "/analytics", label: "Analytics", icon: "📈", permission: "dashboard:view" },
];

const navGroups = [
  {
    id: "lending",
    label: "Lending",
    items: [
      { path: "/clients", label: "Clients", icon: "👥", permission: "clients:view" },
      { path: "/applications", label: "Applications", icon: "📋", permission: "loans:view" },
      { path: "/loans", label: "Loans", icon: "💰", permission: "loans:view" },
      { path: "/payments", label: "Payments", icon: "💵", permission: "payments:view" },
      // badgeKey lets renderItem read the live count (overdueCount) without
      // baking a number into the static config.
      { path: "/overdue", label: "Overdue", icon: "⚠️", permission: "overdue:view", badgeKey: "overdue" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { path: "/reports", label: "Reports", icon: "📊", permission: "reports:view" },
      { path: "/exports", label: "Exports", icon: "⬇️", permission: "reports:view" },
      { path: "/audit", label: "Audit Log", icon: "🔍", permission: "audit:view" },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    items: [
      { path: "/sms", label: "SMS", icon: "📱", permission: "sms:send" },
      { path: "/email", label: "Email", icon: "✉️", permission: "email:send" },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    items: [
      { path: "/referrals", label: "Refer & Earn", icon: "🎁", roles: ["admin"] },
      { path: "/white-label", label: "White Label", icon: "🎨", roles: ["admin"] },
      { path: "/embed", label: "Embed Widget", icon: "🧮", roles: ["admin"] },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { path: "/users", label: "Users", icon: "👤", roles: ["admin"] },
      { path: "/backup", label: "Backup", icon: "💾", roles: ["admin"] },
      { path: "/settings", label: "Settings", icon: "⚙️", roles: ["admin"] },
    ],
  },
];

const STORAGE_KEY = "sidebar_expanded_groups";

const itemVisible = (item, role) => {
  if (item.permission) return hasPermission(role, item.permission);
  if (item.roles) return item.roles.includes(role);
  return true;
};

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

  // Active matcher. Dashboard "/" wants exact; everything else uses
  // startsWith so /clients/123/profile still highlights Clients.
  const isActive = (path, exact) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  // Which group contains the current page (or null if we're on a
  // standalone route or off-menu). Drives auto-expand on first paint
  // and on every navigation.
  const activeGroupId = (() => {
    for (const g of navGroups) {
      if (g.items.some((it) => isActive(it.path))) return g.id;
    }
    return null;
  })();

  // Role-filtered: drop items the user can't see, and drop empty
  // groups so their headers don't render at all.
  const visibleStandalone = standaloneItems.filter((it) =>
    itemVisible(it, user?.role),
  );
  const visibleGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => itemVisible(it, user?.role)),
    }))
    .filter((g) => g.items.length > 0);

  // Expand/collapse state. Persists across reloads. The active group
  // is ALWAYS forced open on load — even if the user collapsed it
  // last session — so the user never lands on a hidden current page.
  const [expandedGroups, setExpandedGroups] = useState(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      saved = {};
    }
    if (activeGroupId) saved[activeGroupId] = true;
    return saved;
  });

  // On every navigation, re-open the active group if it isn't already.
  // Doesn't touch other groups — user-collapsed siblings stay closed.
  useEffect(() => {
    if (!activeGroupId) return;
    setExpandedGroups((prev) =>
      prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true },
    );
  }, [activeGroupId]);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expandedGroups));
    } catch {
      /* quota / private-mode — non-fatal */
    }
  }, [expandedGroups]);

  const toggleGroup = (id) =>
    setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const roleBadge = getRoleBadge(user?.role);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const getCurrentPageTitle = () => {
    const all = [
      ...visibleStandalone,
      ...visibleGroups.flatMap((g) => g.items),
    ];
    const current = all.find((it) => isActive(it.path, it.exact));
    if (current) return `${current.icon} ${current.label}`;
    if (location.pathname.startsWith("/clients/")) return "👥 Client";
    if (location.pathname.startsWith("/loans/")) return "💰 Loan";
    return "LMS";
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // ── Render helpers ─────────────────────────────────────────────────
  // Shared link classes — same indigo-active / gray-inactive treatment
  // as before. `indent` slips items inside a group over one notch so
  // the hierarchy reads at a glance.
  const linkClass = (active) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg transition ${
      active
        ? "bg-indigo-600 text-white font-semibold"
        : "text-gray-300 hover:bg-gray-700 hover:text-white"
    }`;

  const renderItem = (item, indent = false) => {
    const active = isActive(item.path, item.exact);
    const badge =
      item.badgeKey === "overdue" ? overdueCount : item.badge ?? 0;
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          className={`${linkClass(active)} ${indent ? "ml-2" : ""}`}
        >
          <span className="text-xl">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {badge > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
              {badge}
            </span>
          )}
        </Link>
      </li>
    );
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
            {/* Standalone (Dashboard + Analytics) */}
            <ul className="space-y-1">
              {visibleStandalone.map((it) => renderItem(it))}
            </ul>

            {/* Collapsible groups */}
            {visibleGroups.map((g) => {
              const isExpanded = !!expandedGroups[g.id];
              const hasActive = g.items.some((it) => isActive(it.path));
              return (
                <div key={g.id} className="pt-3">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`navgroup-${g.id}`}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition ${
                      hasActive ? "text-indigo-300" : "text-gray-500"
                    } hover:text-gray-200`}
                  >
                    <span>{g.label}</span>
                    <span
                      className={`text-base leading-none transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  </button>
                  <div
                    id={`navgroup-${g.id}`}
                    className={`overflow-hidden transition-all duration-200 ${
                      isExpanded
                        ? "max-h-[500px] opacity-100 mt-1"
                        : "max-h-0 opacity-0"
                    }`}
                  >
                    <ul className="space-y-1">
                      {g.items.map((it) => renderItem(it, true))}
                    </ul>
                  </div>
                </div>
              );
            })}
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
              <NotificationBell />
            </div>
          </header>

          {/* Desktop top bar (notification bell) */}
          <header className="hidden lg:flex bg-white border-b border-gray-200 shadow-sm">
            <div className="flex-1 flex items-center justify-end px-8 py-3">
              <NotificationBell />
            </div>
          </header>

          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
  );
}

export default Layout;
