import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";

const KES = (n) => `KES ${Number(n || 0).toLocaleString()}`;

// Risk badge styling keyed off the API's risk_color
const riskBadge = {
  green: "bg-green-500 text-white",
  yellow: "bg-yellow-400 text-yellow-900",
  orange: "bg-orange-500 text-white",
  red: "bg-red-600 text-white",
};

function Card({ title, value, icon, color }) {
  const accent =
    {
      indigo: "border-indigo-500",
      green: "border-green-500",
      blue: "border-blue-500",
      red: "border-red-500",
      purple: "border-purple-500",
    }[color] || "border-gray-300";

  return (
    <div className={`bg-white rounded-xl shadow-md p-4 border-l-4 ${accent}`}>
      <p className="text-xs text-gray-500 uppercase font-semibold">
        {icon} {title}
      </p>
      <p className="text-xl font-bold text-gray-800 mt-1 break-words">
        {value}
      </p>
    </div>
  );
}

function statusBadge(status) {
  if (status === "active") return "bg-green-100 text-green-700";
  if (status === "completed") return "bg-blue-100 text-blue-700";
  if (status === "defaulted") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get(`/clients/${id}/credit-profile`);
        if (mounted) setData(res.data.data);
      } catch (err) {
        if (mounted)
          setError(
            err.response?.data?.error || "Failed to load credit profile",
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading credit profile...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error || "Profile not found"}
        </div>
        <button
          onClick={() => navigate("/clients")}
          className="px-6 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition"
        >
          ← Back to Clients
        </button>
      </div>
    );
  }

  const {
    client,
    summary,
    credit_score: creditScore,
    risk_color: riskColor,
    risk_label: riskLabel,
    eligibility,
    loans,
    recent_payments: recentPayments,
  } = data;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-xl shadow-lg p-8 text-white mb-6">
        <button
          onClick={() => navigate("/clients")}
          className="text-white/80 hover:text-white mb-4"
        >
          ← Back to Clients
        </button>

        <div className="flex flex-wrap justify-between items-start gap-6">
          <div>
            <p className="text-indigo-100 text-sm">Client Code</p>
            <h1 className="text-3xl font-bold">{client.client_code}</h1>
            <p className="text-xl mt-2">
              {client.first_name} {client.last_name}
            </p>
            <p className="text-indigo-100 mt-1">
              📱 {client.phone_number}{" "}
              {client.email && `• ✉️ ${client.email}`}
            </p>
            <p className="text-indigo-100 text-sm mt-1">
              {client.business_name && `🏢 ${client.business_name} • `}
              Member since{" "}
              {new Date(client.created_at).toLocaleDateString()}
            </p>
          </div>

          {/* Credit Score Badge */}
          <div className="text-center bg-white/10 rounded-xl p-6">
            <p className="text-xs text-indigo-100 uppercase">Credit Score</p>
            <p className="text-5xl font-bold mt-2">{creditScore}</p>
            <p className="text-sm text-indigo-100">out of 100</p>
            <div
              className={`mt-2 px-3 py-1 rounded-full text-sm font-bold ${
                riskBadge[riskColor] || "bg-gray-200 text-gray-800"
              }`}
            >
              {riskLabel}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card
          title="Total Loans"
          value={summary.total_loans_count}
          icon="📋"
          color="indigo"
        />
        <Card
          title="Active"
          value={summary.active_loans_count}
          icon="🟢"
          color="green"
        />
        <Card
          title="Completed"
          value={summary.completed_loans_count}
          icon="✅"
          color="blue"
        />
        <Card
          title="Defaulted"
          value={summary.defaulted_loans_count}
          icon="🔴"
          color="red"
        />
        <Card
          title="On-Time Rate"
          value={`${summary.on_time_rate}%`}
          icon="⏱️"
          color="green"
        />
        <Card
          title="Total Borrowed"
          value={KES(summary.total_borrowed)}
          icon="💰"
          color="purple"
        />
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-500">
          <p className="text-sm text-gray-500 uppercase">Lifetime Borrowed</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">
            {KES(summary.total_borrowed)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Across {summary.total_loans_count} loans
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-500">
          <p className="text-sm text-gray-500 uppercase">Total Repaid</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {KES(summary.total_repaid)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {summary.total_payments} payments made
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-orange-500">
          <p className="text-sm text-gray-500 uppercase">
            Current Outstanding
          </p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            {KES(summary.current_outstanding)}
          </p>
          {summary.current_overdue_count > 0 && (
            <p className="text-sm text-red-600 mt-1 font-semibold">
              ⚠️ {summary.current_overdue_count} overdue
            </p>
          )}
        </div>
      </div>

      {/* Eligibility */}
      <div
        className={`rounded-xl shadow-md p-6 mb-6 border-2 ${
          eligibility.can_borrow
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3
              className={`text-xl font-bold ${
                eligibility.can_borrow ? "text-green-800" : "text-red-800"
              }`}
            >
              {eligibility.can_borrow
                ? "✅ Eligible for New Loan"
                : "❌ Not Eligible"}
            </h3>
            <p className="text-gray-700 mt-2">{eligibility.reason}</p>

            {eligibility.can_borrow && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Recommended Max</p>
                  <p className="text-xl font-bold text-green-700">
                    {KES(eligibility.max_recommended_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Recommended Rate</p>
                  <p className="text-xl font-bold text-green-700">
                    {eligibility.recommended_interest_rate}% p.a.
                  </p>
                </div>
              </div>
            )}

            {!eligibility.can_borrow && (
              <div className="mt-4">
                <p className="font-semibold text-red-700 mb-2">
                  Issues to Resolve:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {eligibility.blockers.map((blocker, idx) => (
                    <li key={idx} className="text-red-700">
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {eligibility.can_borrow && (
            <button
              onClick={() =>
                navigate("/loans", {
                  state: { preSelectClient: client.id },
                })
              }
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
            >
              + Create Loan
            </button>
          )}
        </div>
      </div>

      {/* Loans History */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">
            📋 Loan History
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {loans.length} loan{loans.length !== 1 ? "s" : ""} total
          </p>
        </div>
        {loans.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <p>No loans yet</p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-200px)]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Loan Code
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Principal
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Total Due
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Paid
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Balance
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Start Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                    View
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr
                    key={loan.id}
                    onClick={() => navigate(`/loans/${loan.id}`)}
                    className="border-b border-gray-100 hover:bg-indigo-50 transition cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-indigo-600">
                      {loan.loan_code}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-800">
                      {KES(loan.principal_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-indigo-600">
                      {KES(loan.total_amount_due)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">
                      {KES(loan.total_paid)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-orange-600">
                      {KES(loan.balance_due)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(loan.start_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(
                          loan.status,
                        )}`}
                      >
                        {loan.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-indigo-600 font-bold">→</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Payments */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">
            💵 Recent Payments
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Last {recentPayments.length} payment
            {recentPayments.length !== 1 ? "s" : ""}
          </p>
        </div>
        {recentPayments.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="text-4xl mb-2">💵</div>
            <p>No payments recorded yet</p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-200px)]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Transaction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Loan Code
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Method
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p, idx) => (
                  <tr
                    key={p.transaction_code || idx}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="px-6 py-3 font-mono text-sm font-semibold text-green-600">
                      {p.transaction_code}
                    </td>
                    <td className="px-6 py-3 font-mono text-sm text-indigo-600">
                      {p.loan_code}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-green-600">
                      {KES(p.amount_paid)}
                    </td>
                    <td className="px-6 py-3 text-gray-700 text-sm">
                      {new Date(p.payment_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                        {p.payment_method}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClientProfile;
