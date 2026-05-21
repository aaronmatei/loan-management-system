import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";
import PaymentReceipt from "../components/PaymentReceipt";

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

  useEffect(() => {
    fetchLoanDetails();
  }, [id]);

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
          className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg transition font-semibold"
        >
          📄 Download Statement
        </button>
        <button
          onClick={() =>
            downloadPdf(
              `/reports/pdf/loan-agreement/${loan.id}`,
              `loan_agreement_${loan.loan_code}.pdf`,
            )
          }
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold"
        >
          📄 Download Agreement
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
                🔴 Mark as Defaulted
              </button>
              <button
                onClick={() => {
                  setStatusFormData({ status: "suspended", notes: "" });
                  setActionError("");
                  setShowStatusModal(true);
                }}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition font-semibold"
              >
                ⏸️ Suspend
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
              {loan.status === "defaulted" ? "✅ Reactivate" : "▶️ Reactivate"}
            </button>
          )}
          </>
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
              📱 {loan.phone_number}
              {loan.email && (
                <>
                  <br />
                  ✉️ {loan.email}
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
          <p className="text-sm font-semibold text-yellow-900 mb-1">
            📝 Notes
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
                {summary.refund_status === "refunded"
                  ? "✅ Refund Completed"
                  : "💰 Overpayment - Refund Pending"}
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
          <h3 className="text-lg font-semibold text-gray-800">
            📅 Payment Schedule
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {schedule.filter((s) => s.status === "paid").length} of{" "}
            {schedule.length} payments completed
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
                    <td className="px-6 py-3">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          item.status === "paid"
                            ? "bg-green-100 text-green-700"
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
          </table>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">
            💵 Payment History
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {transactions.length} payment{transactions.length !== 1 ? "s" : ""}{" "}
            recorded
          </p>
        </div>
        {transactions.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="text-4xl mb-2">💵</div>
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
                      KES {parseFloat(txn.amount_paid).toLocaleString()}
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
                        className="text-ocean-600 hover:text-ocean-800 text-lg mr-2"
                        title="View Receipt"
                      >
                        🧾
                      </button>
                      <button
                        onClick={() =>
                          downloadPdf(
                            `/reports/pdf/receipt/${txn.id}`,
                            `receipt_${txn.transaction_code}.pdf`,
                          )
                        }
                        className="text-blue-600 hover:text-blue-800 text-lg"
                        title="Download Receipt"
                      >
                        📄
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
            <h3 className="font-bold mb-3 text-gray-800">📊 Current Status</h3>
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
                  <p className="text-xs text-gray-500">📅 Next Payment Due</p>
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
              <p className="mt-3 text-center text-green-700 font-bold">
                🎉 LOAN FULLY PAID!
              </p>
            )}
          </div>
        )}
      </div>
      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">
              {statusFormData.status === "defaulted" &&
                "🔴 Mark Loan as Defaulted"}
              {statusFormData.status === "suspended" && "⏸️ Suspend Loan"}
              {statusFormData.status === "active" && "✅ Reactivate Loan"}
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
                  {processingRefund ? "Processing..." : "✓ Confirm Refund"}
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
    </div>
  );
}

export default LoanDetails;
