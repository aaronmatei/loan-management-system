import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  ClipboardList,
  Wallet,
  CreditCard,
  AlertTriangle,
  BarChart3,
  ScrollText,
  MessageSquare,
  Mail,
  Gift,
  Palette,
  Code2,
  UserCog,
  Database,
  Settings,
  Receipt,
  Zap,
  ChevronRight,
  LogOut,
  X,
  HandCoins,
  Handshake,
  AlertOctagon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { hasPermission, getRoleBadge } from "../utils/permissions";
import NotificationBell from "./NotificationBell";
import IconTile from "./IconTile";

// ── Sidebar nav data ────────────────────────────────────────────────
// Standalone items render at the top of the nav, ungrouped. Everything
// else is bucketed into a collapsible group. Each entry keeps the same
// `permission` / `roles` gate the previous flat menu had so role
// visibility is preserved exactly — backend `authorize()` is still the
// real gate; this is UX only. `icon` is a lucide component; `variant`
// picks the gradient-tile hue (per-group for a little life).
const standaloneItems = [
  // Dashboard's path is "/" — match it EXACTLY so it doesn't light up
  // on every page (startsWith("/") would be always-true).
  { path: "/", label: "Dashboard", icon: LayoutDashboard, variant: "ocean", permission: "dashboard:view", exact: true },
  // Clients promoted to top-level — it's the entity the whole loan
  // workflow refers back to, so it deserves a single-click slot rather
  // than living inside a group with the loan items it intersects.
  { path: "/clients", label: "Clients", icon: Users, variant: "ocean", permission: "clients:view" },
];

