import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const MENU = [
  { path: "/admin/dashboard", label: "Overview", icon: "📊" },
  { path: "/admin/tenants", label: "Tenants", icon: "🏢" },
  { path: "/admin/billing", label: "Billing", icon: "💰" },
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
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
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
          } bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col`}
        >
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👑</span>
              <div>
                <h2 className="text-lg font-bold">Platform Admin</h2>
                <p className="text-xs text-slate-300">SaaS Control Center</p>
              </div>
            </div>
          </div>
          <div className="p-4 border-b border-white/10">
            <p className="text-xs text-slate-400">Logged in as</p>
            <p className="font-semibold text-sm">
              {user.first_name} {user.last_name}
            </p>
            <p className="text-xs text-slate-400">{user.email}</p>
          </div>
          <nav className="flex-1 p-4">
            <ul className="space-y-1">
              {MENU.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                      location.pathname === item.path
                        ? "bg-indigo-600 font-semibold"
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
          <div className="p-4 border-t border-white/10 space-y-2">
            <Link
              to="/"
              className="block w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-center"
            >
              ← Back to Tenant View
            </Link>
            <button
              onClick={logout}
              className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 rounded-lg font-semibold text-sm"
            >
              Logout
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
              <div className="text-sm text-gray-600">
                🌍 Platform-wide view
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
