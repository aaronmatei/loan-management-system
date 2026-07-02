import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "../../components/Logo";
import ThemeToggle from "../../components/ThemeToggle";
import {
  LayoutDashboard,
  Layers,
  Wallet,
  Calculator,
  Receipt,
  PlusCircle,
  ClipboardList,
  User,
  LogOut,
  X,
  Gem,
  Coins,
  CalendarCheck,
  Gift,
  AlertTriangle,
  HeartHandshake,
  LifeBuoy,
  Users,
  FileText,
  Vote,
  BookOpen,
  MessageCircle,
  Phone,
} from "lucide-react";
import PortalNotificationBell from "./PortalNotificationBell";

// Shared shell for the authenticated portal pages. The portal is a single
// global customer account that aggregates lenders, so the chrome here is
// LenderFest's own ocean/navy product theme (matching the staff dashboard) —
// NOT a tenant brand. Per-lender brand colors live inside the page content
// (lender cards, loan rows, receipts), never in this shell.
// The portal is ONE global customer account, so the sidebar stays constant —
// it never wholesale-swaps per the lender you're currently viewing (that left
// pawn customers stuck with no way back to loans/applications). Pawn items are
// ADDED when the customer is linked to any pawnbroker.
const BASE_MENU = [
  { path: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard, variant: "ocean", exact: true },
  { path: "/portal/apply", label: "Apply for a loan", icon: PlusCircle, variant: "emerald" },
  { path: "/lenders", label: "Lenders", icon: Layers, variant: "indigo" },
  { path: "/portal/applications", label: "My Applications", icon: ClipboardList, variant: "amber" },
  { path: "/portal/loans", label: "My Loans", icon: Wallet, variant: "teal" },
  { path: "/portal/payments", label: "Payment history", icon: Receipt, variant: "ocean" },
  { path: "/portal/statements", label: "Loan statement", icon: FileText, variant: "teal" },
  { path: "/portal/calculator", label: "Calculator", icon: Calculator, variant: "emerald" },
  { path: "/portal/support", label: "Help & support", icon: LifeBuoy, variant: "teal" },
  { path: "/portal/profile", label: "Profile", icon: User, variant: "indigo" },
];
const PAWN_ITEMS = [
  { path: "/portal/pawn-requests", label: "Pawn Requests", icon: ClipboardList, variant: "amber" },
  { path: "/portal/pledges", label: "My Pledges", icon: Gem, variant: "teal" },
];

// When the SELECTED tenant is a welfare, the same person is a chama member there
// (not a borrower), so the menu swaps to their member desk — but keeps "Borrow
// from a lender" so they can still take loans from lenders with this account.
const WELFARE_MENU = [
  { path: "/welfare/member", label: "Dashboard", icon: LayoutDashboard, variant: "emerald", exact: true },
  { path: "/welfare/member/members", label: "Members", icon: Users, variant: "sky" },
  { path: "/welfare/member/contributions", label: "Contributions", icon: Coins, variant: "ocean" },
  { path: "/welfare/member/events", label: "Events", icon: HeartHandshake, variant: "ocean" },
  { path: "/welfare/member/emergencies", label: "Emergencies", icon: LifeBuoy, variant: "ocean" },
  { path: "/welfare/member/loans", label: "Requests", icon: ClipboardList, variant: "indigo" },
  { path: "/welfare/member/meetings", label: "Meetings", icon: CalendarCheck, variant: "amber" },
  { path: "/welfare/member/documents", label: "Documents", icon: FileText, variant: "teal" },
  { path: "/welfare/member/decisions", label: "Decisions", icon: Vote, variant: "indigo" },
  { path: "/welfare/member/books", label: "Books of Accounts", icon: BookOpen, variant: "ocean" },
  { path: "/welfare/member/dividends", label: "Dividends", icon: Gift, variant: "emerald" },
  { path: "/welfare/member/penalties", label: "Penalties", icon: AlertTriangle, variant: "rose" },
  { path: "/welfare/member/support", label: "Support", icon: LifeBuoy, variant: "teal" },
  // Hidden for now — reveal to let chama members also borrow from lenders.
  // { path: "/lenders", label: "Borrow from a lender", icon: Layers, variant: "indigo" },
  { path: "/portal/profile", label: "Profile", icon: User, variant: "indigo" },
];

