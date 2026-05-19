import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

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

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-600">Loading…</div>
      </PortalLayout>
    );
  }
  if (!data) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-600">No data.</div>
      </PortalLayout>
    );
  }

  const { client, active_loans, next_payment, stats, pending_applications } =
    data;

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
            Hi {client?.first_name} 👋
          </h1>
          <p className="text-gray-600 mt-1">
            {client?.client_code}
          </p>
        </div>

        {(() => {
          let n = 0;
          try {
            n = JSON.parse(
              localStorage.getItem("portal_tenants") || "[]",
            ).length;
          } catch {
            n = 0;
          }
          return n > 1 ? (
            <button
              onClick={() => navigate("/portal/all-loans")}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-700 text-white py-3 px-4 rounded-xl shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 font-semibold"
            >
              <span>📊</span>
              <span>View All Loans Across All Lenders</span>
              <span>→</span>
            </button>
          ) : null;
        })()}

        <button
          onClick={() => navigate("/portal/apply")}
          className="w-full bg-gradient-to-r from-green-600 to-emerald-700 text-white py-4 px-6 rounded-2xl shadow-lg hover:shadow-xl transition flex items-center justify-between"
        >
          <div className="text-left">
            <p className="font-bold text-lg">📝 Apply for New Loan</p>
            <p className="text-sm text-green-100">
              Quick approval • 24–48 hours
            </p>
          </div>
          <span className="text-2xl">→</span>
        </button>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
              <button
                key={l.id}
                onClick={() => navigate(`/portal/loans/${l.id}`)}
                className="w-full text-left px-4 py-3 border-b last:border-0 flex justify-between hover:bg-gray-50"
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
              </button>
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
      </div>
    </PortalLayout>
  );
}

export default CustomerDashboard;
