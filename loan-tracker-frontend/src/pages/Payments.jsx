import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BarChart3, Smartphone, Coins, X, Check, Search, ChevronRight, ChevronDown } from "lucide-react";
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

  // Which loans are expanded to reveal their transactions.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpand = (loanId) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(loanId) ? next.delete(loanId) : next.add(loanId);
      return next;
    });

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
  const [txnModal, setTxnModal] = useState(null);
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
        `Payment ${txn.transaction_code} recorded successfully!`,
      );

      // Show the receipt modal if the backend returned a receipt block
      // (added with migration 012 / payments.js update). Enrich with the
      // penalty cleared by THIS payment so the receipt summary breaks it down.
      if (txn.receipt) {
        setReceiptModal({
          payment: txn,
          receipt: {
            ...txn.receipt,
            penalty_paid: parseFloat(txn.penalty_portion || 0),
          },
        });
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
  // Group transactions into ONE entry per loan, with the transactions nested
  // for the expand view. Group fields (count, total_paid, last_date) drive
  // sorting + the collapsed row; the transactions themselves show on expand.
  const loanGroups = (() => {
    const map = new Map();
    for (const p of payments) {
      let g = map.get(p.loan_id);
      if (!g) {
        g = {
          loan_id: p.loan_id,
          loan_code: p.loan_code,
          first_name: p.first_name,
          last_name: p.last_name,
          phone_number: p.phone_number,
          transactions: [],
          count: 0,
          total_paid: 0,        // gross (what the client paid)
          total_collected: 0,   // amount_paid - overpayment_portion
          overpayment: 0,       // sum of overpayment_portion
          last_date: p.payment_date,
        };
        map.set(p.loan_id, g);
      }
      g.transactions.push(p);
      g.count += 1;
      const op = parseFloat(p.overpayment_portion || 0);
      g.total_paid += parseFloat(p.amount_paid || 0);
      g.total_collected += parseFloat(p.amount_paid || 0) - op;
      g.overpayment += op;
      if (new Date(p.payment_date) > new Date(g.last_date))
        g.last_date = p.payment_date;
    }
    for (const g of map.values())
      g.transactions.sort(
        (a, b) => new Date(b.payment_date) - new Date(a.payment_date),
      );
    return [...map.values()];
  })();

  const {
    sortedData: sortedGroups,
    requestSort,
    getSortIndicator,
  } = useSortableTable(loanGroups, "last_date", "desc");

  // Pagination math (same pattern as Clients/Overdue pages) — over LOANS now
  const totalPages = Math.ceil(sortedGroups.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedGroups = sortedGroups.slice(startIndex, endIndex);

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
          {showForm ? <span className="inline-flex items-center gap-1.5"><X size={16} /> Cancel</span> : "+ Record Payment"}
        </button>
      </div>

      {loans.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-4">
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} className="text-yellow-600" /> No active loans available. Create a loan first to record payments.</span>
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
                    <p className="text-sm text-green-700 flex items-center gap-1.5">
                      <Smartphone size={14} /> {selectedLoan.phone_number}
                      <span className="mx-1">•</span>
                      <Coins size={14} /> KES{" "}
                      {parseFloat(
                        selectedLoan.principal_amount,
                      ).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearLoan}
                    className="text-red-600 hover:text-red-800 px-2"
                  >
                    <X size={18} />
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
                    placeholder="Type to search active loans..."
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
                                  • Remaining: KES{" "}
                                  {parseFloat(
                                    loan.balance_due ??
                                      Math.max(
                                        parseFloat(loan.total_amount_due || 0) -
                                          parseFloat(loan.total_paid || 0),
                                        0,
                                      ),
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

            {/* Loan Summary if selected — ledger style so the user can
                see at a glance what was cash vs waived on both the
                principal+interest book and the penalty book. Resolves
                the "I paid the balance and there's still 500 left"
                confusion: that 500 is the amount_due left after part of
                the cash had to clear the outstanding penalty first. */}
            {loanSummary && (() => {
              const s = loanSummary.summary;
              const num = (v) => parseFloat(v || 0);
              const fmt = (v) => num(v).toLocaleString();
              const totalDue = num(s.total_due);
              const cashToAmountDue = num(s.total_cash_paid);
              const waivedAmountDue = num(s.total_waived_amount_due);
              const balance = num(s.balance);
              const progress = parseFloat(s.progress_percentage || 0);
              const penaltyPaid = num(s.total_penalty_paid);
              const penaltyWaived = num(s.total_waived_penalty);
              const penaltyOutstanding = num(s.total_penalty_outstanding);
              const hasPenaltyActivity =
                penaltyPaid + penaltyWaived + penaltyOutstanding > 0;
              const totalToPay = balance + penaltyOutstanding;
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                    <BarChart3 size={16} /> Loan Status
                  </h3>

                  {/* Principal + interest ledger */}
                  <div className="bg-white rounded-md p-3 text-sm space-y-1.5">
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                      Principal + interest
                    </p>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total due</span>
                      <span className="font-semibold text-gray-800">
                        KES {fmt(totalDue)}
                      </span>
                    </div>
                    <div className="flex justify-between pl-4">
                      <span className="text-gray-500">↳ Cash paid</span>
                      <span className="font-semibold text-green-700">
                        KES {fmt(cashToAmountDue)}
                      </span>
                    </div>
                    {waivedAmountDue > 0 && (
                      <div className="flex justify-between pl-4">
                        <span className="text-gray-500">↳ Waived</span>
                        <span className="font-semibold text-fuchsia-700">
                          KES {fmt(waivedAmountDue)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-100 pt-1.5">
                      <span className="font-semibold text-gray-700">Balance</span>
                      <span
                        className={`font-bold ${
                          balance > 0 ? "text-orange-600" : "text-green-600"
                        }`}
                      >
                        KES {fmt(balance)}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600">Progress</span>
                      <span className="font-semibold text-blue-700">
                        {progress}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Penalty ledger — render whenever there's any
                      penalty activity (paid, waived, or still
                      outstanding). Outstanding line makes it clear
                      that penalty continues to accrue independent of
                      the principal+interest book; together with the
                      Total to pay row below it answers "what does
                      the borrower owe me right now in cash?". */}
                  {hasPenaltyActivity && (
                    <div className="mt-3 bg-white rounded-md p-3 text-sm space-y-1.5">
                      <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                        Penalties
                      </p>
                      {penaltyPaid > 0 && (
                        <div className="flex justify-between pl-4">
                          <span className="text-gray-500">↳ Cash paid</span>
                          <span className="font-semibold text-rose-700">
                            KES {fmt(penaltyPaid)}
                          </span>
                        </div>
                      )}
                      {penaltyWaived > 0 && (
                        <div className="flex justify-between pl-4">
                          <span className="text-gray-500">↳ Waived</span>
                          <span className="font-semibold text-fuchsia-700">
                            KES {fmt(penaltyWaived)}
                          </span>
                        </div>
                      )}
                      {penaltyOutstanding > 0 && (
                        <div className="flex justify-between pl-4">
                          <span className="text-gray-500">↳ Outstanding</span>
                          <span className="font-semibold text-orange-600">
                            KES {fmt(penaltyOutstanding)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Total to pay — what the borrower must hand over
                      right now to clear both books. Balance is the
                      remaining principal+interest after cash + waivers;
                      penaltyOutstanding is the still-accruing fine on
                      whatever's still overdue. Both are live figures. */}
                  {totalToPay > 0 && (
                    <div className="mt-3 bg-blue-100/60 border border-blue-200 rounded-md p-3 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-blue-900 uppercase text-xs tracking-wide">
                          Total to pay now
                        </span>
                        <span className="font-bold text-blue-900 text-lg">
                          KES {fmt(totalToPay)}
                        </span>
                      </div>
                      {penaltyOutstanding > 0 && balance > 0 && (
                        <p className="text-[11px] text-blue-700/80 mt-1">
                          KES {fmt(balance)} balance + KES{" "}
                          {fmt(penaltyOutstanding)} penalty
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

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
                {submitting ? "Recording..." : <span className="inline-flex items-center gap-1.5"><Check size={16} /> Record Payment</span>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile card list (desktop uses the table below) */}
      {!loading && payments.length > 0 && (
        <div className="md:hidden space-y-3 mb-4">
          {paginatedGroups.map((g) => {
            const open = expanded.has(g.loan_id);
            return (
              <div key={g.loan_id} className="bg-white rounded-xl shadow-md p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 truncate">
                      {g.first_name} {g.last_name}
                    </p>
                    <p className="text-xs text-gray-500">{g.phone_number}</p>
                    <Link
                      to={`/loans/${g.loan_id}`}
                      className="block text-xs text-ocean-600 font-mono hover:underline"
                    >
                      {g.loan_code}
                    </Link>
                  </div>
                  <span className="flex-shrink-0 inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                    {g.count} payment{g.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
                  <div>
                    <p className="text-xs text-gray-500">Total Paid</p>
                    <p className="font-bold text-green-600">
                      KES {g.total_paid.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Collected</p>
                    <p className="font-bold text-emerald-700">
                      KES {g.total_collected.toLocaleString()}
                    </p>
                  </div>
                  {g.overpayment > 0 && (
                    <div>
                      <p className="text-xs text-gray-500">Overpayment</p>
                      <p className="font-semibold text-amber-700">
                        KES {g.overpayment.toLocaleString()}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500">Last Payment</p>
                    <p className="font-semibold">
                      {new Date(g.last_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => toggleExpand(g.loan_id)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-ocean-600"
                >
                  {open ? (
                    <>
                      <ChevronDown size={14} /> Hide transactions
                    </>
                  ) : (
                    <>
                      <ChevronRight size={14} /> Show {g.count} transaction
                      {g.count !== 1 ? "s" : ""}
                    </>
                  )}
                </button>
                {open && (
                  <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                    {g.transactions.map((p) => (
                      <div
                        key={p.id}
                        className="flex justify-between items-center text-xs"
                      >
                        <button
                          onClick={() => setTxnModal(p)}
                          className="font-mono font-semibold text-green-600 hover:underline"
                        >
                          {p.transaction_code}
                        </button>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-500">
                            {new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                          </span>
                          <span className="font-bold text-green-600">
                            KES {parseFloat(p.amount_paid).toLocaleString()}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payments List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading payments...
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <Coins size={56} className="mx-auto mb-4 text-gray-300" />
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
                  ["Client", "first_name"],
                  ["Loan", "loan_code"],
                  ["Payments", "count"],
                  ["Total Paid", "total_paid"],
                  ["Total Collected", "total_collected"],
                  ["Overpayment", "overpayment"],
                  ["Last Payment", "last_date"],
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
              {paginatedGroups.map((g) => {
                const open = expanded.has(g.loan_id);
                return (
                  <React.Fragment key={g.loan_id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleExpand(g.loan_id)}
                            className="text-gray-400 hover:text-gray-700 shrink-0"
                            aria-label={open ? "Collapse" : "Expand"}
                          >
                            {open ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                          <div>
                            <p className="font-semibold text-gray-800">
                              {g.first_name} {g.last_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {g.phone_number}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm">
                        <Link
                          to={`/loans/${g.loan_id}`}
                          className="text-ocean-600 hover:underline"
                        >
                          {g.loan_code}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleExpand(g.loan_id)}
                          className="font-semibold text-gray-800 hover:text-ocean-600"
                        >
                          {g.count} payment{g.count !== 1 ? "s" : ""}
                        </button>
                      </td>
                      <td className="px-6 py-4 font-bold text-green-600">
                        KES {g.total_paid.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 font-bold text-emerald-700">
                        KES {g.total_collected.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {g.overpayment > 0 ? (
                          <span className="font-semibold text-amber-700">
                            KES {g.overpayment.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm">
                        {new Date(g.last_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-gray-50/70">
                        <td colSpan="7" className="px-8 pb-4 pt-1">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                                <th className="text-left py-1 font-semibold">
                                  Transaction
                                </th>
                                <th className="text-left py-1 font-semibold">
                                  Amount
                                </th>
                                <th className="text-left py-1 font-semibold">
                                  Method
                                </th>
                                <th className="text-left py-1 font-semibold">
                                  Reference
                                </th>
                                <th className="text-right py-1 font-semibold">
                                  Date
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.transactions.map((p) => (
                                <tr
                                  key={p.id}
                                  className="border-t border-gray-200/70"
                                >
                                  <td className="py-1.5">
                                    <button
                                      onClick={() => setTxnModal(p)}
                                      className="font-mono font-semibold text-green-600 hover:underline"
                                    >
                                      {p.transaction_code}
                                    </button>
                                  </td>
                                  <td className="py-1.5 font-bold text-green-600">
                                    KES{" "}
                                    {parseFloat(p.amount_paid).toLocaleString()}
                                  </td>
                                  <td className="py-1.5">
                                    <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                                      {p.payment_method}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-gray-600">
                                    {p.payment_reference || "-"}
                                  </td>
                                  <td className="py-1.5 text-right text-gray-600">
                                    {new Date(
                                      p.payment_date,
                                    ).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span>{" "}
                to{" "}
                <span className="font-semibold">
                  {Math.min(endIndex, loanGroups.length)}
                </span>{" "}
                of <span className="font-semibold">{loanGroups.length}</span>{" "}
                loans
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

      {txnModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setTxnModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-1 text-gray-800 flex items-center gap-2"><Search size={20} /> Transaction</h3>
            <p className="font-mono text-green-600 mb-4">
              {txnModal.transaction_code}
            </p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Loan</dt>
                <dd className="font-mono">{txnModal.loan_code}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Client</dt>
                <dd className="font-semibold">
                  {txnModal.first_name} {txnModal.last_name}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Amount</dt>
                <dd className="font-bold text-green-600">
                  KES {parseFloat(txnModal.amount_paid).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Method</dt>
                <dd>{txnModal.payment_method}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Reference</dt>
                <dd>{txnModal.payment_reference || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Date</dt>
                <dd>
                  {new Date(
                    txnModal.payment_date || txnModal.created_at,
                  ).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </dd>
              </div>
              {txnModal.notes && (
                <div>
                  <dt className="text-gray-500">Notes</dt>
                  <dd className="mt-1">{txnModal.notes}</dd>
                </div>
              )}
            </dl>
            <div className="flex justify-end gap-3 mt-5">
              <Link
                to={`/loans/${txnModal.loan_id}`}
                className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg text-sm"
              >
                View loan
              </Link>
              <button
                onClick={() => setTxnModal(null)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptModal && (
        <PaymentReceipt
          payment={receiptModal.payment}
          receipt={receiptModal.receipt}
          tenant={{
            ...tenantBranding,
            business_type:
              tenantBranding?.business_type ||
              JSON.parse(localStorage.getItem("user") || "{}")?.tenant
                ?.business_type,
          }}
          onClose={() => setReceiptModal(null)}
        />
      )}
    </div>
  );
}

export default Payments;
