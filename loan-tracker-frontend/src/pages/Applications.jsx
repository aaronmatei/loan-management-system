import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Search,
  Banknote,
  CheckCircle,
  X,
  ClipboardList,
  Calendar,
  User,
  Eye,
  AlertTriangle,
  Coins,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";

function Applications() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDisburseModal, setShowDisburseModal] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [disburseData, setDisburseData] = useState({
    disbursement_method: "mpesa",
    disbursement_reference: "",
    disbursement_date: new Date().toISOString().split("T")[0],
    start_date: new Date().toISOString().split("T")[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNote, setCounterNote] = useState("");
  const [qualifiedMax, setQualifiedMax] = useState(null);

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [appsRes, statsRes] = await Promise.all([
        api.get(
          `/loans/applications/queue${
            statusFilter !== "all" ? `?status=${statusFilter}` : ""
          }`,
        ),
        api.get("/loans/applications/stats"),
      ]);
      setApplications(appsRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartReview = async (loan) => {
    if (!window.confirm(`Start reviewing application ${loan.loan_code}?`))
      return;
    try {
      await api.post(`/loans/${loan.id}/review`);
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleApprove = async (loan) => {
    if (
      !window.confirm(
        `Approve loan ${loan.loan_code} for KES ${parseFloat(
          loan.principal_amount,
        ).toLocaleString()}?`,
      )
    )
      return;
    try {
      await api.post(`/loans/${loan.id}/approve`);
      alert("Loan approved! Ready for disbursement.");
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      alert("Please provide a rejection reason");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/loans/${selectedLoan.id}/reject`, {
        reason: rejectReason,
      });
      alert("Loan rejected");
      setShowRejectModal(false);
      setRejectReason("");
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const openCounterOffer = async (loan) => {
    setSelectedLoan(loan);
    setCounterNote("");
    setCounterAmount("");
    setQualifiedMax(null);
    setShowCounterModal(true);
    // Best-effort: prefill with what the client qualifies for, capped below
    // the requested amount.
    if (loan.client_id) {
      try {
        const res = await api.get(`/clients/${loan.client_id}/credit-profile`);
        const prof = res.data?.data ?? res.data;
        const max = prof?.eligibility?.max_recommended_amount;
        if (max != null) {
          setQualifiedMax(max);
          const principal = parseFloat(loan.principal_amount);
          setCounterAmount(String(Math.min(Number(max), principal - 1)));
        }
      } catch {
        /* prefill is best-effort */
      }
    }
  };

  const handleCounterOffer = async () => {
    const amount = parseFloat(counterAmount);
    if (!amount || amount <= 0) {
      alert("Enter a valid offer amount");
      return;
    }
    if (amount >= parseFloat(selectedLoan.principal_amount)) {
      alert("The offer must be less than the requested amount");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/loans/${selectedLoan.id}/counter-offer`, {
        offered_amount: amount,
        note: counterNote || undefined,
      });
      alert("Counter-offer sent to the client");
      setShowCounterModal(false);
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisburse = async (e) => {
    e.preventDefault();
    if (
      !window.confirm(
        `Confirm disbursement of KES ${parseFloat(
          selectedLoan.principal_amount,
        ).toLocaleString()} to ${selectedLoan.first_name}?`,
      )
    )
      return;
    setSubmitting(true);
    try {
      await api.post(`/loans/${selectedLoan.id}/disburse`, disburseData);
      alert("Loan disbursed successfully! Now active for repayment.");
      setShowDisburseModal(false);
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { color: "bg-yellow-100 text-yellow-700", icon: <Clock size={12}/> },
      under_review: { color: "bg-blue-100 text-blue-700", icon: <Search size={12}/> },
      counter_offered: { color: "bg-amber-100 text-amber-700", icon: <Banknote size={12}/> },
      approved: { color: "bg-green-100 text-green-700", icon: <CheckCircle size={12}/> },
      rejected: { color: "bg-red-100 text-red-700", icon: <X size={12}/> },
    };
    return badges[status] || { color: "bg-gray-100 text-gray-700", icon: null };
  };

  if (loading) return <div className="p-4 lg:p-8">Loading...</div>;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardList size={28}/> Loan Applications
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            Review and process loan applications
          </p>
        </div>
        <PermissionGate permission="loans:create">
          <button
            onClick={() => navigate("/loans?newApplication=true")}
            className="px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg w-full sm:w-auto"
          >
            + New Application
          </button>
        </PermissionGate>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4 mb-6">
        <button
          onClick={() => setStatusFilter("pending")}
          className={`text-left rounded-xl shadow-lg p-4 lg:p-6 transition ${
            statusFilter === "pending" ? "ring-4 ring-yellow-300" : ""
          } bg-gradient-to-br from-yellow-500 to-orange-600 text-white`}
        >
          <p className="text-yellow-100 text-xs uppercase">Pending</p>
          <p className="text-2xl lg:text-3xl font-bold mt-2">
            {stats?.pending || 0}
          </p>
          <p className="text-xs text-yellow-100 mt-1">awaiting review</p>
        </button>
        <button
          onClick={() => setStatusFilter("under_review")}
          className={`text-left rounded-xl shadow-lg p-4 lg:p-6 transition ${
            statusFilter === "under_review" ? "ring-4 ring-blue-300" : ""
          } bg-gradient-to-br from-blue-500 to-ocean-600 text-white`}
        >
          <p className="text-blue-100 text-xs uppercase">Under Review</p>
          <p className="text-2xl lg:text-3xl font-bold mt-2">
            {stats?.under_review || 0}
          </p>
          <p className="text-xs text-blue-100 mt-1">being reviewed</p>
        </button>
        <button
          onClick={() => setStatusFilter("counter_offered")}
          className={`text-left rounded-xl shadow-lg p-4 lg:p-6 transition ${
            statusFilter === "counter_offered" ? "ring-4 ring-amber-300" : ""
          } bg-gradient-to-br from-amber-500 to-orange-600 text-white`}
        >
          <p className="text-amber-100 text-xs uppercase">Counter-offered</p>
          <p className="text-2xl lg:text-3xl font-bold mt-2">
            {stats?.counter_offered || 0}
          </p>
          <p className="text-xs text-amber-100 mt-1">awaiting client</p>
        </button>
        <button
          onClick={() => setStatusFilter("approved")}
          className={`text-left rounded-xl shadow-lg p-4 lg:p-6 transition ${
            statusFilter === "approved" ? "ring-4 ring-green-300" : ""
          } bg-gradient-to-br from-green-500 to-emerald-600 text-white`}
        >
          <p className="text-green-100 text-xs uppercase">Approved</p>
          <p className="text-2xl lg:text-3xl font-bold mt-2">
            {stats?.approved || 0}
          </p>
          <p className="text-xs text-green-100 mt-1">ready to disburse</p>
        </button>
        <button
          onClick={() => setStatusFilter("rejected")}
          className={`text-left rounded-xl shadow-lg p-4 lg:p-6 transition ${
            statusFilter === "rejected" ? "ring-4 ring-red-300" : ""
          } bg-gradient-to-br from-red-500 to-pink-600 text-white`}
        >
          <p className="text-red-100 text-xs uppercase">Rejected</p>
          <p className="text-2xl lg:text-3xl font-bold mt-2">
            {stats?.rejected || 0}
          </p>
          <p className="text-xs text-red-100 mt-1">declined</p>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-4 border-b">
        {[
          { value: "pending", label: <span className="inline-flex items-center gap-1"><Clock size={14}/> Pending</span> },
          { value: "under_review", label: <span className="inline-flex items-center gap-1"><Search size={14}/> Under Review</span> },
          { value: "counter_offered", label: <span className="inline-flex items-center gap-1"><Banknote size={14}/> Counter-offered</span> },
          { value: "approved", label: <span className="inline-flex items-center gap-1"><CheckCircle size={14}/> Approved (Ready)</span> },
          { value: "rejected", label: <span className="inline-flex items-center gap-1"><X size={14}/> Rejected</span> },
          { value: "all", label: <span className="inline-flex items-center gap-1"><ClipboardList size={14}/> All</span> },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg transition ${
              statusFilter === tab.value
                ? "bg-ocean-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Applications list */}
      <div className="space-y-3">
        {applications.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-500">
            No applications found
          </div>
        ) : (
          applications.map((app) => {
            const badge = getStatusBadge(app.status);
            return (
              <div
                key={app.id}
                className="bg-white rounded-xl shadow-md p-4 lg:p-6"
              >
                <div className="flex flex-col lg:flex-row lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${badge.color}`}
                      >
                        {badge.icon}{" "}
                        {app.status.replace("_", " ").toUpperCase()}
                      </span>
                      <div className="flex-1">
                        <p className="font-mono text-ocean-600 text-sm font-bold">
                          {app.loan_code}
                        </p>
                        <h3 className="text-lg font-bold text-gray-800">
                          {app.first_name} {app.last_name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {app.phone_number} • {app.client_code}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-gray-500">Principal</p>
                        <p className="font-bold text-lg">
                          KES{" "}
                          {parseFloat(
                            app.principal_amount,
                          ).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total Due</p>
                        <p className="font-bold">
                          KES{" "}
                          {parseFloat(
                            app.total_amount_due,
                          ).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Duration</p>
                        <p className="font-bold">
                          {app.loan_duration_months} months
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Interest Rate</p>
                        <p className="font-bold">
                          {(parseFloat(app.interest_rate) * 12).toFixed(2)}%
                          p.a.
                        </p>
                      </div>
                    </div>

                    {app.purpose && (
                      <div className="mb-2">
                        <p className="text-xs text-gray-500">Purpose:</p>
                        <p className="text-sm text-gray-700">{app.purpose}</p>
                      </div>
                    )}

                    {app.rejection_reason && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2">
                        <p className="text-xs font-semibold text-red-700">
                          Rejection Reason:
                        </p>
                        <p className="text-sm text-red-600">
                          {app.rejection_reason}
                        </p>
                      </div>
                    )}

                    <div className="text-xs text-gray-500 mt-3 flex flex-wrap gap-x-4 items-center">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12}/> Applied:{" "}
                        {app.application_date
                          ? new Date(
                              app.application_date,
                            ).toLocaleDateString()
                          : "—"}
                      </span>
                      {app.created_by_name && (
                        <span className="inline-flex items-center gap-1"><User size={12}/> By: {app.created_by_name}</span>
                      )}
                      {app.reviewed_by_name && (
                        <span className="inline-flex items-center gap-1"><Search size={12}/> Reviewed: {app.reviewed_by_name}</span>
                      )}
                      {app.approved_by_name && (
                        <span className="inline-flex items-center gap-1"><CheckCircle size={12}/> Approved: {app.approved_by_name}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {app.status === "pending" && (
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => handleStartReview(app)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                        >
                          <Search size={16}/> Start Review
                        </button>
                      </PermissionGate>
                    )}

                    {/* Approve only AFTER review — pending must be reviewed first */}
                    {app.status === "under_review" && (
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => handleApprove(app)}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                        >
                          <CheckCircle size={16}/> Approve
                        </button>
                      </PermissionGate>
                    )}

                    {["pending", "under_review"].includes(app.status) && (
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => {
                            setSelectedLoan(app);
                            setRejectReason("");
                            setShowRejectModal(true);
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                        >
                          <X size={16}/> Reject
                        </button>
                        <button
                          onClick={() => openCounterOffer(app)}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                        >
                          <Banknote size={16}/> Counter-offer
                        </button>
                      </PermissionGate>
                    )}

                    {app.status === "approved" && (
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => {
                            setSelectedLoan(app);
                            setShowDisburseModal(true);
                          }}
                          className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                        >
                          <Coins size={16}/> Disburse
                        </button>
                      </PermissionGate>
                    )}

                    <button
                      onClick={() => navigate(`/loans/${app.id}`)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm whitespace-nowrap inline-flex items-center gap-2"
                    >
                      <Eye size={16}/> View Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && selectedLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><X size={20} className="text-red-600"/> Reject Application</h3>
            <p className="text-gray-600 mb-4">
              Loan: <strong>{selectedLoan.loan_code}</strong>
              <br />
              Client:{" "}
              <strong>
                {selectedLoan.first_name} {selectedLoan.last_name}
              </strong>
            </p>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">
                Rejection Reason *
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows="4"
                placeholder="Provide a clear reason for rejection..."
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                This will be visible in the audit log
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRejectModal(false)}
                disabled={submitting}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={submitting || !rejectReason.trim()}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? "Rejecting..." : <span className="inline-flex items-center gap-2"><X size={16}/> Reject Application</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Counter-offer modal */}
      {showCounterModal && selectedLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Banknote size={20} className="text-amber-500"/> Counter-offer</h3>
            <p className="text-gray-600 mb-4">
              Loan: <strong>{selectedLoan.loan_code}</strong>
              <br />
              Requested:{" "}
              <strong>
                KES {parseFloat(selectedLoan.principal_amount).toLocaleString()}
              </strong>
              {qualifiedMax != null && (
                <>
                  <br />
                  Qualifies for ≈{" "}
                  <strong>
                    KES {parseFloat(qualifiedMax).toLocaleString()}
                  </strong>
                </>
              )}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">
                Offer Amount (KES) *
              </label>
              <input
                type="number"
                value={counterAmount}
                onChange={(e) => setCounterAmount(e.target.value)}
                min="1"
                placeholder="e.g. 30000"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be less than the requested amount. The client accepts or
                declines this offer in their portal.
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">
                Note to client (optional)
              </label>
              <textarea
                value={counterNote}
                onChange={(e) => setCounterNote(e.target.value)}
                rows="2"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCounterModal(false)}
                disabled={submitting}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCounterOffer}
                disabled={submitting || !counterAmount}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50"
              >
                {submitting ? "Sending..." : <span className="inline-flex items-center gap-2"><Banknote size={16}/> Send Offer</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disburse modal */}
      {showDisburseModal && selectedLoan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Coins size={20} className="text-ocean-600"/> Disburse Loan</h3>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-green-800">
                <strong>Amount:</strong> KES{" "}
                {parseFloat(
                  selectedLoan.principal_amount,
                ).toLocaleString()}
                <br />
                <strong>Client:</strong> {selectedLoan.first_name}{" "}
                {selectedLoan.last_name}
                <br />
                <strong>Phone:</strong> {selectedLoan.phone_number}
              </p>
            </div>
            <form onSubmit={handleDisburse} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Disbursement Method *
                </label>
                <select
                  value={disburseData.disbursement_method}
                  onChange={(e) =>
                    setDisburseData({
                      ...disburseData,
                      disbursement_method: e.target.value,
                    })
                  }
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                >
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Reference (Transaction ID/Cheque #)
                </label>
                <input
                  type="text"
                  value={disburseData.disbursement_reference}
                  onChange={(e) =>
                    setDisburseData({
                      ...disburseData,
                      disbursement_reference: e.target.value,
                    })
                  }
                  placeholder="e.g., QGH5XXX or Cheque #001"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Disbursement Date *
                  </label>
                  <input
                    type="date"
                    value={disburseData.disbursement_date}
                    onChange={(e) =>
                      setDisburseData({
                        ...disburseData,
                        disbursement_date: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Loan Start Date *
                  </label>
                  <input
                    type="date"
                    value={disburseData.start_date}
                    onChange={(e) =>
                      setDisburseData({
                        ...disburseData,
                        start_date: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-xs text-yellow-800 flex items-start gap-1">
                  <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5"/> This marks the loan ACTIVE, creates the payment
                  schedule, debits the capital pool, and sends the
                  agreement.
                </p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowDisburseModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Disbursing..." : <span className="inline-flex items-center gap-2"><Coins size={16}/> Disburse Now</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Applications;
