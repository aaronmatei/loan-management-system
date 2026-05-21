import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Layers,
  Wallet,
  Calculator,
  CreditCard,
  ClipboardList,
  User,
  LogOut,
} from "lucide-react";
import IconTile from "../../components/IconTile";
import PortalNotificationBell from "./PortalNotificationBell";

// Shared shell for the authenticated portal pages. The portal is a single
// global customer account that aggregates lenders, so the chrome here is
// LoanFix's own ocean/navy product theme (matching the staff dashboard) —
// NOT a tenant brand. Per-lender brand colors live inside the page content
// (lender cards, loan rows, receipts), never in this shell.
const MENU = [
  { path: "/loanfix/portal/dashboard", label: "Dashboard", icon: LayoutDashboard, variant: "ocean", exact: true },
  { path: "/loanfix/lenders", label: "Lenders", icon: Layers, variant: "indigo" },
  { path: "/loanfix/portal/loans", label: "My Loans", icon: Wallet, variant: "teal" },
  { path: "/loanfix/portal/payments", label: "Payments", icon: CreditCard, variant: "ocean" },
  { path: "/loanfix/portal/calculator", label: "Calculator", icon: Calculator, variant: "emerald" },
  { path: "/loanfix/portal/applications", label: "My Applications", icon: ClipboardList, variant: "amber" },
  { path: "/loanfix/portal/profile", label: "Profile", icon: User, variant: "indigo" },
];

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
    navigate("/loanfix/portal/login");
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
        <div className="p-6 pb-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <IconTile icon={Wallet} variant="ocean" size={38} />
            <div>
              <h2 className="text-xl font-bold tracking-tight">LoanFix</h2>
              <p className="text-ocean-200/60 text-xs">Customer Portal</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-ocean-200/70 hover:text-white text-2xl"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-1">
            {MENU.map((item) => {
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
          <div className="mb-3">
            <p className="text-sm font-semibold truncate text-white">
              {customer.first_name} {customer.last_name}
            </p>
            <p className="text-xs text-ocean-200/50 truncate">
              {customer.phone_number}
            </p>
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
              <h1 className="text-lg font-bold text-navy-900 truncate">
                LoanFix
              </h1>
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