const navGroups = [
  {
    // LOANS = origination → collection workflow, top to bottom:
    //   Applications (intake) → Loans (book) → Payments (cash in) →
    //   Overdue (chase) → Waivers (forgive) → Promises (commit to pay).
    // Reads like a loan's lifecycle, which matches how a loan officer
    // moves through their day.
    id: "loans",
    label: "Loans",
    variant: "ocean",
    items: [
      { path: "/applications", label: "Applications", icon: ClipboardList, permission: "loans:view" },
      { path: "/loans", label: "Loans", icon: Wallet, permission: "loans:view" },
      { path: "/payments", label: "Payments", icon: CreditCard, permission: "payments:view" },
      // badgeKey lets renderItem read the live count (overdueCount) without
      // baking a number into the static config.
      { path: "/overdue", label: "Overdue", icon: AlertTriangle, permission: "overdue:view", badgeKey: "overdue" },
      { path: "/defaulted", label: "Defaulted", icon: AlertOctagon, permission: "loans:view" },
      { path: "/waivers", label: "Waivers", icon: HandCoins, roles: ["admin"], badgeKey: "pendingWaivers" },
      { path: "/promises", label: "Promises to Pay", icon: Handshake, permission: "loans:view" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    variant: "indigo",
    items: [
      { path: "/reports", label: "Reports", icon: BarChart3, permission: "reports:view" },
      { path: "/analytics", label: "Analytics", icon: TrendingUp, permission: "dashboard:view" },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    variant: "teal",
    items: [
      { path: "/sms", label: "SMS", icon: MessageSquare, permission: "sms:send" },
      { path: "/email", label: "Email", icon: Mail, permission: "email:send" },
      { path: "/automation", label: "Automation", icon: Zap, roles: ["admin", "manager"] },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    variant: "rose",
    items: [
      { path: "/referrals", label: "Refer & Earn", icon: Gift, roles: ["admin"] },
      { path: "/white-label", label: "White Label", icon: Palette, roles: ["admin"] },
      { path: "/embed", label: "Embed Widget", icon: Code2, roles: ["admin"] },
    ],
  },
  {
    id: "account",
    label: "Account",
    variant: "amber",
    items: [
      { path: "/users", label: "Users", icon: UserCog, roles: ["admin"] },
      { path: "/expenses", label: "Expenses & Billing", icon: Receipt, roles: ["admin", "manager"] },
      // Audit Log is a compliance/security surface, not an analytical
      // one — sits closer to Users / Settings than to Reports / Analytics.
      { path: "/audit", label: "Audit Log", icon: ScrollText, permission: "audit:view" },
      { path: "/backup", label: "Backup", icon: Database, roles: ["admin"] },
      { path: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
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
  const [pendingWaivers, setPendingWaivers] = useState(0);

  // Overdue badge — hits the dedicated /overdue/count endpoint
  // (single COUNT query, ~50ms) rather than /dashboard/summary
  // (10+ queries, ~2s) which was where the old "slow to appear"
  // came from. Re-fetches on every route change so the badge
  // clears the moment the user navigates away after recording a
  // payment — the empty-deps version only ran once at mount, so
  // the count went stale until the next full page reload.
  useEffect(() => {
    let mounted = true;
    api
      .get("/overdue/count")
      .then((res) => {
        if (mounted) setOverdueCount(res.data.count || 0);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [location.pathname]);

  // Pending-waivers badge — admin only. Tenant-scoped on the backend.
  // Same deps as the overdue badge so approving / rejecting a waiver
  // updates the count on the next route change instead of going stale
  // until a full reload.
  useEffect(() => {
    let mounted = true;
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      /* ignore */
    }
    if (user?.role !== "admin") return;
    api
      .get("/waivers/pending")
      .then((res) => {
        if (mounted) setPendingWaivers(res.data.data?.length || 0);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [location.pathname]);

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
    if (current) return current.label;
    if (location.pathname.startsWith("/clients/")) return "Client";
    if (location.pathname.startsWith("/loans/")) return "Loan";
    return "LoanFix";
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // ── Render helpers ─────────────────────────────────────────────────
  // Ocean active pill (gradient + glow) vs transparent inactive on navy.
  // `indent` slips grouped items over one notch for hierarchy.
  const linkClass = (active) =>
    `flex items-center gap-3 px-3 py-2 rounded-xl transition ${
      active
        ? "bg-ocean-gradient text-white font-semibold shadow-tile"
        : "text-ocean-100/80 hover:bg-white/5 hover:text-white"
    }`;

  const renderItem = (item, indent = false, variant = "ocean") => {
    const active = isActive(item.path, item.exact);
    const badge =
      item.badgeKey === "overdue"
        ? overdueCount
        : item.badgeKey === "pendingWaivers"
          ? pendingWaivers
          : item.badge ?? 0;
    const Icon = item.icon;
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          className={`${linkClass(active)} ${indent ? "ml-1" : ""}`}
        >
          {active ? (
            // On the gradient pill, a translucent-white tile reads cleaner
            // than a second gradient.
            <span
              className="flex items-center justify-center rounded-xl bg-white/20 shrink-0"
              style={{ width: 32, height: 32 }}
            >
              {Icon && <Icon size={16} color="#fff" strokeWidth={2.2} />}
            </span>
          ) : (
            <IconTile icon={Icon} variant={item.variant || variant} size={32} />
          )}
          <span className="flex-1 text-sm">{item.label}</span>
          {badge > 0 && (
            <span className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
              {badge}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="flex h-screen bg-app-bg">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

        {/* Sidebar — drawer on mobile, static on lg+ */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-navy-gradient text-white transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } flex flex-col`}
        >
          <div className="p-6 pb-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <IconTile icon={Wallet} variant="ocean" size={38} />
              <div>
                <h2 className="text-xl font-bold tracking-tight">LoanFix</h2>
                <p className="text-ocean-200/60 text-xs">Loan Manager</p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-ocean-200/70 hover:text-white"
              aria-label="Close menu"
            >
              <X size={22} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-4">
            {/* Standalone (Dashboard) */}
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
                      hasActive ? "text-ocean-300" : "text-ocean-300/50"
                    } hover:text-ocean-200`}
                  >
                    <span>{g.label}</span>
                    <ChevronRight
                      size={14}
                      className={`transition-transform duration-200 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    />
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
                      {g.items.map((it) => renderItem(it, true, g.variant))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="p-4 border-t border-white/10 bg-navy-950/40">
            <div className="mb-3">
              <p className="text-sm font-semibold truncate text-white">
                {user?.first_name} {user?.last_name}
              </p>
              <p className="text-xs text-ocean-200/50 truncate">{user?.email}</p>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${roleBadge.color}`}
              >
                {roleBadge.label}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full py-2 px-4 bg-white/10 hover:bg-white/15 text-ocean-100 rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2"
            >
              <LogOut size={16} /> Logout
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