function buildMenu() {
  let cur = null;
  let tenants = [];
  try {
    cur = JSON.parse(localStorage.getItem("portal_current_tenant") || "null");
    tenants = JSON.parse(localStorage.getItem("portal_tenants") || "[]");
  } catch {
    /* ignore */
  }
  // Welfare member context wins (data is per-welfare, so it follows the
  // selected tenant rather than the union of all linked tenants). "Requests"
  // stays even when loans are off — it's also the event-funds request desk.
  if (cur?.kind === "welfare") return WELFARE_MENU;
  const hasPawn =
    cur?.kind === "pawnbroker" ||
    (Array.isArray(tenants) && tenants.some((t) => t?.kind === "pawnbroker"));
  if (!hasPawn) return BASE_MENU;
  const m = [...BASE_MENU];
  const after = m.findIndex((x) => x.path === "/portal/loans");
  m.splice(after + 1, 0, ...PAWN_ITEMS);
  return m;
}

function PortalLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customer, setCustomer] = useState({});
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    try {
      setCustomer(JSON.parse(localStorage.getItem("portal_customer") || "{}"));
      setTenant(JSON.parse(localStorage.getItem("portal_current_tenant") || "null"));
    } catch {
      /* ignore malformed storage */
    }
  }, [location.pathname]);

  // A welfare member sees their chama's name; borrowers see the platform portal.
  const portalLabel = tenant?.kind === "welfare" && tenant.business_name ? `${tenant.business_name} Portal` : "Client Portal";

  // Close the mobile drawer on navigation.
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  const logout = () => {
    // Send a welfare member back to their own door, not the borrower login.
    let isWelfare = false;
    try {
      isWelfare = JSON.parse(localStorage.getItem("portal_current_tenant") || "null")?.kind === "welfare";
    } catch { /* ignore */ }
    [
      "portal_token",
      "portal_customer",
      "portal_current_tenant",
      "portal_tenants",
    ].forEach((k) => localStorage.removeItem(k));
    const path = isWelfare ? "/welfare/member/login" : "/portal/login";
    // A welfare member browses on their welfare's subdomain; log them out back
    // to the apex door (lenderfest.loans/welfare/member/login), wiping that
    // origin's own storage via ?loggedout=1. Localhost/preview just SPA-navigate.
    const host = window.location.hostname;
    if (isWelfare && host.endsWith(".lenderfest.loans")) {
      window.location.href = `https://lenderfest.loans${path}?loggedout=1`;
      return;
    }
    navigate(path);
  };

  const isActive = (item) =>
    item.exact
      ? location.pathname === item.path
      : location.pathname.startsWith(item.path);

  const menu = buildMenu();
  const isWelfareMember = tenant?.kind === "welfare";
  // Header page title, resolved from the active nav item (with a few detail-
  // route fallbacks the menu doesn't list).
  const pageTitle = (() => {
    const hit = menu.find((m) => isActive(m));
    if (hit) return hit.label;
    if (location.pathname.startsWith("/portal/loans/")) return "Loan details";
    if (location.pathname.startsWith("/portal/pledges/")) return "Pledge details";
    if (location.pathname.startsWith("/lenders/")) return "Lender";
    return portalLabel;
  })();
  const initials = `${(customer.first_name || "?").charAt(0)}${(customer.last_name || "").charAt(0)}`.toUpperCase();

  return (
    <div className="flex h-screen bg-portal">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* App teal/navy shell (LenderFest chrome), Claude nav/help elements. */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 text-white bg-navy-gradient transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } flex flex-col`}
      >
        {/* Cream LenderFest lockup header — same style as the staff/admin
            sidebars (ring mark + "Lender"/"Fest" on cream, dark body below). */}
        <div className="p-6 pb-4 bg-cream-50 border-b border-cream-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark variant="color" className="h-9 w-9 shrink-0" />
            <div className="leading-tight">
              <div className="font-display text-lg font-extrabold tracking-tight leading-none">
                <span className="text-navy-900">Lender</span>
                <span className="text-ocean-600">Fest</span>
              </div>
              <div className="text-[10px] font-bold tracking-[0.06em] text-slate-500 mt-1 uppercase truncate max-w-[160px]">
                {isWelfareMember ? portalLabel : "Borrower Portal"}
              </div>
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

        <nav className="flex-1 overflow-y-auto px-3.5 py-1">
          <ul className="space-y-0.5">
            {menu.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-[11px] text-[13.5px] transition ${
                      active ? "" : "hover:bg-white/[0.07]"
                    }`}
                    style={{
                      color: active ? "#fff" : "#8fb6a6",
                      fontWeight: active ? 700 : 600,
                      background: active ? "#ffffff1a" : "transparent",
                    }}
                  >
                    <Icon size={18} className="shrink-0" strokeWidth={active ? 2.4 : 2} />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Need-help card — routes to the support desk. */}
        {!isWelfareMember && (
          <Link
            to="/portal/support"
            className="mx-3.5 mb-3.5 rounded-[14px] p-4 block transition hover:brightness-110"
            style={{ background: "#ffffff12" }}
          >
            <div className="flex items-center gap-2 text-[12px] font-bold text-[#cdeede]">
              <MessageCircle size={15} /> Need help?
            </div>
            <div className="text-[11.5px] text-[#8fb6a6] font-medium mt-1 leading-snug">
              Questions about a payment or loan? We're here for you.
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 text-[12px] font-bold text-[#5fe3ab]">
              <Phone size={13} /> Get support
            </div>
          </Link>
        )}

        <div
          className="px-4 py-3.5 flex items-center gap-3"
          style={{ borderTop: "1px solid #ffffff14" }}
        >
          {customer.profile_photo_url ? (
            <img
              src={customer.profile_photo_url}
              alt=""
              className="w-9 h-9 rounded-full object-cover shrink-0"
              style={{ boxShadow: "0 0 0 1px #2ee0a04d" }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-extrabold shrink-0"
              style={{ background: "#2ee0a01f", border: "1px solid #2ee0a04d", color: "#7fe9bd" }}
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-white truncate">
              {customer.first_name} {customer.last_name}
            </div>
            <div className="text-[11px] text-[#6fae93] font-semibold truncate">
              {customer.phone_number}
            </div>
          </div>
          <button onClick={logout} aria-label="Logout" title="Logout">
            <LogOut size={17} className="text-[#6fae93] hover:text-white transition" />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Warm cream header — page title + notifications + user chip. */}
        <header
          className="flex-shrink-0 flex items-center gap-4 px-5 lg:px-7 h-[66px] bg-[#fbf6ec] dark:bg-slate-800 border-b border-[#ece2cf] dark:border-slate-700"
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg text-[#5e6b62] hover:bg-[#f0ebe0] dark:hover:bg-slate-700"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="text-[17px] font-extrabold tracking-tight text-[#16241d] dark:text-slate-100 truncate">
              {pageTitle}
            </div>
          </div>
          <div className="flex-1" />
          <ThemeToggle />
          <PortalNotificationBell />
          <div className="hidden sm:flex items-center gap-2.5 bg-white dark:bg-slate-700 border border-[#e5ddcd] dark:border-slate-600 rounded-[11px] pl-3 pr-1.5 py-1.5">
            <span className="text-[13px] font-bold text-[#16241d] dark:text-slate-100">
              {customer.first_name || "You"}
            </span>
            {customer.profile_photo_url ? (
              <img src={customer.profile_photo_url} alt="" className="w-[30px] h-[30px] rounded-lg object-cover" />
            ) : (
              <div
                className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[11px] font-extrabold text-[#cdeede]"
                style={{ background: "#122a2e" }}
              >
                {initials}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export default PortalLayout;
