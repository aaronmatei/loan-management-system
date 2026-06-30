import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "./Logo";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Coins,
  CalendarCheck,
  Smartphone,
  Gem,
  Gavel,
  ClipboardList,
  AlertTriangle,
  BarChart3,
  ScrollText,
  MessageSquare,
  Gift,
  UserCog,
  Settings,
  Receipt,
  FileText,
  ChevronRight,
  LogOut,
  X,
  HandCoins,
  HeartHandshake,
  LifeBuoy,
  BookOpen,
  Rocket,
  Plus,
  Minus,
  Search,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import { hasPermission, getRoleBadge } from "../utils/permissions";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";
import NavIcon, { accentOf } from "./NavIcon";

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

// Each GROUP now carries its own `icon` + accent `variant` (the design's
// round, hue-per-group icon circles). A group's `items` are a mix of:
//   • leaves — { path, label, ... } render as a dot + label
//   • sub-groups — { id, label, items: [...] } render as a collapsible
//     +/- row whose leaves nest under a left rail.
// This is the "regrouping" from the Loan Console design: the Loans workflow
// splits into Applications / Loan Book / Repayments instead of one flat list.
const navGroups = [
  {
    // LOANS = origination → collection workflow, grouped by stage:
    //   Applications (intake) → Loan Book (the book) → Repayments (cash in).
    id: "loans",
    label: "Loans",
    variant: "ocean",
    icon: HandCoins,
    items: [
      { path: "/applications", label: "Applications", permission: "loans:view" },
      {
        id: "loanbook",
        label: "Loan Book",
        items: [
          { path: "/loans", label: "All Loans", permission: "loans:view" },
          // badgeKey lets the renderer read the live count (overdueCount)
          // without baking a number into the static config.
          { path: "/overdue", label: "Overdue", permission: "overdue:view", badgeKey: "overdue" },
          { path: "/defaulted", label: "Defaulted", permission: "loans:view" },
        ],
      },
      {
        id: "repay",
        label: "Repayments",
        items: [
          { path: "/payments", label: "Payments", permission: "payments:view" },
          { path: "/waivers", label: "Waivers", roles: ["admin"], badgeKey: "pendingWaivers" },
          { path: "/promises", label: "Promises to Pay", permission: "loans:view" },
        ],
      },
      // Loan policy + packages — config for the LOANS workflow,
      // separated from /settings (company / payment details).
      { path: "/loan-settings", label: "Loan Settings", roles: ["admin"] },
    ],
  },
  {
    // COLLATERAL = the loan-against-collateral desk: pledged items, incoming
    // requests, and the auction/recovery flow when a secured loan defaults.
    // Available to every lender (collateral is a loan type, not a vertical).
    id: "collateral",
    label: "Collateral",
    variant: "emerald",
    icon: Gem,
    items: [
      { path: "/pawn/pledges", label: "Pledges", permission: "loans:view" },
      { path: "/pawn/requests", label: "Requests", permission: "loans:view" },
      { path: "/pawn/auctions", label: "Auctions", permission: "loans:view" },
      { path: "/pawn/accounting", label: "Accounting", roles: ["admin", "manager"] },
      { path: "/pawn/settings", label: "Collateral Settings", roles: ["admin"] },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    variant: "indigo",
    icon: TrendingUp,
    items: [
      { path: "/reports", label: "Reports", permission: "reports:view" },
      { path: "/books", label: "Books of Accounts", permission: "reports:view" },
      { path: "/analytics", label: "Analytics", permission: "dashboard:view" },
      { path: "/reconciliation", label: "Reconciliation", permission: "reports:view" },
    ],
  },
  {
    id: "communications",
    label: "Communications",
    variant: "teal",
    icon: MessageSquare,
    items: [
      { path: "/sms", label: "SMS", permission: "sms:send" },
      { path: "/email", label: "Email", permission: "email:send" },
      { path: "/automation", label: "Automation", roles: ["admin", "manager"] },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    variant: "rose",
    icon: Rocket,
    items: [
      { path: "/referrals", label: "Refer & Earn", roles: ["admin"] },
      { path: "/white-label", label: "White Label", roles: ["admin"] },
      { path: "/embed", label: "Embed Widget", roles: ["admin"] },
    ],
  },
  {
    id: "account",
    label: "Account",
    variant: "amber",
    icon: Settings,
    items: [
      { path: "/users", label: "Users", roles: ["admin"] },
      { path: "/expenses", label: "Expenses", roles: ["admin", "manager"] },
      { path: "/billing", label: "Platform Invoices", roles: ["admin", "manager"] },
      // Audit Log is a compliance/security surface, not an analytical
      // one — sits closer to Users / Settings than to Reports / Analytics.
      { path: "/audit", label: "Audit Log", permission: "audit:view" },
      { path: "/backup", label: "Backup", roles: ["admin"] },
      { path: "/settings", label: "Settings", roles: ["admin"] },
    ],
  },
];

// A welfare account (tenant.kind === 'welfare') gets a focused, welfare-only
// sidebar — none of the lender workflow (clients, loans, capital, billing).
// Dashboard + Members stay top-level (most-used); everything else is grouped
// into collapsible sections so the welfare sidebar isn't one long list.
const WELFARE_STANDALONE = [
  { path: "/welfare", label: "Dashboard", icon: LayoutDashboard, variant: "ocean", permission: "loans:view", exact: true },
  { path: "/welfare/members", label: "Members", icon: Users, variant: "ocean", permission: "loans:view" },
];
const WELFARE_GROUPS = [
  {
    id: "w-contributions",
    label: "Contributions & Payouts",
    variant: "ocean",
    icon: Coins,
    items: [
      { path: "/welfare/contributions", label: "Contributions", icon: Coins, permission: "loans:view" },
      { path: "/welfare/events", label: "Events", icon: HeartHandshake, permission: "loans:view" },
      { path: "/welfare/emergencies", label: "Emergencies", icon: LifeBuoy, permission: "loans:view" },
      { path: "/welfare/dividends", label: "Dividends", icon: Gift, permission: "loans:view" },
    ],
  },
  {
    id: "w-money-requests",
    label: "Money Requests",
    variant: "amber",
    icon: HandCoins,
    // "Loans" only shows when the welfare's loans switch is on; the group label
    // stays accurate ("Money Requests" = loan/withdrawal requests) either way.
    items: [
      { path: "/welfare/loans", label: "Loans", icon: HandCoins, permission: "loans:view", requiresLoans: true },
      { path: "/welfare/requests", label: "Requests", icon: ClipboardList, permission: "loans:view", badgeKey: "welfareRequests" },
    ],
  },
  {
    id: "w-governance",
    label: "Governance",
    variant: "indigo",
    icon: Gavel,
    items: [
      { path: "/welfare/meetings", label: "Meetings", icon: CalendarCheck, permission: "loans:view" },
      { path: "/welfare/decisions", label: "Decisions", icon: Gavel, permission: "loans:view" },
      { path: "/welfare/documents", label: "Documents", icon: FileText, permission: "loans:view" },
      { path: "/welfare/penalties", label: "Penalties", icon: AlertTriangle, permission: "loans:view" },
    ],
  },
  {
    id: "w-finance",
    label: "Finance & Reports",
    variant: "teal",
    icon: BarChart3,
    items: [
      { path: "/welfare/mpesa", label: "M-Pesa", icon: Smartphone, permission: "loans:view" },
      { path: "/welfare/expenses", label: "Expenses", icon: Receipt, permission: "loans:view" },
      { path: "/welfare/reports", label: "Reports", icon: BarChart3, permission: "loans:view" },
      { path: "/welfare/books", label: "Books of Accounts", icon: BookOpen, permission: "loans:view" },
    ],
  },
  {
    id: "w-comms",
    label: "Communications",
    variant: "rose",
    icon: MessageSquare,
    items: [
      { path: "/welfare/sms", label: "SMS", icon: MessageSquare, permission: "loans:view" },
    ],
  },
  {
    id: "account",
    label: "Account",
    variant: "amber",
    icon: Settings,
    items: [
      { path: "/welfare/settings", label: "Settings", icon: Settings, roles: ["admin", "manager"] },
      { path: "/users", label: "Users", icon: UserCog, roles: ["admin"] },
      { path: "/welfare/audit", label: "Audit log", icon: ScrollText, roles: ["admin", "manager"] },
      { path: "/billing", label: "Platform Invoices", icon: FileText, roles: ["admin", "manager"] },
    ],
  },
];

const STORAGE_KEY = "sidebar_expanded_groups";
const STORAGE_KEY_SUB = "sidebar_expanded_subs";

const itemVisible = (item, role) => {
  if (item.permission) return hasPermission(role, item.permission);
  if (item.roles) return item.roles.includes(role);
  return true;
};

// A group item is a sub-group if it carries its own `items` array; otherwise
// it's a leaf with a `path`. Flatten a group's items (leaves + sub-group
// leaves) into a single list of leaf paths — used for active-group detection
// and page-title lookup so a route nested in a sub-group still resolves.
const isSubGroup = (it) => Array.isArray(it.items);
const flattenLeaves = (items) =>
  items.flatMap((it) => (isSubGroup(it) ? it.items : [it]));

function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [topSearch, setTopSearch] = useState("");
  const [overdueCount, setOverdueCount] = useState(0);
  const [pendingWaivers, setPendingWaivers] = useState(0);
  // Welfare master Loans switch — drives whether the welfare nav shows the Loans
  // item. Default false so loan UI never flashes for a loans-off welfare.
  const [welfareLoansOn, setWelfareLoansOn] = useState(false);
  const [welfareRequests, setWelfareRequests] = useState(0); // pending requests needing attention

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

  // Welfare tenants: learn whether loans are enabled so the nav can hide the
  // Loans item. Re-checks on route change so toggling it in Settings takes
  // effect without a reload.
  useEffect(() => {
    let user = null;
    try { user = JSON.parse(localStorage.getItem("user") || "null"); } catch { /* */ }
    if (user?.tenant?.kind !== "welfare") return;
    let mounted = true;
    api.get("/welfare/current").then((r) => { if (!mounted) return; setWelfareLoansOn(!!r.data.data?.loans_enabled); setWelfareRequests(r.data.data?.pending_requests || 0); }).catch(() => {});
    return () => { mounted = false; };
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
  // and on every navigation. Looks through sub-groups too.
  const activeGroupId = (() => {
    for (const g of navGroups) {
      if (flattenLeaves(g.items).some((it) => isActive(it.path))) return g.id;
    }
    return null;
  })();

  // Welfare accounts get a focused menu; lenders the full nav (which now
  // includes the collateral desk — collateral is a loan type, not a vertical).
  const kind = user?.tenant?.kind;
  const baseStandalone = kind === "welfare" ? WELFARE_STANDALONE : standaloneItems;
  const baseGroups = kind === "welfare" ? WELFARE_GROUPS : navGroups;

  // Role-filtered: drop items the user can't see, and drop empty
  // groups (and empty sub-groups) so their headers don't render at all.
  const leafVisible = (it) =>
    itemVisible(it, user?.role) && (!it.requiresLoans || welfareLoansOn); // hide Loans when the switch is off
  const visibleStandalone = baseStandalone.filter(leafVisible);
  const visibleGroups = baseGroups
    .map((g) => ({
      ...g,
      items: g.items
        .map((it) =>
          isSubGroup(it) ? { ...it, items: it.items.filter(leafVisible) } : it,
        )
        .filter((it) => (isSubGroup(it) ? it.items.length > 0 : leafVisible(it))),
    }))
    .filter((g) => g.items.length > 0);

  // Expand/collapse state. Persists across reloads. The active group
  // is ALWAYS forced open on load — even if the user collapsed it
  // last session — so the user never lands on a hidden current page.
  // Accordion: at most ONE group is open at a time. State is still an object
  // keyed by id (so the renderer doesn't change), but only one key is ever
  // true. Prefer the active group on load, else the one the user last left
  // open.
  const [expandedGroups, setExpandedGroups] = useState(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      saved = {};
    }
    const openId = activeGroupId || Object.keys(saved).find((k) => saved[k]);
    return openId ? { [openId]: true } : {};
  });

  // On every navigation, open the active group and collapse the rest, so the
  // current page's group is the single one expanded.
  useEffect(() => {
    if (!activeGroupId) return;
    setExpandedGroups((prev) =>
      prev[activeGroupId] ? prev : { [activeGroupId]: true },
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

  // Open this group and close any other (accordion); clicking the open one
  // collapses it.
  const toggleGroup = (id) =>
    setExpandedGroups((prev) => (prev[id] ? {} : { [id]: true }));

  // Second-level (sub-group) expand state — e.g. Loan Book / Repayments inside
  // Loans. Same persistence + auto-open-active behaviour as the top groups.
  const activeSubId = (() => {
    for (const g of navGroups) {
      for (const it of g.items) {
        if (isSubGroup(it) && it.items.some((l) => isActive(l.path))) return it.id;
      }
    }
    return null;
  })();
  // Accordion at the sub-group level too — one of Loan Book / Repayments open
  // at a time. Loan Book is the default resting state.
  const [expandedSubs, setExpandedSubs] = useState(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY_SUB) || "{}");
    } catch {
      saved = {};
    }
    const openId =
      activeSubId || Object.keys(saved).find((k) => saved[k]) || "loanbook";
    return { [openId]: true };
  });
  useEffect(() => {
    if (!activeSubId) return;
    setExpandedSubs((prev) =>
      prev[activeSubId] ? prev : { [activeSubId]: true },
    );
  }, [activeSubId]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SUB, JSON.stringify(expandedSubs));
    } catch {
      /* quota / private-mode — non-fatal */
    }
  }, [expandedSubs]);
  const toggleSub = (id) =>
    setExpandedSubs((prev) => (prev[id] ? {} : { [id]: true }));

  const roleBadge = getRoleBadge(user?.role);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const getCurrentPageTitle = () => {
    const all = [
      ...visibleStandalone,
      ...visibleGroups.flatMap((g) => flattenLeaves(g.items)),
    ];
    const current = all.find((it) => isActive(it.path, it.exact));
    if (current) return current.label;
    if (location.pathname.startsWith("/clients/")) return "Client";
    if (location.pathname.startsWith("/loans/")) return "Loan";
    return "LenderFest";
  };

  const handleLogout = () => {
    // logout() hard-redirects on its own (tenant → /login, demo → home).
    logout();
  };

  // Topbar global search → deep-links into the Clients directory (which seeds
  // its filter from `?q=`). Lender console only.
  const submitSearch = (e) => {
    e.preventDefault();
    const q = topSearch.trim();
    navigate(q ? `/clients?q=${encodeURIComponent(q)}` : "/clients");
  };
  // The design's topbar search + "Record Payment" action belong to the lender
  // console; a welfare tenant has neither /clients nor /payments.
  const showConsoleActions = kind !== "welfare";
  const canRecordPayment = hasPermission(user?.role, "payments:view");

  // ── Render helpers ─────────────────────────────────────────────────
  // The Loan Console design's dark-sidebar palette doesn't map cleanly to
  // Tailwind tokens, so the exact hues are inlined here. Top rows (standalone
  // leaves + group headers) get an accent icon circle; leaves get a dot.
  const badgeFor = (item) =>
    item.badgeKey === "overdue"
      ? overdueCount
      : item.badgeKey === "pendingWaivers"
        ? pendingWaivers
        : item.badgeKey === "welfareRequests"
          ? welfareRequests
          : item.badge ?? 0;

  const Badge = ({ n }) =>
    n > 0 ? (
      <span
        className="text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full min-w-[1.4rem] text-center leading-tight shrink-0"
        style={{ background: "#ef4d77" }}
      >
        {n}
      </span>
    ) : null;

  // Standalone top-level leaf (Dashboard, Clients).
  const renderTopLeaf = (item) => {
    const active = isActive(item.path, item.exact);
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition hover:bg-white/[0.04]"
          style={{
            color: active ? "#fff" : "#aebfb8",
            fontWeight: active ? 700 : 600,
            background: active ? "rgba(22,163,122,.16)" : "transparent",
          }}
        >
          <NavIcon icon={item.icon} variant={item.variant} active={active} />
          <span className="flex-1">{item.label}</span>
          <Badge n={badgeFor(item)} />
        </Link>
      </li>
    );
  };

  // Connector that replaces the old bullet dot: a short horizontal branch tick
  // off the group's vertical guide rail, plus — when the row is active — a lit
  // segment sitting on the rail in the group accent (with a soft glow). `x` is
  // the rail's offset from the row's left edge; it lines up with the absolute
  // rail drawn on the surrounding <ul>.
  const RowConnector = ({ x, lit, accent }) => (
    <>
      <span
        aria-hidden
        className="absolute top-1/2 h-px w-2.5 -translate-y-1/2 rounded-full transition-colors"
        style={{ left: x, background: lit ? accent : "rgba(255,255,255,.20)" }}
      />
      {lit && (
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 w-px h-5 rounded-full"
          style={{ left: x, background: accent, boxShadow: `0 0 6px ${accent}` }}
        />
      )}
    </>
  );

  // Leaf inside a group / sub-group. No dot — it hangs off the guide rail via
  // RowConnector. `nested` sits it on the deeper sub-group rail.
  const renderLeaf = (item, accent, nested = false) => {
    const active = isActive(item.path, item.exact);
    return (
      <li key={item.path}>
        <Link
          to={item.path}
          className={`relative flex items-center gap-2 rounded-[10px] py-2 pr-3 text-[13px] transition hover:bg-white/[0.04] ${
            nested ? "pl-8" : "pl-[46px]"
          }`}
          style={{
            color: active ? accent : "#90a59d",
            fontWeight: active ? 700 : 500,
            background: active ? accent + "1f" : "transparent",
          }}
        >
          <RowConnector x={nested ? 18 : 25} lit={active} accent={accent} />
          <span className="flex-1">{item.label}</span>
          <Badge n={badgeFor(item)} />
        </Link>
      </li>
    );
  };

  // Sub-group inside a group (Loan Book / Repayments) — collapsible +/- row that
  // sits on the group's main rail; its leaves thread a deeper, branched rail.
  const renderSubGroup = (sub, accent) => {
    const open = !!expandedSubs[sub.id];
    const hasActive = sub.items.some((l) => isActive(l.path));
    return (
      <li key={sub.id}>
        <button
          type="button"
          onClick={() => toggleSub(sub.id)}
          aria-expanded={open}
          className="relative w-full flex items-center gap-2 rounded-[10px] pl-[46px] pr-3 py-2 text-[13px] font-semibold transition hover:bg-white/[0.04]"
          style={{ color: open || hasActive ? "#cfe0d9" : "#90a59d" }}
        >
          <RowConnector x={25} lit={open || hasActive} accent={accent} />
          <span className="flex-1 text-left">{sub.label}</span>
          <span
            className="flex items-center justify-center rounded-[5px] shrink-0"
            style={{ width: 18, height: 18, background: "rgba(255,255,255,.08)", color: "#9fc7b8" }}
          >
            {open ? <Minus size={11} /> : <Plus size={11} />}
          </span>
        </button>
        <div
          className={`overflow-hidden transition-all duration-200 ${
            open ? "max-h-[320px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {/* deeper, branched rail for this sub-group's leaves */}
          <ul className="relative space-y-0 ml-[26px]">
            <span
              aria-hidden
              className="absolute top-1 bottom-1 w-px"
              style={{ left: 18, background: "rgba(255,255,255,.13)" }}
            />
            {sub.items.map((l) => renderLeaf(l, accent, true))}
          </ul>
        </div>
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
          <div className="p-6 pb-4 bg-cream-50 border-b border-cream-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <LogoMark variant="color" className="h-9 w-9 shrink-0" />
              <div>
                <span className="font-display text-xl font-extrabold tracking-tight leading-none">
                  <span className="text-navy-900">Lender</span>
                  <span className="text-ocean-600">Fest</span>
                </span>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-700"
              aria-label="Close menu"
            >
              <X size={22} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3">
            {/* Standalone (Dashboard, Clients) */}
            <ul className="space-y-0.5">
              {visibleStandalone.map((it) => renderTopLeaf(it))}
            </ul>

            {/* Collapsible groups — accent icon circle + caret */}
            <div className="mt-1.5 space-y-0.5">
              {visibleGroups.map((g) => {
                const isExpanded = !!expandedGroups[g.id];
                const hasActive = flattenLeaves(g.items).some((it) =>
                  isActive(it.path),
                );
                const accent = accentOf(g.variant);
                return (
                  <div key={g.id}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`navgroup-${g.id}`}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition hover:bg-white/[0.04]"
                      style={{
                        color: hasActive ? "#eaf3ef" : "#aebfb8",
                        fontWeight: hasActive ? 700 : 600,
                        background:
                          hasActive && !isExpanded
                            ? "rgba(255,255,255,.05)"
                            : "transparent",
                      }}
                    >
                      <NavIcon
                        icon={g.icon}
                        variant={g.variant}
                        active={isExpanded || hasActive}
                      />
                      <span className="flex-1 text-left">{g.label}</span>
                      <ChevronRight
                        size={14}
                        className={`transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        style={{ color: "#6f8a81" }}
                        aria-hidden="true"
                      />
                    </button>
                    <div
                      id={`navgroup-${g.id}`}
                      className={`overflow-hidden transition-all duration-200 ${
                        isExpanded
                          ? "max-h-[600px] opacity-100 mt-0.5"
                          : "max-h-0 opacity-0"
                      }`}
                    >
                      <ul className="relative space-y-0">
                        {/* continuous guide rail dropping from the group icon,
                            threading every item (replaces the per-item dots) */}
                        <span
                          aria-hidden
                          className="absolute top-1 bottom-1 w-px"
                          style={{ left: 25, background: "rgba(255,255,255,.13)" }}
                        />
                        {g.items.map((it) =>
                          isSubGroup(it)
                            ? renderSubGroup(it, accent)
                            : renderLeaf(it, accent),
                        )}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
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
          <header className="lg:hidden bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition"
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
              <h1 className="text-lg font-bold text-gray-800 dark:text-slate-100">
                {getCurrentPageTitle()}
              </h1>
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <NotificationBell />
              </div>
            </div>
          </header>

          {/* Desktop top bar — page title · search · primary action · bell */}
          <header className="hidden lg:flex items-center gap-4 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 shadow-sm px-6 py-3">
            <h1 className="text-[17px] font-extrabold tracking-tight text-navy-900 dark:text-slate-100 truncate min-w-0">
              {getCurrentPageTitle()}
            </h1>
            <div className="flex-1" />
            {showConsoleActions && (
              <form
                onSubmit={submitSearch}
                className="hidden xl:flex items-center gap-2 bg-gray-100 dark:bg-slate-700/60 border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 w-72"
              >
                <Search
                  size={16}
                  className="text-gray-400 dark:text-slate-400 shrink-0"
                />
                <input
                  value={topSearch}
                  onChange={(e) => setTopSearch(e.target.value)}
                  placeholder="Search clients, loans, IDs…"
                  className="bg-transparent outline-none text-sm w-full text-navy-900 dark:text-slate-100 placeholder:text-gray-400"
                  aria-label="Search clients"
                />
              </form>
            )}
            {showConsoleActions && canRecordPayment && (
              <button
                onClick={() => navigate("/payments")}
                className="flex items-center gap-1.5 bg-ocean-gradient text-white rounded-xl px-4 py-2 text-sm font-bold shadow-tile hover:brightness-105 transition"
              >
                <Plus size={16} strokeWidth={2.5} /> Record Payment
              </button>
            )}
            <div className="w-px h-7 bg-gray-200 dark:bg-slate-600" />
            <ThemeToggle />
            <NotificationBell />
          </header>

          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
  );
}

export default Layout;
