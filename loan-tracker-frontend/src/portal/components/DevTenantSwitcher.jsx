import React, { useState, useEffect } from "react";

// DEV ONLY (localhost): pick which tenant subdomain portalApi sends
// as X-Tenant-Subdomain, since real subdomains aren't available in dev.
function DevTenantSwitcher() {
  const tenants = [
    { subdomain: "techtsadong", name: "Tech Tsadong", color: "#4F46E5" },
    { subdomain: "abclenders", name: "ABC Lenders", color: "#3B82F6" },
    { subdomain: "xyzmicrofinance", name: "XYZ Microfinance", color: "#10B981" },
    { subdomain: "quickloans", name: "Quick Loans Co", color: "#EF4444" },
  ];
  const [isDev, setIsDev] = useState(false);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dev =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    setIsDev(dev);
    if (dev) {
      const stored = localStorage.getItem("dev_tenant_subdomain");
      const found = tenants.find((t) => t.subdomain === stored);
      if (found) setSelected(found);
    }
  }, []);

  const pick = (t) => {
    localStorage.setItem("dev_tenant_subdomain", t.subdomain);
    window.location.reload();
  };
  const clear = () => {
    localStorage.removeItem("dev_tenant_subdomain");
    window.location.reload();
  };

  if (!isDev) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-400 border-b-2 border-yellow-500 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-bold">🔧 DEV</span>
          <span className="text-yellow-900">
            Tenant:{" "}
            <strong>{selected ? selected.name : "(none — set one)"}</strong>
          </span>
        </div>
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded font-semibold text-xs"
          >
            Switch ⌄
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border-2 border-yellow-300 z-50">
              {tenants.map((t) => (
                <button
                  key={t.subdomain}
                  onClick={() => pick(t)}
                  className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 flex items-center gap-2"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="flex-1">
                    <span className="block font-semibold text-gray-800 text-sm">
                      {t.name}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {t.subdomain}.lms.co.ke
                    </span>
                  </span>
                  {selected?.subdomain === t.subdomain && (
                    <span className="text-blue-600">✓</span>
                  )}
                </button>
              ))}
              <button
                onClick={clear}
                className="w-full p-2 bg-gray-50 text-red-600 text-xs font-semibold hover:bg-gray-100"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DevTenantSwitcher;
