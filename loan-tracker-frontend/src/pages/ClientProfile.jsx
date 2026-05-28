import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  Mail,
  Pencil,
  Download,
  MessageSquare,
  Send,
  IdCard,
  ClipboardList,
  CheckCircle,
  AlertTriangle,
  Coins,
  Clock,
  Banknote,
  X,
  Check,
} from "lucide-react";
import api from "../services/api";
import { KENYA_COUNTIES } from "../utils/counties";
import { BUSINESS_TYPES } from "../utils/businessTypes";

// Small status dot beside the risk label in the credit-score card.
const riskDot = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const KES = (n) => `KES ${Number(n || 0).toLocaleString()}`;

function Card({ title, value, icon, color }) {
  const accent =
    {
      indigo: "border-ocean-500",
      green: "border-green-500",
      blue: "border-blue-500",
      red: "border-red-500",
      purple: "border-ocean-500",
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

  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchClientProfile = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/clients/${id}/credit-profile`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load credit profile");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClientProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleUpdateClient = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setEditError("");
    setEditSuccess("");

    try {
      await api.put(`/clients/${id}`, editFormData);
      setEditSuccess("Client updated successfully!");
      setTimeout(() => {
        setShowEditModal(false);
        fetchClientProfile();
      }, 1500);
    } catch (err) {
      setEditError(err.response?.data?.error || "Failed to update client");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading credit profile...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error || "Profile not found"}
        </div>
        <button
          onClick={() => navigate("/clients")}
          className="px-6 py-2 bg-ocean-600 text-white font-semibold rounded-lg hover:bg-ocean-700 transition"
        >
          ← Back to Clients
        </button>
      </div>
    );
  }

  const {
    client,
    summary,
    rated,
    credit_score: creditScore,
    risk_color: riskColor,
    risk_label: riskLabel,
    eligibility,
    loans,
    recent_payments: recentPayments,
  } = data;

  const actionBtn =
    "w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-ocean-200 text-slate-700 font-semibold transition text-left";

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Page heading */}
      <div className="mb-6">
        <button
          onClick={() => navigate("/clients")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-ocean-600 mb-3"
        >
          <ArrowLeft size={16} /> Back to Clients
        </button>
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
          Client Profile
        </h1>
        <p className="text-slate-500">
          Manage client information and account details
        </p>
      </div>

      {/* Header: identity + credit score / actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        {/* Identity card */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {client.profile_photo_url ? (
              <img
                src={client.profile_photo_url}
                alt={`${client.first_name} ${client.last_name}`}
                className="w-24 h-24 rounded-full object-cover ring-4 ring-ocean-100 shrink-0"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-ocean-gradient flex items-center justify-center text-white text-2xl font-bold ring-4 ring-ocean-100 shrink-0">
                {`${(client.first_name || "").charAt(0)}${(
                  client.last_name || ""
                ).charAt(0)}`.toUpperCase() || "?"}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Client Code
              </p>
              <h2 className="text-2xl lg:text-3xl font-extrabold text-navy-900 break-all">
                {client.client_code}
              </h2>
              <p className="text-lg font-bold text-slate-800 mt-0.5">
                {client.first_name} {client.last_name}
              </p>
              <p className="text-sm text-slate-500">
                {client.business_name && `${client.business_name} · `}
                Member since{" "}
                {new Date(client.created_at).toLocaleDateString()}
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-x-5 gap-y-1.5 mt-3">
                <a
                  href={`tel:${client.phone_number}`}
                  className="inline-flex items-center gap-2 text-ocean-600 hover:text-ocean-700 font-medium"
                >
                  <Phone size={16} /> {client.phone_number}
                </a>
                {client.email && (
                  <a
                    href={`mailto:${client.email}`}
                    className="inline-flex items-center gap-2 text-ocean-600 hover:text-ocean-700 font-medium break-all"
                  >
                    <Mail size={16} /> {client.email}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Credit score + actions */}
        <div className="space-y-3">
          <div className="bg-gradient-to-br from-ocean-50 to-ocean-100 rounded-2xl border border-ocean-100 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Credit Score
            </p>
            <p className="text-4xl font-extrabold text-ocean-600 mt-1 leading-none">
              {rated ? creditScore : "New"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {rated ? "out of 100" : "unrated"}
            </p>
            <div className="inline-flex items-center gap-2 mt-3 bg-white rounded-full px-3 py-1 shadow-sm">
              <span
                className={`w-2 h-2 rounded-full ${
                  riskDot[riskColor] || "bg-ocean-400"
                }`}
              />
              <span className="text-sm font-semibold text-slate-700">
                {riskLabel}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => {
                setEditFormData({ ...client });
                setEditError("");
                setEditSuccess("");
                setShowEditModal(true);
              }}
              className={actionBtn}
            >
              <Pencil size={18} className="text-ocean-600" /> Edit Client
            </button>
            <button
              onClick={async () => {
                try {
                  const response = await api.get(
                    `/reports/pdf/client-statement/${client.id}`,
                    { responseType: "blob" },
                  );
                  const blob = new Blob([response.data], {
                    type: "application/pdf",
                  });
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `statement_${client.client_code}.pdf`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                } catch (err) {
                  alert(
                    "Failed to download statement: " +
                      (err.response?.data?.error || err.message),
                  );
                }
              }}
              className={actionBtn}
            >
              <Download size={18} className="text-ocean-600" /> Download Statement
            </button>
            <button
              onClick={() =>
                navigate("/sms", {
                  state: { preSelectClient: client.id },
                })
              }
              className={actionBtn}
            >
              <MessageSquare size={18} className="text-ocean-600" /> Send SMS
            </button>
            <button
              onClick={async () => {
                if (!client.email) {
                  alert("This client has no email address");
                  return;
                }
                if (
                  !window.confirm(
                    `Email the account statement to ${client.email}?`,
                  )
                )
                  return;
                try {
                  const res = await api.post(
                    `/email/send-statement/${client.id}`,
                  );
                  alert(res.data?.message || "Statement sent");
                } catch (err) {
                  alert(
                    "Failed: " + (err.response?.data?.error || err.message),
                  );
                }
              }}
              className={actionBtn}
            >
              <Send size={18} className="text-ocean-600" /> Email Statement
            </button>
          </div>
        </div>
      </div>

      {/* Identity documents — from the client's linked customer-portal account */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
          <IdCard size={20} className="text-gray-600" /> Identity Documents
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Uploaded by the client in the customer portal. Click an image to view
          it full-size.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            ["profile_photo_url", "Profile Photo", "rounded-full"],
            ["id_front_url", "ID — Front", "rounded-xl"],
            ["id_back_url", "ID — Back", "rounded-xl"],
          ].map(([key, label, shape]) => (
            <div key={key} className="text-center">
              {client[key] ? (
                <a
                  href={client[key]}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  <img
                    src={client[key]}
                    alt={label}
                    className={`w-full aspect-square object-cover border border-gray-200 ${shape}`}
                  />
                </a>
              ) : (
                <div
                  className={`w-full aspect-square bg-gray-100 flex items-center justify-center text-sm text-gray-400 border border-gray-200 ${shape}`}
                >
                  Not uploaded
                </div>
              )}
              <p className="text-sm font-semibold text-gray-700 mt-2">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card
          title="Total Loans"
          value={summary.total_loans_count}
          icon={<ClipboardList size={14} className="inline mr-1 text-gray-400" />}
          color="indigo"
        />
        <Card
          title="Active"
          value={summary.active_loans_count}
          icon={<CheckCircle size={14} className="inline mr-1 text-green-500" />}
          color="green"
        />
        <Card
          title="Completed"
          value={summary.completed_loans_count}
          icon={<CheckCircle size={14} className="inline mr-1 text-blue-500" />}
          color="blue"
        />
        <Card
          title="Defaulted"
          value={summary.defaulted_loans_count}
          icon={<AlertTriangle size={14} className="inline mr-1 text-red-500" />}
          color="red"
        />
        <Card
          title="On-Time Rate"
          value={summary.on_time_rate == null ? "—" : `${summary.on_time_rate}%`}
          icon={<Clock size={14} className="inline mr-1 text-gray-400" />}
          color="green"
        />
        <Card
          title="Total Borrowed"
          value={KES(summary.total_borrowed)}
          icon={<Coins size={14} className="inline mr-1 text-gray-400" />}
          color="purple"
        />
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-ocean-500">
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
            <p className="text-sm text-red-600 mt-1 font-semibold flex items-center gap-1">
              <AlertTriangle size={14} className="shrink-0" /> {summary.current_overdue_count} overdue
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
              className={`text-xl font-bold flex items-center gap-2 ${
                eligibility.can_borrow ? "text-green-800" : "text-red-800"
              }`}
            >
              {eligibility.can_borrow
                ? <><CheckCircle size={20} /> Eligible for New Loan</>
                : <><X size={20} /> Not Eligible</>}
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
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <ClipboardList size={20} className="text-gray-500" /> Loan History
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {loans.length} loan{loans.length !== 1 ? "s" : ""} total
          </p>
        </div>
        {loans.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="flex justify-center mb-2">
              <ClipboardList size={40} className="text-gray-300" />
            </div>
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
                    className="border-b border-gray-100 hover:bg-ocean-50 transition cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-ocean-600">
                      {loan.loan_code}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-800">
                      {KES(loan.principal_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-ocean-600">
                      {KES(loan.total_amount_due)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">
                      {KES(loan.total_paid)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-orange-600">
                      {KES(loan.balance_due)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {loan.start_date
                        ? new Date(loan.start_date).toLocaleDateString()
                        : "—"}
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
                      <span className="text-ocean-600 font-bold">→</span>
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
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Banknote size={20} className="text-gray-500" /> Recent Payments
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Last {recentPayments.length} payment
            {recentPayments.length !== 1 ? "s" : ""}
          </p>
        </div>
        {recentPayments.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="flex justify-center mb-2">
              <Banknote size={40} className="text-gray-300" />
            </div>
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
                    <td className="px-6 py-3 font-mono text-sm text-ocean-600">
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

      {/* Edit Client Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-3xl w-full my-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-gray-800">Edit Client</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={22} />
              </button>
            </div>

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                {editError}
              </div>
            )}

            {editSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
                <CheckCircle size={16} className="text-green-500 shrink-0" />{editSuccess}
              </div>
            )}

            <form onSubmit={handleUpdateClient} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    value={editFormData.first_name || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        first_name: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    value={editFormData.last_name || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        last_name: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="text"
                    value={editFormData.phone_number || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        phone_number: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editFormData.email || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        email: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    ID Number
                  </label>
                  <input
                    type="text"
                    value={editFormData.id_number || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        id_number: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={editFormData.status || "active"}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        status: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blacklisted">Blacklisted</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Business Name
                  </label>
                  <input
                    type="text"
                    value={editFormData.business_name || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        business_name: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Business Type
                  </label>
                  <select
                    value={editFormData.business_type || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        business_type: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                  >
                    <option value="">-- Select Type --</option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={
                      editFormData.date_of_birth
                        ? String(editFormData.date_of_birth).split("T")[0]
                        : ""
                    }
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        date_of_birth: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Gender
                  </label>
                  <select
                    value={editFormData.gender || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        gender: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                  >
                    <option value="">-- Select --</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={editFormData.city || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        city: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    County
                  </label>
                  <select
                    value={editFormData.county || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        county: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                  >
                    <option value="">-- Select County --</option>
                    {KENYA_COUNTIES.map((county) => (
                      <option key={county} value={county}>
                        {county}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={editFormData.address || ""}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      address: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={submitting}
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
                >
                  {submitting ? "Saving..." : <span className="inline-flex items-center gap-1"><Check size={16} /> Save Changes</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClientProfile;
