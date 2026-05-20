import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

function CustomerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Quick Calculator state — calc widget at the bottom of the dashboard
  const [calcPolicy, setCalcPolicy] = useState(null);
  const [calcAmount, setCalcAmount] = useState(50000);
  const [calcDuration, setCalcDuration] = useState(6);

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
    // Best-effort fetch for the Quick Calculator. If it fails (e.g. no
    // active link yet), the widget simply hides itself.
    portalApi
      .get("/portal/customer/calculator-policies")
      .then((r) => {
        const list = r.data.data || [];
        const current = (() => {
          try {
            return JSON.parse(
              localStorage.getItem("portal_current_tenant") || "{}",
            );
          } catch {
            return {};
          }
        })();
        const pick =
          list.find((t) => t.tenant_id === current?.id) || list[0] || null;
        setCalcPolicy(pick);
      })
      .catch(() => {});
  }, [navigate]);

  // Live compute (memo-light — three primitives so this is fine inline)
  const calcResult = (() => {
    if (!calcPolicy || !calcAmount || !calcDuration) return null;
    const p = parseFloat(calcAmount);
    const m = parseInt(calcDuration, 10);
    const r = parseFloat(calcPolicy.default_interest_rate) / 12 / 100;
    const interest = p * r * m;
    const total = p + interest;
    return { monthly: total / m, interest, total };
  })();

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

        {calcPolicy && (
          <section className="bg-white rounded-xl shadow overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="font-bold text-gray-800">
                🧮 Quick Loan Calculator
              </h2>
              <button
                onClick={() => navigate("/portal/calculator")}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Open full calculator →
              </button>
            </div>
            <div className="p-4 grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Amount (KES)
                  </label>
                  <input
                    type="number"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(e.target.value)}
                    min={calcPolicy.min_amount}
                    max={calcPolicy.max_amount}
                    step="1000"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none font-bold text-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Duration
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 3, 6, 12, 18, 24].map((m) => (
                      <button
                        key={m}
                        onClick={() => setCalcDuration(m)}
                        className={`py-2 rounded-lg text-sm font-semibold transition ${
                          calcDuration === m
                            ? "bg-indigo-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {m}mo
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 flex flex-col justify-between">
                {calcResult ? (
                  <>
                    <div>
                      <p className="text-xs text-gray-600">Monthly Payment</p>
                      <p className="text-2xl font-bold text-indigo-700">
                        {KES(calcResult.monthly)}
                      </p>
                      <div className="mt-2 space-y-1 text-xs">
                        <p className="text-gray-600">
                          Total interest:{" "}
                          <span className="font-semibold text-orange-600">
                            {KES(calcResult.interest)}
                          </span>
                        </p>
                        <p className="text-gray-600">
                          Total to repay:{" "}
                          <span className="font-semibold">
                            {KES(calcResult.total)}
                          </span>
                        </p>
                        <p className="text-gray-500">
                          @ {calcPolicy.default_interest_rate}% p.a.
                          {calcPolicy.business_name
                            ? ` · ${calcPolicy.business_name}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        navigate(
                          `/portal/apply?amount=${calcAmount}&duration=${calcDuration}`,
                        )
                      }
                      className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm"
                    >
                      Apply for This Loan →
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">
                    Enter amount and duration.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

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
