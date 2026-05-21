import React, { useState, useEffect, useRef } from "react";
import api from "../services/api";
import { useSortableTable } from "../hooks/useSortableTable";
import SortableHeader from "../components/SortableHeader";
import PaymentReceipt from "../components/PaymentReceipt";

function Payments() {
  const [payments, setPayments] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Loan search
  const [loanSearch, setLoanSearch] = useState("");
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loanSummary, setLoanSummary] = useState(null);
  const dropdownRef = useRef(null);

  const [formData, setFormData] = useState({
    loan_id: "",
    amount_paid: "",
    payment_date: new Date().toISOString().split("T")[0],
    payment_method: "M-Pesa",
    payment_reference: "",
    notes: "",
  });

  // Receipt modal state — populated from POST /payments response.
  const [receiptModal, setReceiptModal] = useState(null);
  const [tenantBranding, setTenantBranding] = useState(null);

  useEffect(() => {
    fetchPayments();
    fetchLoans();
    // Best-effort tenant branding for the receipt header. White-label
    // settings live behind admin auth, so we degrade gracefully on 403.
    api
      .get("/white-label/settings")
      .then((r) => setTenantBranding(r.data.data || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const response = await api.get("/payments");
      setPayments(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  const fetchLoans = async () => {
    try {
      const response = await api.get("/loans?status=active");
      // Filter only active loans
      const activeLoans = (response.data.data || []).filter(
        (l) => l.status === "active",
      );
      setLoans(activeLoans);
    } catch (err) {
      console.error("Failed to fetch loans:", err);
    }
  };

  const fetchLoanSummary = async (loanId) => {
    try {
      const response = await api.get(`/payments/loan/${loanId}/summary`);
      setLoanSummary(response.data.data);
    } catch (err) {
      console.error("Failed to fetch loan summary:", err);
    }
  };

  const filteredLoans = loans.filter((loan) => {
    if (!loanSearch) return true;
    const search = loanSearch.toLowerCase();
    return (
      loan.loan_code?.toLowerCase().includes(search) ||
      loan.first_name?.toLowerCase().includes(search) ||
      loan.last_name?.toLowerCase().includes(search) ||
      loan.phone_number?.includes(search) ||
      loan.client_code?.toLowerCase().includes(search)
    );
  });

  const handleSelectLoan = (loan) => {
    setSelectedLoan(loan);
    setFormData({ ...formData, loan_id: loan.id });
    setLoanSearch(`${loan.loan_code} - ${loan.first_name} ${loan.last_name}`);
    setShowDropdown(false);
    fetchLoanSummary(loan.id);
  };

  const handleClearLoan = () => {
    setSelectedLoan(null);
    setFormData({ ...formData, loan_id: "" });
    setLoanSearch("");
    setLoanSummary(null);
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.loan_id) {
      setError("Please select a loan");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await api.post("/payments", formData);
      const txn = response.data.data;
      setSuccess(
        `✅ Payment ${txn.transaction_code} recorded successfully!`,
      );

      // Show the receipt modal if the backend returned a receipt block
      // (added with migration 012 / payments.js update).
      if (txn.receipt) {
        setReceiptModal({ payment: txn, receipt: txn.receipt });
      }

      setFormData({
        loan_id: "",
        amount_paid: "",
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "M-Pesa",
        payment_reference: "",
        notes: "",
      });
      setSelectedLoan(null);
      setLoanSearch("");
      setLoanSummary(null);

      setShowForm(false);
      fetchPayments();
      fetchLoans();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  };

  // Sort then paginate
  const {
    sortedData: sortedPayments,
    requestSort,
    getSortIndicator,
  } = useSortableTable(payments, "payment_date", "desc");

  // Pagination math (same pattern as Clients/Overdue pages)
  const totalPages = Math.ceil(sortedPayments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedPayments = sortedPayments.slice(startIndex, endIndex);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
            Payments
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            Total: <span className="font-semibold">{payments.length}</span>{" "}
            payments recorded
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={loans.length === 0}
          className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {showForm ? "✖ Cancel" : "+ Record Payment"}
        </button>
      </div>

      {loans.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-4">
          ⚠️ No active loans available. Create a loan first to record payments.
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Record Payment Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Record New Payment
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Searchable Loan Dropdown */}
            <div ref={dropdownRef} className="relative">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Select Loan *
                <span className="text-gray-500 font-normal ml-2">
                  (Search by loan code, client name, or phone)
                </span>
              </label>

              {selectedLoan ? (
                <div className="flex items-center gap-2 p-3 border-2 border-green-300 bg-green-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-semibold text-green-900">
                      {selectedLoan.loan_code} - {selectedLoan.first_name}{" "}
                      {selectedLoan.last_name}
                    </p>
                    <p className="text-sm text-green-700">
                      📱 {selectedLoan.phone_number} • 💰 KES{" "}
                      {parseFloat(
                        selectedLoan.principal_amount,
                      ).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearLoan}
                    className="text-red-600 hover:text-red-800 font-bold text-xl px-2"
                  >
                    ✖
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={loanSearch}
                    onChange={(e) => {
                      setLoanSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="🔍 Type to search active loans..."
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
                  />

                  {showDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                      {filteredLoans.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                          No active loans found
                        </div>
                      ) : (
                        filteredLoans.map((loan) => (
                          <button
                            key={loan.id}
                            type="button"
                            onClick={() => handleSelectLoan(loan)}
                            className="w-full text-left p-3 hover:bg-green-50 border-b border-gray-100 last:border-b-0 transition"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-semibold text-gray-800">
                                  {loan.loan_code}
                                </p>
                                <p className="text-sm text-gray-700">
                                  {loan.first_name} {loan.last_name} •{" "}
                                  {loan.phone_number}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Principal: KES{" "}
                                  {parseFloat(
                                    loan.principal_amount,
                                  ).toLocaleString()}{" "}
                                  • Total Due: KES{" "}
                                  {parseFloat(
                                    loan.total_amount_due,
                                  ).toLocaleString()}
                                </p>
                              </div>
                              <span className="text-xs font-mono text-green-600 bg-green-100 px-2 py-1 rounded">
                                {loan.status}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Loan Summary if selected */}
            {loanSummary && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-3">
                  📊 Loan Status
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-gray-600">Total Due</p>
                    <p className="font-bold text-gray-800">
                      KES{" "}
                      {parseFloat(
                        loanSummary.summary.total_due,
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Paid So Far</p>
                    <p className="font-bold text-green-600">
                      KES{" "}
                      {parseFloat(
                        loanSummary.summary.total_paid,
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Balance</p>
                    <p className="font-bold text-orange-600">
                      KES{" "}
                      {parseFloat(loanSummary.summary.balance).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Progress</p>
                    <p className="font-bold text-blue-600">
                      {loanSummary.summary.progress_percentage}%
                    </p>
                  </div>
                </div>
                <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all"
                    style={{
                      width: `${loanSummary.summary.progress_percentage}%`,
                    }}
                  ></div>
                </div>
              </div>
            )}

            {/* Payment Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Amount Paid (KES) *
                </label>
                <input
                  type="number"
                  name="amount_paid"
                  value={formData.amount_paid}
                  onChange={handleInputChange}
                  required
                  min="1"
                  step="0.01"
                  placeholder="9166.67"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  name="payment_date"
                  value={formData.payment_date}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Payment Method *
                </label>
                <select
                  name="payment_method"
                  value={formData.payment_method}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none bg-white"
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
                  name="payment_reference"
                  value={formData.payment_reference}
                  onChange={handleInputChange}
                  placeholder="M-Pesa code, cheque #, etc."
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                placeholder="Any additional notes..."
                rows="2"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-green-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !formData.loan_id}
                className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
              >
                {submitting ? "Recording..." : "✓ Record Payment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile card list (desktop uses the table below) */}
      {!loading && payments.length > 0 && (
        <div className="md:hidden space-y-3 mb-4">
          {paginatedPayments.map((payment) => (
            <div
              key={payment.id}
              className="bg-white rounded-xl shadow-md p-4"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-green-600">
                    {payment.transaction_code}
                  </p>
                  <p className="font-semibold text-gray-800 truncate">
                    {payment.first_name} {payment.last_name}
                  </p>
                  <p className="text-xs text-ocean-600 font-mono">
                    {payment.loan_code}
                  </p>
                </div>
                <span className="flex-shrink-0 inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                  {payment.payment_method}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
                <div>
                  <p className="text-xs text-gray-500">Amount</p>
                  <p className="font-bold text-green-600">
                    KES {parseFloat(payment.amount_paid).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Date</p>
                  <p className="font-semibold">
                    {new Date(payment.payment_date).toLocaleDateString()}
                  </p>
                </div>
                {payment.payment_reference && (
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">Reference</p>
                    <p className="font-semibold truncate">
                      {payment.payment_reference}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payments List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading payments...
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="text-6xl mb-4">💵</div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No payments yet
          </h3>
          <p className="text-gray-500">
            Click "Record Payment" to log your first payment
          </p>
        </div>
      ) : (
        <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
              <tr>
                {[
                  ["Transaction", "transaction_code"],
                  ["Loan", "loan_code"],
                  ["Client", "first_name"],
                  ["Amount", "amount_paid"],
                  ["Method", "payment_method"],
                  ["Reference", "payment_reference"],
                  ["Date", "payment_date"],
                ].map(([label, key]) => (
                  <SortableHeader
                    key={key}
                    label={label}
                    sortKey={key}
                    requestSort={requestSort}
                    getSortIndicator={getSortIndicator}
                    className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedPayments.map((payment) => (
                <tr
                  key={payment.id}
                  className="border-b border-gray-100 hover:bg-gray-50 transition"
                >
                  <td className="px-6 py-4 font-mono text-sm font-semibold text-green-600">
                    {payment.transaction_code}
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-ocean-600">
                    {payment.loan_code}
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-semibold text-gray-800">
                        {payment.first_name} {payment.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {payment.phone_number}
                      </p>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-bold text-green-600">
                    KES {parseFloat(payment.amount_paid).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                      {payment.payment_method}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600 text-sm">
                    {payment.payment_reference || "-"}
                  </td>
                  <td className="px-6 py-4 text-gray-600 text-sm">
                    {new Date(payment.payment_date).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span>{" "}
                to{" "}
                <span className="font-semibold">
                  {Math.min(endIndex, payments.length)}
                </span>{" "}
                of <span className="font-semibold">{payments.length}</span>{" "}
                results
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  ← Previous
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(
                      (page) =>
                        page === 1 ||
                        page === totalPages ||
                        (page >= currentPage - 2 && page <= currentPage + 2),
                    )
                    .map((page, idx, arr) => {
                      const showEllipsisBefore =
                        idx > 0 && page - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={page}>
                          {showEllipsisBefore && (
                            <span className="px-2 text-gray-400">...</span>
                          )}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                              currentPage === page
                                ? "bg-green-600 text-white"
                                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {receiptModal && (
        <PaymentReceipt
          payment={receiptModal.payment}
          receipt={receiptModal.receipt}
          tenant={tenantBranding}
          onClose={() => setReceiptModal(null)}
        />
      )}
    </div>
  );
}

export default Payments;
