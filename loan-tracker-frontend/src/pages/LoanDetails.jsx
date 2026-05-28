import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FileText,
  Smartphone,
  Mail,
  StickyNote,
  CheckCircle,
  Coins,
  Calendar,
  BarChart3,
  ClipboardList,
  Receipt,
  Download,
  PartyPopper,
  Check,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  HandCoins,
  RotateCcw,
  XCircle,
  Clock,
} from "lucide-react";
import api from "../services/api";
import PaymentReceipt from "../components/PaymentReceipt";
import PermissionGate from "../components/PermissionGate";

function LoanDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loanData, setLoanData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundData, setRefundData] = useState({
    refund_method: "M-Pesa",
    refund_reference: "",
    refunded_date: new Date().toISOString().split("T")[0],
  });
  const [processingRefund, setProcessingRefund] = useState(false);

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusFormData, setStatusFormData] = useState({
    status: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  // Which past payment's receipt modal is open (the transaction row).
  const [receiptTxn, setReceiptTxn] = useState(null);

  // Edit / delete modals.
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Waivers (commit 2 of the waiver feature).
  const [waivers, setWaivers] = useState([]);
  const [waiversLoading, setWaiversLoading] = useState(false);
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [waiverForm, setWaiverForm] = useState({
    type: "penalty",
    amount: "",
    reason: "",
    notes: "",
  });
  const [savingWaiver, setSavingWaiver] = useState(false);
  const [waiverError, setWaiverError] = useState("");
  // Reverse-waiver confirmation modal.
  const [reversingWaiver, setReversingWaiver] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversingBusy, setReversingBusy] = useState(false);

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();
  const isAdminRole = currentUser?.role === "admin";

  useEffect(() => {
    fetchLoanDetails();
    fetchWaivers();
  }, [id]);

  const fetchWaivers = async () => {
    setWaiversLoading(true);
    try {
      const r = await api.get(`/loans/${id}/waivers`);
      setWaivers(r.data.data || []);
    } catch (err) {
      console.error("Failed to load waivers:", err);
    } finally {
      setWaiversLoading(false);
    }
  };

  const openWaiverModal = () => {
    setWaiverForm({ type: "penalty", amount: "", reason: "", notes: "" });
    setWaiverError("");
    setShowWaiverModal(true);
  };

  const handleSubmitWaiver = async (e) => {
    e.preventDefault();
    if (!waiverForm.reason.trim()) {
      setWaiverError("Please give a reason for the waiver.");
      return;
    }
    if (!waiverForm.amount || parseFloat(waiverForm.amount) <= 0) {
      setWaiverError("Amount must be greater than zero.");
      return;
    }
    setSavingWaiver(true);
    setWaiverError("");
    try {
      await api.post(`/loans/${id}/waivers`, {
        ...waiverForm,
        amount: parseFloat(waiverForm.amount),
      });
      setShowWaiverModal(false);
      // Refresh both the loan summary (balance changes if admin
      // auto-approved) and the waivers list.
      fetchLoanDetails();
      fetchWaivers();
    } catch (err) {
      setWaiverError(err.response?.data?.error || "Failed to record waiver");
    } finally {
      setSavingWaiver(false);
    }
  };

  const handleReverseWaiver = async () => {
    if (!reversingWaiver) return;
    if (!reversalReason.trim()) return;
    setReversingBusy(true);
    try {
      await api.post(`/waivers/${reversingWaiver.id}/reverse`, {
        reversal_reason: reversalReason.trim(),
      });
      setReversingWaiver(null);
      setReversalReason("");
      fetchLoanDetails();
      fetchWaivers();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to reverse waiver");
    } finally {
      setReversingBusy(false);
    }
  };

  const fetchLoanDetails = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/payments/loan/${id}/summary`);
      setLoanData(response.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load loan details");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError("");

    try {
      await api.put(`/loans/${id}`, statusFormData);
      setShowStatusModal(false);
      fetchLoanDetails();
    } catch (err) {
      setActionError(
        err.response?.data?.error || "Failed to update loan",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Open the edit modal pre-filled with the current loan's values.
  // interest_rate stored as monthly — convert to annual for the form.
  const openEditModal = () => {
    if (!loanData?.loan) return;
    const l = loanData.loan;
    const monthlyRate = parseFloat(l.interest_rate) || 0;
    const ymdFor = (v) =>
      v ? new Date(v).toISOString().split("T")[0] : "";
    setEditForm({
      principal_amount: l.principal_amount,
      annual_interest_rate: (monthlyRate * 12).toFixed(4),
      monthly_interest_rate: monthlyRate.toFixed(4),
      loan_duration_months: l.loan_duration_months,
      processing_fee_rate: l.processing_fee_rate || 0,
      application_date:
        ymdFor(l.application_date) ||
        new Date().toISOString().split("T")[0],
      disbursement_date: ymdFor(l.disbursed_at),
      start_date: ymdFor(l.start_date),
      purpose: l.purpose || "",
      guarantor_name: l.guarantor_name || "",
      guarantor_phone: l.guarantor_phone || "",
      guarantor_id_number: l.guarantor_id_number || "",
      collateral_description: l.collateral_description || "",
      late_fee_enabled: parseFloat(l.late_payment_fee || 0) > 0,
      late_payment_fee: parseFloat(l.late_payment_fee || 0),
      penalty_rate: parseFloat(l.penalty_rate || 0),
      notes: l.notes || "",
    });
    setEditError("");
    setShowEditModal(true);
  };

  // "Disbursement + 1 month" as YYYY-MM-DD — the convention for
  // start_date when the admin hasn't overridden it.
  const startFromDisb = (disb) => {
    if (!disb) return "";
    const d = new Date(disb);
    if (Number.isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split("T")[0];
  };

  // Keep annual ⇄ monthly synced in the edit form (mirrors the new-loan form).
  const onEditAnnualChange = (v) =>
    setEditForm((p) => ({
      ...p,
      annual_interest_rate: v,
      monthly_interest_rate:
        v === "" ? "" : (Math.round((parseFloat(v) / 12) * 10000) / 10000).toString(),
    }));
  const onEditMonthlyChange = (v) =>
    setEditForm((p) => ({
      ...p,
      monthly_interest_rate: v,
      annual_interest_rate:
        v === "" ? "" : (Math.round(parseFloat(v) * 12 * 10000) / 10000).toString(),
    }));

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    // Date chain: application ≤ disbursement ≤ start.
    if (
      editForm.application_date &&
      editForm.disbursement_date &&
      editForm.application_date > editForm.disbursement_date
    ) {
      setEditError(
        "Loan creation date cannot be after the disbursement date.",
      );
      return;
    }
    if (
      editForm.disbursement_date &&
      editForm.start_date &&
      editForm.disbursement_date > editForm.start_date
    ) {
      setEditError(
        "Start date cannot be before the disbursement date.",
      );
      return;
    }
    setEditing(true);
    setEditError("");
    try {
      const payload = {
        ...editForm,
        late_payment_fee: editForm.late_fee_enabled
          ? parseFloat(editForm.late_payment_fee) || 0
          : 0,
      };
      // Don't send the UI-only flag to the API.
      delete payload.late_fee_enabled;
      delete payload.monthly_interest_rate;
      await api.put(`/loans/${id}/edit`, payload);
      setShowEditModal(false);
      fetchLoanDetails();
    } catch (err) {
      setEditError(err.response?.data?.error || "Failed to update loan");
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/loans/${id}`);
      navigate("/applications");
    } catch (err) {
      setDeleteError(err.response?.data?.error || "Failed to delete loan");
      setDeleting(false);
    }
  };

  const downloadPdf = async (url, filename) => {
    try {
      const response = await api.get(url, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      alert(
        "Failed to download: " +
          (err.response?.data?.error || err.message),
      );
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading loan details...
        </div>
      </div>
    );
  }

  if (error || !loanData) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error || "Loan not found"}
        </div>
        <button
          onClick={() => navigate("/loans")}
          className="px-6 py-2 bg-ocean-600 text-white font-semibold rounded-lg hover:bg-ocean-700 transition"
        >
          ← Back to Loans
        </button>
      </div>
    );
  }

  const {
    loan,
    summary,
    schedule,
    transactions,
    receipt_summary: receiptSummary,
  } = loanData;
  const today = new Date();

  // Tenant branding for the receipt (brand_color, business_name) from
  // the signed-in staff user (set at login).
  const adminTenant = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null")?.tenant || null;
    } catch {
      return null;
    }
  })();

  // Map a history transaction into the shared PaymentReceipt shape.
  // Balance is AS OF that payment (backend running fold); next-payment is
  // loan-level, suppressed when this payment already cleared the loan.
  const buildReceipt = (txn) => {
    const remainingAfter = parseFloat(
      txn.receipt?.remaining_balance_after_this ?? summary?.balance ?? 0,
    );
    const fullyPaid = remainingAfter <= 0;
    return {
      client_name: `${loan.first_name || ""} ${loan.last_name || ""}`.trim(),
      client_phone: loan.phone_number,
      client_code: loan.client_code,
      loan_code: loan.loan_code,
      principal: loan.principal_amount,
      total_amount_due: loan.total_amount_due,
      total_paid: txn.receipt?.total_paid_after_this,
      remaining_balance: remainingAfter,
      completion_percentage: txn.receipt?.completion_percentage_after_this,
      is_fully_paid: fullyPaid,
      // Per-transaction overpayment: principal-portion of this payment that
      // went beyond the still-owed balance at the time it was recorded.
      overpayment: parseFloat(txn.receipt?.overpayment_for_this || 0),
      // Penalty cleared by this specific transaction (penalty-first allocation).
      penalty_paid: parseFloat(txn.penalty_portion || 0),
      next_payment_amount: fullyPaid ? null : receiptSummary?.next_payment_amount,
      next_payment_date: fullyPaid ? null : receiptSummary?.next_payment_date,
      next_payment_number: fullyPaid ? null : receiptSummary?.next_payment_number,
    };
  };

  // Calculate days until/since due
  const getDaysStatus = (dueDate, status) => {
    if (status === "paid") return null;

    const due = new Date(dueDate);
    const diffTime = due - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        text: `${Math.abs(diffDays)} days overdue`,
        color: "text-red-600",
      };
    } else if (diffDays === 0) {
      return { text: "Due today", color: "text-orange-600" };
    } else if (diffDays <= 7) {
      return { text: `Due in ${diffDays} days`, color: "text-yellow-600" };
    } else {
      return { text: `Due in ${diffDays} days`, color: "text-gray-500" };
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Back Button */}
      <button
        onClick={() => navigate("/loans")}
        className="mb-4 text-ocean-600 hover:text-ocean-800 font-semibold flex items-center gap-2"
      >
        ← Back to Loans
      </button>

      {/* Loan Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() =>
            downloadPdf(
              `/reports/pdf/loan-statement/${loan.id}`,
              `loan_${loan.loan_code}.pdf`,
            )
          }
          className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
        >
          <Download size={16}/> Download Statement
        </button>
        <button
          onClick={() =>
            downloadPdf(
              `/reports/pdf/loan-agreement/${loan.id}`,
              `loan_agreement_${loan.loan_code}.pdf`,
            )
          }
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
        >
          <FileText size={16}/> Download Agreement
        </button>
        {(loan.status === "active" ||
          loan.status === "defaulted" ||
          loan.status === "suspended") && (
          <>
            {loan.status === "active" && (
            <>
              <button
                onClick={() => {
                  setStatusFormData({ status: "defaulted", notes: "" });
                  setActionError("");
                  setShowStatusModal(true);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-semibold"
              >
                Mark as Defaulted
              </button>
              <button
                onClick={() => {
                  setStatusFormData({ status: "suspended", notes: "" });
                  setActionError("");
                  setShowStatusModal(true);
                }}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition font-semibold"
              >
                Suspend
              </button>
            </>
          )}
          {(loan.status === "defaulted" || loan.status === "suspended") && (
            <button
              onClick={() => {
                setStatusFormData({ status: "active", notes: "" });
                setActionError("");
                setShowStatusModal(true);
              }}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold"
            >
              <span className="inline-flex items-center gap-2"><CheckCircle size={16}/> Reactivate</span>
            </button>
          )}
          </>
        )}
        {/* Edit — admin + manager. Available at any status. */}
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => openEditModal()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
          >
            <Pencil size={16} /> Edit Loan
          </button>
        </PermissionGate>
        {/* Delete — admin only, pre-disbursement statuses only. */}
        {[
          "pending",
          "under_review",
          "approved",
          "counter_offered",
          "rejected",
        ].includes(loan.status) && (
          <PermissionGate role="admin">
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
            >
              <Trash2 size={16} /> Delete
            </button>
          </PermissionGate>
        )}
        {/* Waiver — admin records directly, others request approval.
            Only meaningful on disbursed loans with an outstanding
            balance. */}
        {["active", "defaulted", "suspended"].includes(loan.status) && (
          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <button
              onClick={openWaiverModal}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
              title={
                isAdminRole
                  ? "Record a waiver (applies immediately)"
                  : "Request a waiver (admin must approve)"
              }
            >
              <HandCoins size={16} />
              {isAdminRole ? "Waive Loan" : "Request Waiver"}
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Header Card */}
      <div className="bg-ocean-gradient rounded-xl shadow-lg p-8 text-white mb-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-ocean-200 text-sm mb-1">Loan Code</p>
            <h1 className="text-3xl font-bold mb-4">{loan.loan_code}</h1>
            <p className="text-ocean-100">
              <strong className="text-white">
                {loan.first_name} {loan.last_name}
              </strong>
              <br />
              <span className="inline-flex items-center gap-1"><Smartphone size={14}/> {loan.phone_number}</span>
              {loan.email && (
                <>
                  <br />
                  <span className="inline-flex items-center gap-1"><Mail size={14}/> {loan.email}</span>
                </>
              )}
            </p>
          </div>
          <div className="text-right">
            <span
              className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
                loan.status === "active"
                  ? "bg-green-500 text-white"
                  : loan.status === "completed"
                    ? "bg-blue-500 text-white"
                    : loan.status === "defaulted"
                      ? "bg-red-500 text-white"
                      : "bg-gray-500 text-white"
              }`}
            >
              {loan.status.toUpperCase()}
            </span>
            <p className="text-ocean-200 text-xs mt-2">
              Client: {loan.client_code}
            </p>
          </div>
        </div>
      </div>

      {/* Notes */}
      {loan.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-yellow-900 mb-1 flex items-center gap-1">
            <StickyNote size={14}/> Notes
          </p>
          <p className="text-gray-700 whitespace-pre-wrap">{loan.notes}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-ocean-500">
          <p className="text-sm text-gray-500 uppercase font-semibold mb-2">
            Principal
          </p>
          <p className="text-2xl font-bold text-gray-800">
            KES {parseFloat(loan.principal_amount).toLocaleString()}
          </p>
          {parseFloat(loan.processing_fee || 0) > 0 && (
            <p className="text-xs text-amber-700 mt-2">
              Less {parseFloat(loan.processing_fee_rate)}% processing fee (KES{" "}
              {parseFloat(loan.processing_fee).toLocaleString()}) · disbursed KES{" "}
              {parseFloat(
                loan.net_disbursed_amount ?? loan.principal_amount,
              ).toLocaleString()}
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-ocean-500">
          <p className="text-sm text-gray-500 uppercase font-semibold mb-2">
            Total Due
          </p>
          <p className="text-2xl font-bold text-gray-800">
            KES {parseFloat(summary.total_due).toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-500">
          <p className="text-sm text-gray-500 uppercase font-semibold mb-2">
            Paid
          </p>
          <p className="text-2xl font-bold text-green-600">
            KES {parseFloat(summary.total_paid).toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-orange-500">
          <p className="text-sm text-gray-500 uppercase font-semibold mb-2">
            Balance
          </p>
          <p className="text-2xl font-bold text-orange-600">
            KES {parseFloat(summary.balance).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold text-gray-800">
            Repayment Progress
          </h3>
          <span className="text-2xl font-bold text-ocean-600">
            {summary.progress_percentage}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
          <div
            className="bg-gradient-to-r from-green-500 to-emerald-600 h-4 rounded-full transition-all duration-500"
            style={{ width: `${summary.progress_percentage}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>KES 0</span>
          <span>KES {parseFloat(summary.total_due).toLocaleString()}</span>
        </div>
      </div>

      {/* Overpayment Alert (if any) */}
      {summary.overpayment > 0 && (
        <div
          className={`rounded-xl shadow-md p-6 mb-6 ${
            summary.refund_status === "refunded"
              ? "bg-green-50 border-2 border-green-200"
              : "bg-ocean-50 border-2 border-ocean-300"
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3
                className={`text-lg font-bold mb-2 ${
                  summary.refund_status === "refunded"
                    ? "text-green-800"
                    : "text-ocean-800"
                }`}
              >
                {summary.refund_status === "refunded" ? (
                  <span className="inline-flex items-center gap-2"><CheckCircle size={20}/> Refund Completed</span>
                ) : (
                  <span className="inline-flex items-center gap-2"><Coins size={20}/> Overpayment - Refund Pending</span>
                )}
              </h3>
              <p className="text-sm text-gray-700 mb-2">
                {summary.refund_status === "refunded"
                  ? "Refund has been processed for this loan."
                  : "The client paid more than the loan amount. A refund is due."}
              </p>
              <p className="text-3xl font-bold text-ocean-700">
                KES {parseFloat(summary.overpayment).toLocaleString()}
              </p>
              {loan.refunded_date && (
                <p className="text-sm text-gray-600 mt-2">
                  Refunded on:{" "}
                  {new Date(loan.refunded_date).toLocaleDateString()}
                  {loan.refund_method && ` via ${loan.refund_method}`}
                  {loan.refund_reference && ` (Ref: ${loan.refund_reference})`}
                </p>
              )}
            </div>
            {summary.refund_status === "pending" && (
              <button
                onClick={() => setShowRefundModal(true)}
                className="px-6 py-3 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold rounded-lg transition"
              >
                Mark as Refunded
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loan Details */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          Loan Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Interest Rate (Monthly)</p>
            <p className="font-semibold text-gray-800">
              {parseFloat(loan.interest_rate).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-gray-500">Duration</p>
            <p className="font-semibold text-gray-800">
              {loan.loan_duration_months} months
            </p>
          </div>
          <div>
            <p className="text-gray-500">Total Interest</p>
            <p className="font-semibold text-gray-800">
              KES {parseFloat(loan.total_interest).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Start Date</p>
            <p className="font-semibold text-gray-800">
              {loan.start_date
                ? new Date(loan.start_date).toLocaleDateString()
                : "— (on disbursement)"}
            </p>
          </div>
          <div>
            <p className="text-gray-500">End Date</p>
            <p className="font-semibold text-gray-800">
              {new Date(loan.end_date).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Created</p>
            <p className="font-semibold text-gray-800">
              {new Date(loan.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Schedule */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden mb-6">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Calendar size={20}/> Payment Schedule
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {schedule.filter((s) => s.status === "paid").length} of{" "}
            {schedule.length} payments completed
            {(() => {
              const totalPenalty = schedule.reduce(
                (sum, s) => sum + parseFloat(s.penalty_total || 0),
                0,
              );
              const totalPenaltyPaid = parseFloat(
                summary.total_penalty_paid || 0,
              );
              if (totalPenalty <= 0 && totalPenaltyPaid <= 0) return null;
              return (
                <span className="text-amber-700 font-medium">
                  {" "}
                  · KES {totalPenalty.toLocaleString()} penalty accrued
                  {totalPenaltyPaid > 0 && (
                    <span className="text-green-700">
                      {" "}
                      · KES {totalPenaltyPaid.toLocaleString()} paid
                    </span>
                  )}
                </span>
              );
            })()}
          </p>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-200px)]">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  #
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Due Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Amount Due
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Amount Paid
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                  Interest
                </th>
                <th
                  className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase"
                  title="Flat late fee per overdue installment"
                >
                  Late Fee
                </th>
                <th
                  className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase"
                  title="Penalty rate × overdue balance × months late"
                >
                  Penalty Interest
                </th>
                <th
                  className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase"
                  title="Late fee + penalty interest actually charged on this installment"
                >
                  Penalty Total
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                  Penalty Paid
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Paid Date
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((item) => {
                const daysStatus = getDaysStatus(item.due_date, item.status);
                return (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="px-6 py-3 font-semibold text-gray-800">
                      {item.payment_number}
                    </td>
                    <td className="px-6 py-3">
                      <p className="text-gray-800">
                        {new Date(item.due_date).toLocaleDateString()}
                      </p>
                      {daysStatus && (
                        <p className={`text-xs ${daysStatus.color}`}>
                          {daysStatus.text}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-3 font-semibold text-gray-800">
                      KES {parseFloat(item.amount_due).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 font-semibold text-green-600">
                      KES {parseFloat(item.amount_paid || 0).toLocaleString()}
                    </td>
                    <td
                      className="px-6 py-3 text-right text-emerald-700 font-semibold"
                      title="Interest earned from this installment (policy share × % paid)"
                    >
                      {parseFloat(item.interest_portion || 0) > 0
                        ? `KES ${parseFloat(item.interest_portion).toLocaleString()}`
                        : "—"}
                    </td>
                    {/* Late Fee + Penalty Interest sub-cells. Backend
                        prefers the persisted snapshot (taken at the
                        moment penalty was paid) and falls back to the
                        live formula for installments that haven't been
                        charged yet — so these always reconcile with
                        the Penalty Total headline. */}
                    <td className="px-6 py-3 text-right text-gray-700">
                      {parseFloat(item.penalty_total || 0) > 0
                        ? `KES ${parseFloat(item.late_fee || 0).toLocaleString()}`
                        : "-"}
                    </td>
                    <td
                      className="px-6 py-3 text-right text-gray-700"
                      title={
                        parseFloat(item.penalty_paid || 0) === 0 &&
                        item.penalty_total > 0
                          ? `${item.penalty_rate}% per month × ${item.months_late} month${item.months_late !== 1 ? "s" : ""} on the overdue balance`
                          : undefined
                      }
                    >
                      {parseFloat(item.penalty_total || 0) > 0
                        ? `KES ${parseFloat(item.penalty_interest || 0).toLocaleString()}`
                        : "-"}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-amber-700">
                      {parseFloat(item.penalty_total || 0) > 0 ? (
                        <>
                          <div>
                            KES{" "}
                            {parseFloat(
                              item.penalty_total || 0,
                            ).toLocaleString()}
                          </div>
                          {parseFloat(item.penalty_outstanding || 0) > 0 &&
                            parseFloat(item.penalty_paid || 0) > 0 && (
                              <div className="text-xs text-red-600 font-normal">
                                KES{" "}
                                {parseFloat(
                                  item.penalty_outstanding,
                                ).toLocaleString()}{" "}
                                unpaid
                              </div>
                            )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-green-600">
                      {parseFloat(item.penalty_paid || 0) > 0 ? (
                        <>
                          <div>
                            KES{" "}
                            {parseFloat(item.penalty_paid).toLocaleString()}
                          </div>
                          {parseFloat(item.penalty_outstanding || 0) === 0 &&
                            parseFloat(item.penalty_total || 0) > 0 && (
                              <div className="text-xs text-gray-500 font-normal">
                                cleared
                              </div>
                            )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          item.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : item.status === "waived"
                              ? "bg-emerald-100 text-emerald-700"
                              : item.status === "overdue"
                                ? "bg-red-100 text-red-700"
                                : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600 text-sm">
                      {item.actual_payment_date
                        ? new Date(
                            item.actual_payment_date,
                          ).toLocaleDateString()
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {(() => {
              // Roll up the numeric columns; date/status columns get a "—".
              const sum = (key) =>
                schedule.reduce(
                  (acc, s) => acc + parseFloat(s[key] || 0),
                  0,
                );
              const totalAmountDue = sum("amount_due");
              const totalAmountPaid = sum("amount_paid");
              const totalInterest = sum("interest_portion");
              // Roll up late fee + penalty interest only over rows that
              // actually carry a penalty (skip never-overdue installments
              // so the totals match the visible "KES X" cells).
              const totalLateFee = schedule.reduce(
                (acc, s) =>
                  acc +
                  (parseFloat(s.penalty_total || 0) > 0
                    ? parseFloat(s.late_fee || 0)
                    : 0),
                0,
              );
              const totalPenaltyInterest = schedule.reduce(
                (acc, s) =>
                  acc +
                  (parseFloat(s.penalty_total || 0) > 0
                    ? parseFloat(s.penalty_interest || 0)
                    : 0),
                0,
              );
              const totalPenaltyTotal = sum("penalty_total");
              const totalPenaltyPaid = sum("penalty_paid");
              const fmt = (n) =>
                n > 0
                  ? `KES ${Number(n).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}`
                  : "—";
              return (
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr>
                    <td
                      className="px-6 py-3 font-bold text-gray-800 text-sm"
                      colSpan={2}
                    >
                      TOTALS · {schedule.length}{" "}
                      payment{schedule.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-6 py-3 font-bold text-gray-800 text-sm">
                      {fmt(totalAmountDue)}
                    </td>
                    <td className="px-6 py-3 font-bold text-green-600 text-sm">
                      {fmt(totalAmountPaid)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-700 text-sm">
                      {fmt(totalInterest)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-gray-700 text-sm">
                      {fmt(totalLateFee)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-gray-700 text-sm">
                      {fmt(totalPenaltyInterest)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-amber-700 text-sm">
                      {fmt(totalPenaltyTotal)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-green-600 text-sm">
                      {fmt(totalPenaltyPaid)}
                    </td>
                    <td className="px-6 py-3" colSpan={2}></td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <ClipboardList size={20}/> Payment History
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {transactions.length} payment{transactions.length !== 1 ? "s" : ""}{" "}
            recorded
          </p>
        </div>
        {transactions.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="flex justify-center mb-2"><Coins size={40} className="text-gray-300"/></div>
            <p>No payments recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Transaction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Reference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                    Balance After
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                    Receipt
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr
                    key={txn.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition"
                  >
                    <td className="px-6 py-3 font-mono text-sm font-semibold text-green-600">
                      {txn.transaction_code}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {new Date(txn.payment_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 font-bold text-green-600">
                      <div>
                        KES {parseFloat(txn.amount_paid).toLocaleString()}
                      </div>
                      {(() => {
                        const penalty = parseFloat(txn.penalty_portion || 0);
                        const overpay = parseFloat(
                          txn.receipt?.overpayment_for_this || 0,
                        );
                        const towardBalance =
                          parseFloat(txn.amount_paid || 0) - penalty - overpay;
                        if (penalty <= 0 && overpay <= 0) return null;
                        return (
                          <div className="text-xs font-normal text-gray-500 mt-1 space-y-0.5">
                            {penalty > 0 && (
                              <div className="text-amber-700">
                                Penalty: KES {penalty.toLocaleString()}
                              </div>
                            )}
                            {towardBalance > 0 && (
                              <div className="text-gray-600">
                                Balance: KES{" "}
                                {towardBalance.toLocaleString(undefined, {
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                            )}
                            {overpay > 0 && (
                              <div className="text-ocean-700">
                                Overpaid: KES {overpay.toLocaleString()}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                        {txn.payment_method}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600 text-sm">
                      {txn.payment_reference || "-"}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-sm">
                      {txn.notes || "-"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {txn.receipt ? (
                        <div>
                          <p className="font-bold text-orange-600">
                            KES{" "}
                            {parseFloat(
                              txn.receipt.remaining_balance_after_this,
                            ).toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            {txn.receipt.completion_percentage_after_this}%
                            paid
                          </p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => setReceiptTxn(txn)}
                        className="text-ocean-600 hover:text-ocean-800 mr-2"
                        title="View Receipt"
                      >
                        <Receipt size={18}/>
                      </button>
                      <button
                        onClick={() =>
                          downloadPdf(
                            `/reports/pdf/receipt/${txn.id}`,
                            `receipt_${txn.transaction_code}.pdf`,
                          )
                        }
                        className="text-blue-600 hover:text-blue-800"
                        title="Download Receipt"
                      >
                        <Download size={18}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Loan-level receipt summary (current status + next payment). */}
        {receiptSummary && transactions.length > 0 && (
          <div className="p-4 lg:p-6 border-t bg-ocean-gradient-soft">
            <h3 className="font-bold mb-3 text-gray-800 flex items-center gap-2"><BarChart3 size={18}/> Current Status</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-xs text-gray-500">Total Loan</p>
                <p className="font-bold">
                  KES{" "}
                  {parseFloat(loan.total_amount_due).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Paid</p>
                <p className="font-bold text-green-600">
                  KES{" "}
                  {parseFloat(receiptSummary.total_paid).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Remaining</p>
                <p className="font-bold text-orange-600">
                  KES{" "}
                  {parseFloat(
                    receiptSummary.remaining_balance,
                  ).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Progress</p>
                <p className="font-bold text-ocean-600">
                  {receiptSummary.completion_percentage}%
                </p>
              </div>
            </div>
            {receiptSummary.next_payment_date &&
              !receiptSummary.is_fully_paid && (
                <div className="mt-3 pt-3 border-t border-ocean-200 text-center">
                  <p className="text-xs text-gray-500 flex items-center justify-center gap-1"><Calendar size={12}/> Next Payment Due</p>
                  <p className="font-bold text-xl text-blue-600">
                    KES{" "}
                    {parseFloat(
                      receiptSummary.next_payment_amount,
                    ).toLocaleString()}
                  </p>
                  <p className="text-sm text-blue-600">
                    {new Date(
                      receiptSummary.next_payment_date,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
              )}
            {receiptSummary.is_fully_paid && (
              <p className="mt-3 text-center text-green-700 font-bold flex items-center justify-center gap-2">
                <PartyPopper size={18}/> LOAN FULLY PAID!
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Waivers history ─────────────────────────────────────── */}
      {waivers.length > 0 && (
        <div className="bg-white rounded-xl shadow-md overflow-hidden mt-6">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <HandCoins size={20} /> Waivers
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {waivers.length} record{waivers.length !== 1 ? "s" : ""} ·
              total approved:{" "}
              <span className="font-semibold text-emerald-700">
                KES{" "}
                {waivers
                  .filter((w) => w.status === "approved")
                  .reduce((s, w) => s + parseFloat(w.amount || 0), 0)
                  .toLocaleString()}
              </span>
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {waivers.map((w) => {
              const statusPill = {
                pending: {
                  bg: "bg-amber-100",
                  text: "text-amber-800",
                  icon: <Clock size={12} />,
                  label: "Pending admin",
                },
                approved: {
                  bg: "bg-emerald-100",
                  text: "text-emerald-800",
                  icon: <CheckCircle size={12} />,
                  label: "Approved",
                },
                rejected: {
                  bg: "bg-rose-100",
                  text: "text-rose-800",
                  icon: <XCircle size={12} />,
                  label: "Rejected",
                },
                reversed: {
                  bg: "bg-gray-200",
                  text: "text-gray-700",
                  icon: <RotateCcw size={12} />,
                  label: "Reversed",
                },
              }[w.status] || {};
              return (
                <div key={w.id} className="p-5 hover:bg-gray-50/60">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-emerald-700 text-lg">
                          − KES{" "}
                          {parseFloat(w.amount).toLocaleString()}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold uppercase">
                          {w.type}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusPill.bg} ${statusPill.text}`}
                        >
                          {statusPill.icon} {statusPill.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">
                        <strong>Reason:</strong> {w.reason}
                      </p>
                      {w.notes && (
                        <p className="text-xs text-gray-500 mt-1">
                          {w.notes}
                        </p>
                      )}
                      <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                        <p>
                          Requested by{" "}
                          <strong>{w.requested_by_name || "—"}</strong>{" "}
                          on{" "}
                          {new Date(w.requested_at).toLocaleString("en-KE")}
                        </p>
                        {w.status === "approved" && (
                          <p className="text-emerald-700">
                            Approved by{" "}
                            <strong>{w.approved_by_name || "—"}</strong>{" "}
                            on{" "}
                            {new Date(w.approved_at).toLocaleString("en-KE")}
                          </p>
                        )}
                        {w.status === "rejected" && (
                          <p className="text-rose-700">
                            Rejected by{" "}
                            <strong>{w.rejected_by_name || "—"}</strong>{" "}
                            on{" "}
                            {new Date(w.rejected_at).toLocaleString("en-KE")}
                            {w.rejection_reason &&
                              ` — ${w.rejection_reason}`}
                          </p>
                        )}
                        {w.status === "reversed" && (
                          <p className="text-gray-600">
                            Reversed by{" "}
                            <strong>{w.reversed_by_name || "—"}</strong>{" "}
                            on{" "}
                            {new Date(w.reversed_at).toLocaleString("en-KE")}
                            {w.reversal_reason &&
                              ` — ${w.reversal_reason}`}
                          </p>
                        )}
                      </div>
                    </div>
                    {w.status === "approved" && (
                      <PermissionGate role="admin">
                        <button
                          onClick={() => {
                            setReversingWaiver(w);
                            setReversalReason("");
                          }}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-sm font-semibold inline-flex items-center gap-1 transition shrink-0"
                          title="Reverse this waiver"
                        >
                          <RotateCcw size={14} /> Reverse
                        </button>
                      </PermissionGate>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">
              {statusFormData.status === "defaulted" && "Mark Loan as Defaulted"}
              {statusFormData.status === "suspended" && "Suspend Loan"}
              {statusFormData.status === "active" && (
                <span className="inline-flex items-center gap-2"><CheckCircle size={24}/> Reactivate Loan</span>
              )}
            </h3>

            <p className="text-gray-600 mb-4">
              {statusFormData.status === "defaulted" &&
                "This will mark all pending payments as overdue. Client will not be able to borrow until resolved."}
              {statusFormData.status === "suspended" &&
                "This will temporarily pause this loan. Payments can still be recorded."}
              {statusFormData.status === "active" &&
                "This will reactivate the loan and allow normal operations."}
            </p>

            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4">
                {actionError}
              </div>
            )}

            <form onSubmit={handleUpdateStatus}>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Reason / Notes
                </label>
                <textarea
                  value={statusFormData.notes}
                  onChange={(e) =>
                    setStatusFormData({
                      ...statusFormData,
                      notes: e.target.value,
                    })
                  }
                  rows="3"
                  placeholder="Add a note explaining this action..."
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  disabled={submitting}
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-6 py-2 text-white font-semibold rounded-lg transition disabled:opacity-50 ${
                    statusFormData.status === "defaulted"
                      ? "bg-red-600 hover:bg-red-700"
                      : statusFormData.status === "suspended"
                        ? "bg-yellow-600 hover:bg-yellow-700"
                        : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {submitting ? "Updating..." : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">
              Process Refund
            </h3>
            <p className="text-gray-600 mb-4">
              Refund Amount:{" "}
              <strong className="text-ocean-600 text-xl">
                KES {parseFloat(summary.overpayment).toLocaleString()}
              </strong>
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setProcessingRefund(true);
                try {
                  await api.post(`/payments/refund/${id}`, refundData);
                  setShowRefundModal(false);
                  fetchLoanDetails();
                } catch (err) {
                  alert(
                    err.response?.data?.error || "Failed to process refund",
                  );
                } finally {
                  setProcessingRefund(false);
                }
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Refund Method *
                  </label>
                  <select
                    value={refundData.refund_method}
                    onChange={(e) =>
                      setRefundData({
                        ...refundData,
                        refund_method: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                    required
                  >
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Reference Number
                  </label>
                  <input
                    type="text"
                    value={refundData.refund_reference}
                    onChange={(e) =>
                      setRefundData({
                        ...refundData,
                        refund_reference: e.target.value,
                      })
                    }
                    placeholder="M-Pesa code, cheque #, etc."
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Refund Date *
                  </label>
                  <input
                    type="date"
                    value={refundData.refunded_date}
                    onChange={(e) =>
                      setRefundData({
                        ...refundData,
                        refunded_date: e.target.value,
                      })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  disabled={processingRefund}
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingRefund}
                  className="px-6 py-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold rounded-lg transition"
                >
                  {processingRefund ? "Processing..." : <span className="inline-flex items-center gap-2"><Check size={16}/> Confirm Refund</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiptTxn && (
        <PaymentReceipt
          payment={receiptTxn}
          receipt={buildReceipt(receiptTxn)}
          tenant={adminTenant}
          onClose={() => setReceiptTxn(null)}
        />
      )}

      {/* Edit Loan Modal */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-3xl w-full my-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Pencil size={22} /> Edit Loan
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {loan.loan_code} ·{" "}
                  <span className="font-semibold">
                    {loan.first_name} {loan.last_name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                disabled={editing}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>

            {["active", "completed", "defaulted", "suspended"].includes(
              loan.status,
            ) && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <span>
                  This loan is already <strong>{loan.status}</strong>. Changing
                  principal, rate, duration or processing fee will regenerate
                  the payment schedule and reconcile the capital pool. Existing
                  payments remain on record.
                </span>
              </div>
            )}

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Principal (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={editForm.principal_amount}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        principal_amount: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Annual Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.annual_interest_rate}
                    onChange={(e) => onEditAnnualChange(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Monthly Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.monthly_interest_rate}
                    onChange={(e) => onEditMonthlyChange(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Duration (months) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="60"
                    value={editForm.loan_duration_months}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        loan_duration_months: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Processing Fee Rate (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={editForm.processing_fee_rate}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      processing_fee_rate: e.target.value,
                    })
                  }
                  className="w-full md:w-1/2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              {/* Date chain: creation ≤ disbursement ≤ start. min/max on
                  each input gives the user immediate feedback, plus
                  client-side validation runs on submit. */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Loan Creation Date
                  </label>
                  <input
                    type="date"
                    value={editForm.application_date}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        application_date: e.target.value,
                      })
                    }
                    max={
                      editForm.disbursement_date ||
                      new Date().toISOString().split("T")[0]
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Disbursement Date
                  </label>
                  <input
                    type="date"
                    value={editForm.disbursement_date}
                    onChange={(e) => {
                      const newDisb = e.target.value;
                      setEditForm((p) => ({
                        ...p,
                        disbursement_date: newDisb,
                        // Slide start_date along when it was the
                        // disbursement+1-month default.
                        start_date:
                          p.start_date === startFromDisb(p.disbursement_date)
                            ? startFromDisb(newDisb)
                            : p.start_date,
                      }));
                    }}
                    min={editForm.application_date || undefined}
                    disabled={
                      ![
                        "active",
                        "completed",
                        "defaulted",
                        "suspended",
                      ].includes(loan.status)
                    }
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      [
                        "active",
                        "completed",
                        "defaulted",
                        "suspended",
                      ].includes(loan.status)
                        ? "border-gray-200 focus:border-ocean-500"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                  {![
                    "active",
                    "completed",
                    "defaulted",
                    "suspended",
                  ].includes(loan.status) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Set at disbursement.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editForm.start_date}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        start_date: e.target.value,
                      })
                    }
                    min={editForm.disbursement_date || undefined}
                    disabled={
                      ![
                        "active",
                        "completed",
                        "defaulted",
                        "suspended",
                      ].includes(loan.status)
                    }
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      [
                        "active",
                        "completed",
                        "defaulted",
                        "suspended",
                      ].includes(loan.status)
                        ? "border-gray-200 focus:border-ocean-500"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                  {[
                    "active",
                    "completed",
                    "defaulted",
                    "suspended",
                  ].includes(loan.status) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Default: 1 month after disbursement.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Purpose
                </label>
                <input
                  type="text"
                  value={editForm.purpose}
                  onChange={(e) =>
                    setEditForm({ ...editForm, purpose: e.target.value })
                  }
                  placeholder="e.g. Business expansion"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <h4 className="font-semibold text-gray-700 mb-2 text-sm">
                  Guarantor
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="Name"
                    value={editForm.guarantor_name}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        guarantor_name: e.target.value,
                      })
                    }
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Phone"
                    value={editForm.guarantor_phone}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        guarantor_phone: e.target.value,
                      })
                    }
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="ID Number"
                    value={editForm.guarantor_id_number}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        guarantor_id_number: e.target.value,
                      })
                    }
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Collateral / Security
                </label>
                <textarea
                  rows="2"
                  value={editForm.collateral_description}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      collateral_description: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Late Payment Fee (KES)
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editForm.late_fee_enabled}
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          late_fee_enabled: !editForm.late_fee_enabled,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        editForm.late_fee_enabled
                          ? "bg-ocean-600"
                          : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                          editForm.late_fee_enabled
                            ? "translate-x-5"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    disabled={!editForm.late_fee_enabled}
                    value={
                      editForm.late_fee_enabled
                        ? editForm.late_payment_fee
                        : 0
                    }
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        late_payment_fee: e.target.value,
                      })
                    }
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      editForm.late_fee_enabled
                        ? "border-gray-200 focus:border-ocean-500"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Penalty Rate (% per month on overdue)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.penalty_rate}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        penalty_rate: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  rows="2"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={editing}
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editing}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Pencil size={16} />
                  {editing ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Loan Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              <Trash2 size={22} className="text-red-700" /> Delete loan?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This permanently removes{" "}
              <strong className="font-mono">{loan.loan_code}</strong> and any
              associated logs. The loan must be re-applied to bring it back.
            </p>
            {deleteError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-3 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-6 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Trash2 size={16} />
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiver Request / Record Modal */}
      {showWaiverModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-xl w-full my-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <HandCoins size={22} className="text-emerald-700" />
                  {isAdminRole ? "Waive Loan" : "Request Waiver"}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {loan.loan_code} ·{" "}
                  <span className="font-semibold">
                    {loan.first_name} {loan.last_name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowWaiverModal(false)}
                disabled={savingWaiver}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={22} />
              </button>
            </div>

            <div
              className={`border rounded-lg p-3 mb-4 text-sm flex items-start gap-2 ${
                isAdminRole
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              {isAdminRole ? (
                <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />
              ) : (
                <Clock size={16} className="flex-shrink-0 mt-0.5" />
              )}
              <span>
                {isAdminRole
                  ? "As an admin, this waiver applies immediately. The borrower will be notified."
                  : "This sends a request to the admin. The waiver only takes effect once they approve it."}
              </span>
            </div>

            {/* Loan summary at a glance — so the admin/manager can
                size the waiver without leaving the modal. Each "use"
                link pre-fills the Amount field. */}
            {(() => {
              const principal = parseFloat(loan.principal_amount || 0);
              const totalDue = parseFloat(loan.total_amount_due || 0);
              const totalInterest = parseFloat(loan.total_interest || 0);
              const paid = parseFloat(summary?.total_paid || 0);
              const balance = parseFloat(summary?.balance || 0);
              // Interest already credited (sum of per-installment
              // interest_portion the backend exposes on each row).
              const interestPaid = (schedule || []).reduce(
                (acc, s) => acc + parseFloat(s.interest_portion || 0),
                0,
              );
              const interestRemaining = Math.max(
                0,
                totalInterest - interestPaid,
              );
              const penaltyOutstanding = (schedule || []).reduce(
                (acc, s) => acc + parseFloat(s.penalty_outstanding || 0),
                0,
              );
              const penaltyPaid = parseFloat(summary?.total_penalty_paid || 0);
              const fill = (value) =>
                setWaiverForm((p) => ({
                  ...p,
                  amount: value > 0 ? value.toFixed(2) : "",
                }));
              const Row = ({
                label,
                value,
                color = "text-gray-900",
                fillAmount,
                fillLabel,
              }) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${color}`}>
                      KES {value.toLocaleString()}
                    </span>
                    {fillAmount > 0 && (
                      <button
                        type="button"
                        onClick={() => fill(fillAmount)}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 underline font-medium uppercase tracking-wider"
                        title={`Use ${fillLabel || "this"} as the waiver amount`}
                      >
                        use
                      </button>
                    )}
                  </div>
                </div>
              );
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
                    Loan snapshot
                  </p>
                  <Row label="Principal" value={principal} />
                  <Row label="Total to pay" value={totalDue} />
                  <Row
                    label="Paid"
                    value={paid}
                    color="text-emerald-700"
                  />
                  <Row
                    label="Remaining balance"
                    value={balance}
                    color="text-orange-700"
                    fillAmount={balance}
                    fillLabel="the full remaining balance"
                  />
                  <Row
                    label="Interest remaining"
                    value={interestRemaining}
                    color="text-sky-700"
                    fillAmount={interestRemaining}
                    fillLabel="the interest portion"
                  />
                  <Row
                    label="Penalty outstanding"
                    value={penaltyOutstanding}
                    color="text-rose-700"
                    fillAmount={penaltyOutstanding}
                    fillLabel="the outstanding penalty"
                  />
                  {penaltyPaid > 0 && (
                    <Row
                      label="Penalty paid"
                      value={penaltyPaid}
                      color="text-gray-700"
                    />
                  )}
                </div>
              );
            })()}

            {waiverError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
                {waiverError}
              </div>
            )}

            <form onSubmit={handleSubmitWaiver} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Type *
                  </label>
                  <select
                    value={waiverForm.type}
                    onChange={(e) =>
                      setWaiverForm({ ...waiverForm, type: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none bg-white"
                  >
                    <option value="penalty">Penalty (late fees + interest on overdue)</option>
                    <option value="interest">Interest (forgive remaining interest)</option>
                    <option value="principal">Principal (forgive part of capital)</option>
                    <option value="mixed">Mixed / combined</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Amount (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={waiverForm.amount}
                    onChange={(e) =>
                      setWaiverForm({
                        ...waiverForm,
                        amount: e.target.value,
                      })
                    }
                    placeholder="e.g. 500"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Reason *
                </label>
                <input
                  type="text"
                  required
                  value={waiverForm.reason}
                  onChange={(e) =>
                    setWaiverForm({ ...waiverForm, reason: e.target.value })
                  }
                  placeholder="e.g. Goodwill — first late payment"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows="2"
                  value={waiverForm.notes}
                  onChange={(e) =>
                    setWaiverForm({ ...waiverForm, notes: e.target.value })
                  }
                  placeholder="Anything internal you'd like to capture…"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowWaiverModal(false)}
                  disabled={savingWaiver}
                  className="px-5 py-2 bg-gray-500 text-white font-semibold rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWaiver}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <HandCoins size={16} />
                  {savingWaiver
                    ? "Saving…"
                    : isAdminRole
                      ? "Apply waiver"
                      : "Send request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Waiver Confirmation */}
      {reversingWaiver && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              <RotateCcw size={20} className="text-rose-700" />
              Reverse waiver?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Restores{" "}
              <strong className="text-rose-700">
                KES {parseFloat(reversingWaiver.amount).toLocaleString()}
              </strong>{" "}
              back onto this loan's outstanding balance. The borrower
              will be notified.
            </p>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Reason for reversal *
            </label>
            <textarea
              rows="2"
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="e.g. Borrower paid in cash — recorded waiver in error"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none mb-4"
              required
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReversingWaiver(null);
                  setReversalReason("");
                }}
                disabled={reversingBusy}
                className="px-5 py-2 bg-gray-500 text-white rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReverseWaiver}
                disabled={reversingBusy || !reversalReason.trim()}
                className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                <RotateCcw size={16} />
                {reversingBusy ? "Reversing…" : "Reverse waiver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoanDetails;
