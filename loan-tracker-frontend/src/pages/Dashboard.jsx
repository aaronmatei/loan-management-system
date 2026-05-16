import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [activities, setActivities] = useState({
    recent_loans: [],
    recent_payments: [],
  });
  const [trends, setTrends] = useState({ loans_trend: [], payments_trend: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [summaryRes, activitiesRes, trendsRes] = await Promise.all([
        api.get("/dashboard/summary"),
        api.get("/dashboard/recent-activities"),
        api.get("/dashboard/monthly-trends"),
      ]);

      setMetrics(summaryRes.data.data);
      setActivities(activitiesRes.data.data);
      setTrends(trendsRes.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load dashboard");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  // Get max for trend bars
  const maxPaymentAmount = Math.max(
    ...trends.payments_trend.map((t) => parseFloat(t.total_amount)),
    1,
  );
  const maxLoanAmount = Math.max(
    ...trends.loans_trend.map((t) => parseFloat(t.total_amount)),
    1,
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-600 mt-2">
          Welcome back,{" "}
          <span className="font-semibold">{user?.first_name}</span>! 👋
        </p>
      </div>

      {/* Alert Cards (only show if there are alerts) */}
      {(metrics.overdue_count > 0 || metrics.pending_refunds > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {metrics.overdue_count > 0 && (
            <div
              onClick={() => navigate("/loans")}
              className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg cursor-pointer hover:bg-red-100 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-red-700">
                    ⚠️ Overdue Payments
                  </p>
                  <p className="text-2xl font-bold text-red-800 mt-1">
                    {metrics.overdue_count} payments
                  </p>
                  <p className="text-sm text-red-600 mt-1">
                    KES {metrics.overdue_amount.toLocaleString()} pending
                  </p>
                </div>
                <span className="text-3xl">⚠️</span>
              </div>
            </div>
          )}

          {metrics.pending_refunds > 0 && (
            <div
              onClick={() => navigate("/loans")}
              className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded-lg cursor-pointer hover:bg-purple-100 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-purple-700">
                    💰 Pending Refunds
                  </p>
                  <p className="text-2xl font-bold text-purple-800 mt-1">
                    {metrics.pending_refunds}{" "}
                    {metrics.pending_refunds === 1 ? "refund" : "refunds"}
                  </p>
                  <p className="text-sm text-purple-600 mt-1">
                    KES {metrics.total_overpayment.toLocaleString()} to refund
                  </p>
                </div>
                <span className="text-3xl">💰</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total Portfolio */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-indigo-100 text-sm uppercase font-semibold">
            Total Portfolio
          </p>
          <p className="text-3xl font-bold mt-2">
            KES {metrics.total_amount_due.toLocaleString()}
          </p>
          <p className="text-indigo-100 text-sm mt-2">
            {metrics.total_loans} loans • {metrics.active_loans} active
          </p>
        </div>

        {/* Collected */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-green-100 text-sm uppercase font-semibold">
            Collected
          </p>
          <p className="text-3xl font-bold mt-2">
            KES {metrics.total_collected.toLocaleString()}
          </p>
          <p className="text-green-100 text-sm mt-2">
            {metrics.total_transactions} payments
          </p>
        </div>

        {/* Outstanding */}
        <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-orange-100 text-sm uppercase font-semibold">
            Outstanding
          </p>
          <p className="text-3xl font-bold mt-2">
            KES {metrics.outstanding_balance.toLocaleString()}
          </p>
          <p className="text-orange-100 text-sm mt-2">To be collected</p>
        </div>

        {/* Collection Rate */}
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-blue-100 text-sm uppercase font-semibold">
            Collection Rate
          </p>
          <p className="text-3xl font-bold mt-2">{metrics.collection_rate}%</p>
          <div className="w-full bg-white/20 rounded-full h-2 mt-3">
            <div
              className="bg-white h-2 rounded-full"
              style={{ width: `${Math.min(metrics.collection_rate, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-indigo-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Total Clients
          </p>
          <p className="text-xl font-bold text-gray-800 mt-1">
            {metrics.total_clients}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {metrics.active_clients} active
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-green-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Completed Loans
          </p>
          <p className="text-xl font-bold text-green-600 mt-1">
            {metrics.completed_loans}
          </p>
          <p className="text-xs text-gray-500 mt-1">Fully repaid</p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-yellow-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Upcoming (7 days)
          </p>
          <p className="text-xl font-bold text-yellow-600 mt-1">
            {metrics.upcoming_count}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            KES {metrics.upcoming_amount.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-purple-500">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Total Interest
          </p>
          <p className="text-xl font-bold text-purple-600 mt-1">
            KES {metrics.total_interest.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">Earned</p>
        </div>
      </div>

      {/* Trends Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Payments Trend */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            💵 Payments (Last 6 Months)
          </h3>
          {trends.payments_trend.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No payment data yet
            </p>
          ) : (
            <div className="space-y-3">
              {trends.payments_trend.map((item) => {
                const amount = parseFloat(item.total_amount);
                const percentage = (amount / maxPaymentAmount) * 100;
                return (
                  <div key={item.month}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-gray-700">
                        {item.month_label}
                      </span>
                      <span className="text-sm font-bold text-green-600">
                        KES {amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-green-500 to-emerald-600 h-3 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.count} payments
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Loans Trend */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            💰 Loans Issued (Last 6 Months)
          </h3>
          {trends.loans_trend.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No loan data yet</p>
          ) : (
            <div className="space-y-3">
              {trends.loans_trend.map((item) => {
                const amount = parseFloat(item.total_amount);
                const percentage = (amount / maxLoanAmount) * 100;
                return (
                  <div key={item.month}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-semibold text-gray-700">
                        {item.month_label}
                      </span>
                      <span className="text-sm font-bold text-indigo-600">
                        KES {amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-purple-600 h-3 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {item.count} loans
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Loans */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800">📋 Recent Loans</h3>
            <button
              onClick={() => navigate("/loans")}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold"
            >
              View all →
            </button>
          </div>
          {activities.recent_loans.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No loans yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activities.recent_loans.map((loan) => (
                <div
                  key={loan.id}
                  onClick={() => navigate(`/loans/${loan.id}`)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {loan.first_name} {loan.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {loan.loan_code} • {loan.phone_number}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-800">
                        KES {parseFloat(loan.principal_amount).toLocaleString()}
                      </p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${
                          loan.status === "active"
                            ? "bg-green-100 text-green-700"
                            : loan.status === "completed"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {loan.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-800">
              💵 Recent Payments
            </h3>
            <button
              onClick={() => navigate("/payments")}
              className="text-green-600 hover:text-green-800 text-sm font-semibold"
            >
              View all →
            </button>
          </div>
          {activities.recent_payments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No payments yet</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {activities.recent_payments.map((payment) => (
                <div
                  key={payment.id}
                  className="p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {payment.first_name} {payment.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {payment.loan_code} • {payment.payment_method}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(payment.payment_date).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">
                        KES {parseFloat(payment.amount_paid).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">
                        {payment.transaction_code}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
