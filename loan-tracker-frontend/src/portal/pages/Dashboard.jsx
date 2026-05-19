import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import TenantSwitcher from "../components/TenantSwitcher";
import DevTenantSwitcher from "../components/DevTenantSwitcher";
import CurrentTenantBanner from "../components/CurrentTenantBanner";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

function CustomerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .get("/portal/customer/dashboard")
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/select-tenant");
        } else {
          alert(err.response?.data?.error || "Failed to load dashboard");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const logout = () => {
    ["portal_token", "portal_customer", "portal_current_tenant", "portal_tenants"].forEach(
      (k) => localStorage.removeItem(k),
    );
    navigate("/portal/login");
  };

  if (loading)
    return <div className="p-8 text-center text-gray-600">Loading…</div>;
  if (!data)
    return (
      <div className="p-8 text-center text-gray-600">
        No data.{" "}
        <button onClick={logout} className="text-indigo-600 underline">
          Logout
        </button>
      </div>
    );

  const { tenant, client, active_loans, next_payment, stats, pending_applications } =
    data;

  return (
    <div className="min-h-screen bg-gray-50">
      <DevTenantSwitcher />
      <CurrentTenantBanner />
      <header
        className="text-white"
        style={{
          background: `linear-gradient(135deg, ${
            tenant?.brand_color || "#4F46E5"
          }, #7C3AED)`,
        }}
      >
        <div className="max-w-5xl mx-auto px-4 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">{tenant?.business_name}</p>
            <h1 className="text-xl lg:text-2xl font-bold">
              Hi {client?.first_name} 👋
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <TenantSwitcher />
            <button
              onClick={logout}
              className="px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Active Loans</p>
            <p className="text-2xl font-bold mt-1">
              {stats?.active_loans || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Completed</p>
            <p className="text-2xl font-bold mt-1">
              {stats?.completed_loans || 0}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Active Due</p>
            <p className="text-lg font-bold mt-1">
              {KES(stats?.active_total_due)}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500 uppercase">Next Payment</p>
            <p className="text-sm font-bold mt-1">
              {next_payment
                ? `${KES(next_payment.amount_due)} · ${new Date(
                    next_payment.due_date,
                  ).toLocaleDateString()}`
                : "—"}
            </p>
          </div>
        </div>

        <section className="bg-white rounded-xl shadow">
          <h2 className="px-4 py-3 font-bold text-gray-800 border-b">
            Active Loans
          </h2>
          {active_loans?.length ? (
            active_loans.map((l) => (
              <div
                key={l.id}
                className="px-4 py-3 border-b last:border-0 flex justify-between"
              >
                <div>
                  <p className="font-mono text-sm text-indigo-600">
                    {l.loan_code}
                  </p>
                  <p className="text-xs text-gray-500">
                    Principal {KES(l.principal_amount)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    Paid {KES(l.total_paid)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Due {KES(l.total_amount_due)}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="px-4 py-6 text-gray-500 text-sm">
              No active loans.
            </p>
          )}
        </section>

        {pending_applications?.length > 0 && (
          <section className="bg-white rounded-xl shadow">
            <h2 className="px-4 py-3 font-bold text-gray-800 border-b">
              Applications
            </h2>
            {pending_applications.map((a) => (
              <div
                key={a.id}
                className="px-4 py-3 border-b last:border-0 flex justify-between text-sm"
              >
                <span className="font-mono text-indigo-600">
                  {a.loan_code || `#${a.id}`}
                </span>
                <span>{KES(a.principal_amount)}</span>
                <span className="capitalize text-gray-600">
                  {a.status?.replace("_", " ")}
                </span>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

export default CustomerDashboard;
