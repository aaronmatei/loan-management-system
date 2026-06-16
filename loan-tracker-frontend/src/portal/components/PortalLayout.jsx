import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Logo, { LogoMark } from "../../components/Logo";
import {
  LayoutDashboard,
  Layers,
  Wallet,
  Calculator,
  CreditCard,
  ClipboardList,
  User,
  LogOut,
  X,
  Gem,
} from "lucide-react";
import IconTile from "../../components/IconTile";
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
  { path: "/lenders", label: "Lenders", icon: Layers, variant: "indigo" },
  { path: "/portal/applications", label: "My Applications", icon: ClipboardList, variant: "amber" },
  { path: "/portal/loans", label: "My Loans", icon: Wallet, variant: "teal" },
  { path: "/portal/payments", label: "Payments", icon: CreditCard, variant: "ocean" },
  { path: "/portal/calculator", label: "Calculator", icon: Calculator, variant: "emerald" },
  { path: "/portal/profile", label: "Profile", icon: User, variant: "indigo" },
];
const PAWN_ITEMS = [
  { path: "/portal/pawn-requests", label: "Pawn Requests", icon: ClipboardList, variant: "amber" },
  { path: "/portal/pledges", label: "My Pledges", icon: Gem, variant: "teal" },
];

function buildMenu() {
  let hasPawn = false;
  try {
    const cur = JSON.parse(localStorage.getItem("portal_current_tenant") || "null");
    const tenants = JSON.parse(localStorage.getItem("portal_tenants") || "[]");
    hasPawn = cur?.kind === "pawnbroker" || (Array.isArray(tenants) && tenants.some((t) => t?.kind === "pawnbroker"));
  } catch {
    /* ignore */
  }
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

  useEffect(() => {
    try {
      setCustomer(JSON.parse(localStorage.getItem("portal_customer") || "{}"));
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  const logout = () => {
    [
      "portal_token",
      "portal_customer",
      "portal_current_tenant",
      "portal_tenants",
    ].forEach((k) => localStorage.removeItem(k));
    navigate("/portal/login");
  };

  const isActive = (item) =>
    item.exact
      ? location.pathname === item.path
      : location.pathname.startsWith(item.path);

  const linkClass = (active) =>
    `flex items-center gap-3 px-3 py-2 rounded-xl transition ${
      active
        ? "bg-ocean-gradient text-white font-semibold shadow-tile"
        : "text-ocean-100/80 hover:bg-white/5 hover:text-white"
    }`;

  return (
    <div className="flex h-screen bg-app-bg">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

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
              <p className="text-slate-500 text-xs">Client Portal</p>
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

        <nav className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-1">
            {buildMenu().map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <Link to={item.path} className={linkClass(active)}>
                    {active ? (
                      <span
                        className="flex items-center justify-center rounded-xl bg-white/20 shrink-0"
                        style={{ width: 32, height: 32 }}
                      >
                        <Icon size={16} color="#fff" strokeWidth={2.2} />
                      </span>
                    ) : (
                      <IconTile icon={Icon} variant={item.variant} size={32} />
                    )}
                    <span className="flex-1 text-sm">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-white/10 bg-navy-950/40">
          <div className="mb-3 flex items-center gap-3">
            {customer.profile_photo_url ? (
              <img
                src={customer.profile_photo_url}
                alt=""
                className="w-10 h-10 rounded-full object-cover shrink-0 ring-2 ring-white/20"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-ocean-gradient flex items-center justify-center text-white font-bold shrink-0">
                {(customer.first_name || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate text-white">
                {customer.first_name} {customer.last_name}
              </p>
              <p className="text-xs text-ocean-200/50 truncate">
                {customer.phone_number}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full py-2 px-4 bg-white/10 hover:bg-white/15 text-ocean-100 rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100"
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
              <Logo markClassName="h-6 w-6" textClassName="text-lg" />
            </div>
            <PortalNotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export default PortalLayout;
