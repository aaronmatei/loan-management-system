import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "../../components/Logo";
import {
  LayoutDashboard,
  Building2,
  Wallet,
  TrendingUp,
  Clock,
  ScrollText,
  LogOut,
  Globe,
  MessageSquare,
} from "lucide-react";
import IconTile from "../../components/IconTile";

const MENU = [
  { path: "/admin/dashboard", label: "Overview", icon: LayoutDashboard, variant: "ocean" },
  { path: "/admin/tenants", label: "Tenants", icon: Building2, variant: "indigo" },
  { path: "/admin/billing", label: "Billing", icon: Wallet, variant: "emerald" },
  { path: "/admin/communication-costs", label: "Comms Costs", icon: MessageSquare, variant: "indigo" },
  { path: "/admin/reports", label: "Analytics", icon: TrendingUp, variant: "teal" },
  { path: "/admin/cron", label: "Cron Jobs", icon: Clock, variant: "amber" },
  { path: "/admin/audit", label: "Audit Log", icon: ScrollText, variant: "rose" },
];

function PlatformLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState({});

  useEffect(() => {
    let u = {};
    try {
      u = JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      u = {};
    }
    if (!localStorage.getItem("token")) {
      navigate("/login");
      return;
    }
    if (!u.is_platform_admin) {
      alert("Platform admin access required");
      navigate("/"); // staff home is "/", not "/dashboard"
      return;
    }
    setUser(u);
  }, [navigate]);

  const logout = () => {
    localStorage.clear();
    // Hard-redirect to the apex admin login, leaving any subdomain, with
    // ?loggedout=1 so the destination wipes its own storage too — no stale
    // token can silently re-authenticate.
    const host = window.location.hostname;
    const onLF =
      host === "lenderfest.loans" || host.endsWith(".lenderfest.loans");
    const base = onLF ? "https://lenderfest.loans" : window.location.origin;
    window.location.href = `${base}/admin/login?loggedout=1`;
  };

  return (
    <div className="min-h-screen bg-app-bg">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex h-screen">
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          } bg-navy-gradient text-white flex flex-col`}
        >
          <div className="p-6 bg-cream-50 border-b border-cream-100">
            <div className="flex items-center gap-2.5">
              <LogoMark variant="color" className="h-9 w-9 shrink-0" />
              <div>
                <span className="font-display text-lg font-extrabold tracking-tight leading-none">
                  <span className="text-navy-900">Lender</span>
                  <span className="text-ocean-600">Fest</span>
                </span>
                <p className="text-xs text-slate-500">Platform Admin</p>
              </div>
            </div>
          </div>
          <div className="p-4 border-b border-white/10">
            <p className="text-xs text-ocean-200/50">Logged in as</p>
            <p className="font-semibold text-sm text-white">
              {user.first_name} {user.last_name}
            </p>
            <p className="text-xs text-ocean-200/50">{user.email}</p>
          </div>
          <nav className="flex-1 p-4">
            <ul className="space-y-1">
              {MENU.map((item) => {
                const active = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl transition ${
                        active
                          ? "bg-ocean-gradient font-semibold shadow-tile text-white"
                          : "text-ocean-100/80 hover:bg-white/5 hover:text-white"
                      }`}
                    >
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
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="p-4 border-t border-white/10 bg-navy-950/40">
            <button
              onClick={logout}
              className="w-full py-2 px-4 bg-white/10 hover:bg-white/15 text-ocean-100 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
            >
              <LogOut size={16} /> Logout
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
              <h1 className="text-lg font-bold text-gray-800 lg:hidden">
                Platform Admin
              </h1>
              <div className="flex-1 hidden lg:block" />
              <div className="text-sm text-gray-600 flex items-center gap-1.5">
                <Globe size={15} className="text-gray-500" /> Platform-wide view
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default PlatformLayout;
