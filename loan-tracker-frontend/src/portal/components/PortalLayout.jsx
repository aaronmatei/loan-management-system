import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TenantSwitcher from "./TenantSwitcher";
import DevTenantSwitcher from "./DevTenantSwitcher";

// Shared mobile-first shell for the authenticated portal pages
// (Dashboard / My Loans / Profile). Reads the same localStorage keys
// the rest of the portal uses; never refetches what pages already own.
const MENU = [
  { path: "/portal/dashboard", label: "Dashboard", icon: "🏠" },
  { path: "/portal/all-loans", label: "All Lenders", icon: "📊" },
  { path: "/portal/loans", label: "Current Lender", icon: "💰" },
  { path: "/portal/apply", label: "Apply for Loan", icon: "📝" },
  { path: "/portal/applications", label: "My Applications", icon: "📋" },
  { path: "/portal/add-lender", label: "Add Lender", icon: "➕" },
  { path: "/portal/profile", label: "Profile", icon: "👤" },
];

function PortalLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customer, setCustomer] = useState({});
  const [tenant, setTenant] = useState({});

  useEffect(() => {
    try {
      setCustomer(JSON.parse(localStorage.getItem("portal_customer") || "{}"));
      setTenant(
        JSON.parse(localStorage.getItem("portal_current_tenant") || "{}"),
      );
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const logout = () => {
    [
      "portal_token",
      "portal_customer",
      "portal_current_tenant",
      "portal_tenants",
    ].forEach((k) => localStorage.removeItem(k));
    navigate("/portal/login");
  };

  const brand = tenant?.brand_color || "#4F46E5";

  return (
    <>
      <DevTenantSwitcher />
      <div className="min-h-screen bg-gray-50">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex h-screen">
          <aside
            className={`fixed lg:static inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300 flex flex-col text-white ${
              sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full lg:translate-x-0"
            }`}
            style={{
              background: `linear-gradient(135deg, ${brand}, #7C3AED)`,
            }}
          >
            <div className="p-6 border-b border-white/20">
              <h2 className="text-xl font-bold truncate">
                {tenant?.business_name || "Portal"}
              </h2>
              <p className="text-sm opacity-80 mt-1">
                Hi, {customer.first_name || "there"}!
              </p>
            </div>

            <nav className="flex-1 p-4">
              <ul className="space-y-2">
                {MENU.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                        location.pathname === item.path
                          ? "bg-white/20 font-semibold"
                          : "hover:bg-white/10"
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="p-4 border-t border-white/20">
              <button
                onClick={logout}
                className="w-full py-2 px-4 bg-white/15 hover:bg-white/25 rounded-lg font-semibold"
              >
                🚪 Logout
              </button>
            </div>
          </aside>

          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="bg-white border-b shadow-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2 -ml-2"
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
                <h1 className="text-lg font-bold text-gray-800 lg:hidden truncate">
                  {tenant?.business_name}
                </h1>
                <div className="flex-1 hidden lg:block" />
                <TenantSwitcher />
              </div>
            </header>

            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </div>
      </div>
    </>
  );
}

export default PortalLayout;
