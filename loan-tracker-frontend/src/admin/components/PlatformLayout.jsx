import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "../../components/Logo";
import {
  LayoutDashboard,
  Building2,
  Wallet,
  TrendingUp,
  Server,
  ScrollText,
  LogOut,
  Search,
  MessageSquare,
} from "lucide-react";
import NavIcon from "../../components/NavIcon";

const MENU = [
  { path: "/admin/dashboard", label: "Overview", icon: LayoutDashboard, variant: "ocean" },
  { path: "/admin/tenants", label: "Tenants", icon: Building2, variant: "indigo" },
  { path: "/admin/billing", label: "Billing & Plans", icon: Wallet, variant: "emerald" },
  { path: "/admin/reports", label: "Analytics", icon: TrendingUp, variant: "teal" },
  { path: "/admin/communication-costs", label: "Comms Costs", icon: MessageSquare, variant: "indigo" },
  { path: "/admin/cron", label: "System", icon: Server, variant: "amber" },
  { path: "/admin/audit", label: "Audit Log", icon: ScrollText, variant: "rose" },
];

// Header title/subtitle per admin section.
const TITLES = {
  "/admin/dashboard": ["Platform Overview", "All tenants at a glance"],
  "/admin/tenants": ["Tenants", "Lender organisations on LenderFest"],
  "/admin/billing": ["Billing & Plans", "Subscription & usage revenue"],
  "/admin/reports": ["Analytics", "Platform-wide analytics"],
  "/admin/communication-costs": ["Comms Costs", "SMS & email usage"],
  "/admin/cron": ["System", "Jobs, services & health"],
  "/admin/audit": ["Audit Log", "Platform activity trail"],
  "/admin/settings": ["Platform Settings", "Global configuration"],
};

function PlatformLayout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState({});
  const [q, setQ] = useState("");

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/admin/tenants?q=${encodeURIComponent(q.trim())}` : "/admin/tenants");
  };
  const [pageTitle, pageSub] = (() => {
    if (location.pathname.startsWith("/admin/tenants/")) return ["Tenant", "Organisation detail"];
    if (location.pathname.startsWith("/admin/billing/")) return ["Invoice", "Invoice detail"];
    const key = Object.keys(TITLES).find((k) => location.pathname.startsWith(k));
    return TITLES[key] || ["Platform Admin", ""];
  })();

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
                const active = location.pathname.startsWith(item.path);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition hover:bg-white/[0.04]"
                      style={{
                        color: active ? "#fff" : "#aebfb8",
                        fontWeight: active ? 700 : 600,
                        background: active ? "rgba(22,163,122,.16)" : "transparent",
                      }}
                    >
                      <NavIcon
                        icon={item.icon}
                        variant={item.variant}
                        active={active}
                      />
                      <span className="flex-1">{item.label}</span>
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
          <header className="flex-shrink-0 flex items-center gap-4 h-[66px] bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-4 lg:px-6">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 text-gray-500"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="text-[17px] font-extrabold tracking-tight text-navy-900 dark:text-slate-100 truncate">
                {pageTitle}
              </div>
              <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium truncate">
                {pageSub}
              </div>
            </div>
            <div className="flex-1" />
            <form
              onSubmit={submitSearch}
              className="hidden md:flex items-center gap-2 bg-gray-100 dark:bg-slate-700/60 border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 w-64"
            >
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tenants…"
                aria-label="Search tenants"
                className="bg-transparent outline-none text-sm w-full text-navy-900 dark:text-slate-100 placeholder:text-gray-400"
              />
            </form>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default PlatformLayout;
