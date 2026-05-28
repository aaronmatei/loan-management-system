import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  AlertTriangle,
  ClipboardList,
  Coins,
  Smartphone,
  Mail,
  BarChart3,
  Search,
  Download,
  Check,
  Plus,
} from "lucide-react";
import api from "../services/api";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import PermissionGate from "../components/PermissionGate";
import { bulkExport } from "../utils/bulkExport";
import { useSortableTable } from "../hooks/useSortableTable";
import SortableHeader from "../components/SortableHeader";

function Loans() {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [poolStatus, setPoolStatus] = useState(null);
  const [clientCreditProfile, setClientCreditProfile] = useState(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    refundStatus: "all",
    overdue: "all", // "all" | "yes" | "no"
    disbursedFrom: "",
    disbursedTo: "",
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Client search state
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Tenant loan policy (set in Settings → Loan Policy). Defaults match the
  // backend until the real values arrive so the form is usable straight away.
  // late_payment_fee starts at 0 — not every lender charges one. The form
  // exposes a toggle that, when flipped on, makes the field editable.
  const [loanPolicy, setLoanPolicy] = useState({
    default_interest_rate: 50,
    processing_fee_rate: 0,
    late_payment_fee: 0,
  });

  const [formData, setFormData] = useState({
    client_id: "",
    principal_amount: "",
    annual_interest_rate: "50",
    monthly_interest_rate: "4.1667", // annual / 12 — display companion, synced
    loan_duration_months: "12",
    processing_fee_rate: "0",
    application_date: new Date().toISOString().split("T")[0],
    purpose: "",
    guarantor_name: "",
    guarantor_phone: "",
    guarantor_id_number: "",
    collateral_description: "",
    late_fee_enabled: false,
    late_payment_fee: 0,
    penalty_rate: 5,
  });

  useEffect(() => {
    fetchLoans();
    fetchClients();
    fetchPoolStatus();
    fetchLoanPolicy();
  }, []);

  // Pull the tenant's loan policy and seed the form defaults from it, so a
  // new application picks up the configured annual rate, late fee, etc.
  const fetchLoanPolicy = async () => {
    try {
      const r = await api.get("/settings/loan-policy");
      const d = r.data?.data || {};
      const policy = {
        default_interest_rate: parseFloat(d.default_interest_rate ?? 50),
        processing_fee_rate: parseFloat(d.processing_fee_rate ?? 0),
        late_payment_fee: parseFloat(d.late_payment_fee ?? 0),
      };
      setLoanPolicy(policy);
      setFormData((p) => ({
        ...p,
        annual_interest_rate: String(policy.default_interest_rate),
        monthly_interest_rate: String(roundRate(policy.default_interest_rate / 12)),
        processing_fee_rate: String(policy.processing_fee_rate),
        // Toggle stays OFF on load — staff opts in per loan. The
        // policy value just pre-fills what the input shows the
        // moment they turn the toggle on.
        late_payment_fee: policy.late_payment_fee,
      }));
    } catch {
      /* fall back to the defaults above */
    }
  };

  // Keep annual ⇄ monthly synced. Whichever the staff types is kept exactly;
  // the other is derived (annual = monthly × 12). Mirrors the Settings page.
  const roundRate = (n) => Math.round(Number(n) * 10000) / 10000;
  const onAnnualRateChange = (v) =>
    setFormData((p) => ({
      ...p,
      annual_interest_rate: v,
      monthly_interest_rate:
        v === "" ? "" : String(roundRate(parseFloat(v) / 12)),
    }));
  const onMonthlyRateChange = (v) =>
    setFormData((p) => ({
      ...p,
      monthly_interest_rate: v,
      annual_interest_rate:
        v === "" ? "" : String(roundRate(parseFloat(v) * 12)),
    }));

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset to the first page whenever the filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    filters.status,
    filters.refundStatus,
    filters.overdue,
    filters.disbursedFrom,
    filters.disbursedTo,
  ]);

  const fetchLoans = async () => {
    try {
      setLoading(true);
      const response = await api.get("/loans");
      // Applications (pending/under_review/counter_offered/approved/rejected)
      // live on the Applications page. The Loans page — and its counts — show
      // only loans that have actually been disbursed.
      const all = response.data.data || [];
      setLoans(
        all.filter((l) =>
          ["active", "completed", "defaulted", "suspended"].includes(l.status),
        ),
      );
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load loans");
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const response = await api.get("/clients");
      setClients(response.data.data || []);
    } catch (err) {
      console.error("Failed to fetch clients:", err);
    }
  };

  const fetchPoolStatus = async () => {
    try {
      const response = await api.get("/capital/status");
      setPoolStatus(response.data.data);
    } catch (err) {
      console.error("Failed to fetch pool status:", err);
    }
  };

  // Filter clients based on search
  const filteredClients = clients.filter((client) => {
    if (!clientSearch) return true;
    const search = clientSearch.toLowerCase();
    return (
      client.first_name?.toLowerCase().includes(search) ||
      client.last_name?.toLowerCase().includes(search) ||
      client.phone_number?.includes(search) ||
      client.email?.toLowerCase().includes(search) ||
      client.id_number?.includes(search) ||
      client.client_code?.toLowerCase().includes(search)
    );
  });

  const handleSelectClient = async (client) => {
    setSelectedClient(client);
    setFormData({ ...formData, client_id: client.id });
    setClientSearch(`${client.first_name} ${client.last_name}`);
    setShowDropdown(false);
    setClientCreditProfile(null);

    try {
      const response = await api.get(`/clients/${client.id}/credit-profile`);
      setClientCreditProfile(response.data.data);
    } catch (err) {
      console.error("Failed to fetch credit profile:", err);
    }
  };

  const handleClearClient = () => {
    setSelectedClient(null);
    setFormData({ ...formData, client_id: "" });
    setClientSearch("");
    setClientCreditProfile(null);
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Live calculation with annual rate
  const calculateLoanDetails = () => {
    const principal = parseFloat(formData.principal_amount) || 0;
    const annualRate = parseFloat(formData.annual_interest_rate) || 0;
    const months = parseInt(formData.loan_duration_months) || 0;

    const monthlyRate = annualRate / 12;
    const years = months / 12;
    const totalInterest = principal * (annualRate / 100) * years;
    const totalAmount = principal + totalInterest;
    const monthlyPayment = months > 0 ? totalAmount / months : 0;

    // Processing fee snapshot — mirrors what the backend will store on the
    // loan: principal × the form's processing_fee_rate% (defaults to the
    // tenant policy on load, but the staff can override per loan).
    const feeRate = parseFloat(formData.processing_fee_rate) || 0;
    const processingFee = Math.round(principal * feeRate) / 100;
    const netDisbursed = Math.max(0, principal - processingFee);

    return {
      monthlyRate: monthlyRate.toFixed(2),
      totalInterest: totalInterest.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      monthlyPayment: monthlyPayment.toFixed(2),
      feeRate,
      processingFee,
      netDisbursed,
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.client_id) {
      setError("Please select a client");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      // Late fee only counts when the toggle is on. If it's off we
      // send 0 so the backend doesn't accidentally pick up a stale
      // value the user never opted into.
      const submitData = {
        ...formData,
        late_payment_fee: formData.late_fee_enabled
          ? parseFloat(formData.late_payment_fee) || 0
          : 0,
      };
      const response = await api.post("/loans", submitData);
      setSuccess(
        `Application ${response.data.data.loan_code} submitted! A manager will review it shortly.`,
      );

      // Reset form — defaults come from the tenant's configured loan policy.
      setFormData({
        client_id: "",
        principal_amount: "",
        annual_interest_rate: String(loanPolicy.default_interest_rate),
        monthly_interest_rate: String(
          roundRate(loanPolicy.default_interest_rate / 12),
        ),
        loan_duration_months: "12",
        processing_fee_rate: String(loanPolicy.processing_fee_rate),
        application_date: new Date().toISOString().split("T")[0],
        purpose: "",
        guarantor_name: "",
        guarantor_phone: "",
        guarantor_id_number: "",
        collateral_description: "",
        late_fee_enabled: false,
        late_payment_fee: loanPolicy.late_payment_fee,
        penalty_rate: 5,
      });
      setSelectedClient(null);
      setClientSearch("");
      setClientCreditProfile(null);

      setShowForm(false);
      fetchLoans();
      fetchPoolStatus();
      // New loans are applications now — take the user to the queue.
      navigate("/applications");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  };

  const calc = calculateLoanDetails();

  // Counts for dropdown labels (always based on the full list)
  const statusCounts = {
    all: loans.length,
    active: loans.filter((l) => l.status === "active").length,
    completed: loans.filter((l) => l.status === "completed").length,
    defaulted: loans.filter((l) => l.status === "defaulted").length,
  };

  const refundCounts = {
    all: loans.length,
    pending: loans.filter((l) => l.refund_status === "pending").length,
    refunded: loans.filter((l) => l.refund_status === "refunded").length,
    none: loans.filter((l) => !l.refund_status).length,
  };

  // Apply all filters in combination (AND logic), client-side
  const filteredLoans = loans.filter((loan) => {
    // Applications live on the Applications page, not here — only
    // show real loans (active/completed/defaulted/suspended).
    if (
      ["pending", "under_review", "approved", "rejected"].includes(
        loan.status,
      )
    ) {
      return false;
    }

    // Search: loan code, client first/last name, or phone number
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const haystack = [
        loan.loan_code,
        loan.first_name,
        loan.last_name,
        loan.phone_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    // Status filter ('all' disables it)
    if (filters.status !== "all" && loan.status !== filters.status) {
      return false;
    }

    // Refund status filter ('all' disables it; 'none' = no refund due)
    if (filters.refundStatus !== "all") {
      if (filters.refundStatus === "none") {
        if (loan.refund_status) return false;
      } else if (loan.refund_status !== filters.refundStatus) {
        return false;
      }
    }

    // Overdue filter ('all' disables it)
    if (filters.overdue === "yes" && !((loan.overdue_count || 0) > 0)) {
      return false;
    }
    if (filters.overdue === "no" && (loan.overdue_count || 0) > 0) {
      return false;
    }

    // Disbursement-date range. Comparing date-only strings (YYYY-MM-DD)
    // so a time component on disbursed_at doesn't shift the bucket.
    if (filters.disbursedFrom || filters.disbursedTo) {
      if (!loan.disbursed_at) return false;
      const d = new Date(loan.disbursed_at).toISOString().split("T")[0];
      if (filters.disbursedFrom && d < filters.disbursedFrom) return false;
      if (filters.disbursedTo && d > filters.disbursedTo) return false;
    }

    return true;
  });

  const filtersActive =
    searchQuery.trim() !== "" ||
    filters.status !== "all" ||
    filters.refundStatus !== "all" ||
    filters.overdue !== "all" ||
    filters.disbursedFrom !== "" ||
    filters.disbursedTo !== "";

  const clearFilters = () => {
    setSearchQuery("");
    setFilters({
      status: "all",
      refundStatus: "all",
      overdue: "all",
      disbursedFrom: "",
      disbursedTo: "",
    });
  };

  // Derive `balance` so it's sortable alongside the real columns
  // (the row already reads loan.total_amount_due - loan.total_paid
  // inline; this just exposes the same number to the sort hook).
  const filteredLoansWithBalance = filteredLoans.map((l) => ({
    ...l,
    balance:
      parseFloat(l.total_amount_due || 0) - parseFloat(l.total_paid || 0),
  }));

  // Sort filtered set, then paginate. Default mirrors prior order.
  const {
    sortedData: sortedLoans,
    requestSort,
    getSortIndicator,
  } = useSortableTable(filteredLoansWithBalance, "created_at", "desc");

  // Pagination (totals row still uses the full filtered set)
  const itemsPerPage = 50;
  const totalPages = Math.ceil(sortedLoans.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedLoans = sortedLoans.slice(startIndex, endIndex);

  // ── Bulk selection ──────────────────────────────────────────
  const bulk = useBulkSelection(paginatedLoans);
  // SMS/Email target the borrowers of the selected loans (deduped).
  const selectedClientIds = [
    ...new Set(
      loans
        .filter((l) => bulk.isSelected(l.id))
        .map((l) => l.client_id),
    ),
  ];

  const handleBulkExport = async () => {
    try {
      await bulkExport(
        "/loans/bulk/export",
        { loan_ids: bulk.selectedArray },
        `selected_loans_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      bulk.clear();
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleBulkStatus = async (status) => {
    if (!window.confirm(`Update ${bulk.count} loan(s) to "${status}"?`))
      return;
    try {
      const res = await api.post("/loans/bulk/status", {
        loan_ids: bulk.selectedArray,
        status,
      });
      alert(res.data.message);
      bulk.clear();
      fetchLoans();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
            Loans
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            Total: <span className="font-semibold">{loans.length}</span> loans
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={clients.length === 0}
          className="w-full sm:w-auto px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {showForm ? (
            <span className="inline-flex items-center gap-1"><X size={16}/> Cancel</span>
          ) : (
            <span className="inline-flex items-center gap-1"><Plus size={16}/> New Application</span>
          )}
        </button>
      </div>

      {clients.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0"/> You need to add clients before creating loans. Go to Clients page
          first.
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

      {/* Create Loan Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <ClipboardList size={24}/> New Loan Application
          </h2>

          {poolStatus && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-blue-900 flex items-center gap-1">
                    <Coins size={16} className="text-blue-700"/> Available Pool Balance
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    Maximum amount you can lend
                  </p>
                </div>
                <p className="text-2xl font-bold text-blue-700">
                  KES {poolStatus.available_pool.toLocaleString()}
                </p>
              </div>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Searchable Client Dropdown */}
            <div ref={dropdownRef} className="relative">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Select Client *
                <span className="text-gray-500 font-normal ml-2">
                  (Search by name, phone, email, or ID)
                </span>
              </label>

              {selectedClient ? (
                <div className="flex items-center gap-2 p-3 border-2 border-ocean-300 bg-ocean-50 rounded-lg">
                  <div className="flex-1">
                    <p className="font-semibold text-ocean-900">
                      {selectedClient.first_name} {selectedClient.last_name}
                    </p>
                    <p className="text-sm text-ocean-700">
                      {selectedClient.client_code} •{" "}
                      {selectedClient.phone_number}
                      {selectedClient.email && ` • ${selectedClient.email}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearClient}
                    className="text-red-600 hover:text-red-800 px-2"
                  >
                    <X size={20}/>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Type to search clients..."
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />

                  {showDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                      {filteredClients.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                          No clients found matching "{clientSearch}"
                        </div>
                      ) : (
                        filteredClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => handleSelectClient(client)}
                            className="w-full text-left p-3 hover:bg-ocean-50 border-b border-gray-100 last:border-b-0 transition"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-semibold text-gray-800">
                                  {client.first_name} {client.last_name}
                                </p>
                                <p className="text-sm text-gray-500 mt-1 flex items-center gap-1 flex-wrap">
                                  <Smartphone size={13}/> {client.phone_number}
                                  {client.email && (
                                    <><span>•</span><Mail size={13}/>{client.email}</>
                                  )}
                                </p>
                                {client.id_number && (
                                  <p className="text-xs text-gray-400">
                                    ID: {client.id_number}
                                  </p>
                                )}
                              </div>
                              <span className="text-xs font-mono text-ocean-600 bg-ocean-100 px-2 py-1 rounded">
                                {client.client_code}
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

            {clientCreditProfile && (
              <div
                className={`rounded-lg p-4 ${
                  clientCreditProfile.eligibility.can_borrow
                    ? "bg-green-50 border border-green-200"
                    : "bg-red-50 border border-red-200"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-gray-800">
                      Credit Score:
                      <span
                        className={`ml-2 ${
                          clientCreditProfile.credit_score == null
                            ? "text-slate-500"
                            : clientCreditProfile.credit_score >= 80
                              ? "text-green-600"
                              : clientCreditProfile.credit_score >= 60
                                ? "text-yellow-600"
                                : "text-red-600"
                        }`}
                      >
                        {clientCreditProfile.credit_score == null
                          ? "New — building credit"
                          : `${clientCreditProfile.credit_score}/100`}
                      </span>
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      {clientCreditProfile.summary.total_loans_count} loans
                      total •{" "}
                      {clientCreditProfile.summary.on_time_rate.toFixed(0)}%
                      on-time rate
                    </p>

                    {!clientCreditProfile.eligibility.can_borrow && (
                      <div className="mt-2">
                        <p className="font-semibold text-red-700 flex items-center gap-1">
                          <AlertTriangle size={16} className="text-red-600"/> Cannot create loan:
                        </p>
                        <ul className="list-disc list-inside text-sm text-red-600 mt-1">
                          {clientCreditProfile.eligibility.blockers.map(
                            (b, i) => (
                              <li key={i}>{b}</li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                  </div>

                  {clientCreditProfile.eligibility.can_borrow && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Recommended max</p>
                      <p className="font-bold text-green-700">
                        KES{" "}
                        {clientCreditProfile.eligibility.max_recommended_amount.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Amount, Annual Rate, Monthly Rate, Duration */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Principal Amount (KES) *
                </label>
                <input
                  type="number"
                  name="principal_amount"
                  value={formData.principal_amount}
                  onChange={handleInputChange}
                  required
                  min="1000"
                  step="100"
                  placeholder="5000"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Annual Rate (%) *
                </label>
                <input
                  type="number"
                  value={formData.annual_interest_rate}
                  onChange={(e) => onAnnualRateChange(e.target.value)}
                  required
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Monthly Rate (%) *
                </label>
                <input
                  type="number"
                  value={formData.monthly_interest_rate}
                  onChange={(e) => onMonthlyRateChange(e.target.value)}
                  required
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Synced with annual rate.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Duration (months) *
                </label>
                <input
                  type="number"
                  name="loan_duration_months"
                  value={formData.loan_duration_months}
                  onChange={handleInputChange}
                  required
                  min="1"
                  max="60"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Processing Fee Rate (%)
                </label>
                <input
                  type="number"
                  name="processing_fee_rate"
                  value={formData.processing_fee_rate}
                  onChange={handleInputChange}
                  min="0"
                  max="100"
                  step="0.01"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Deducted from disbursed amount.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Application Date *
                </label>
                <input
                  type="date"
                  name="application_date"
                  value={formData.application_date}
                  onChange={handleInputChange}
                  required
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Defaults to today; backdate for paper applications.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Purpose
                </label>
                <select
                  name="purpose"
                  value={formData.purpose}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                >
                  <option value="">Select purpose…</option>
                  {[
                    "Business expansion",
                    "Stock purchase",
                    "Equipment purchase",
                    "School fees",
                    "Medical emergency",
                    "Home improvement",
                    "Vehicle purchase",
                    "Farming inputs",
                    "Working capital",
                    "Wedding expenses",
                    "Funeral expenses",
                    "Other",
                  ].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Agreement Details Section */}
            <div className="border-t-2 border-gray-100 pt-4 mt-4">
              <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                <ClipboardList size={20}/> Agreement Details (Optional)
              </h3>

              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-gray-700 mb-2">
                  Guarantor Information
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    type="text"
                    name="guarantor_name"
                    value={formData.guarantor_name || ""}
                    onChange={handleInputChange}
                    placeholder="Guarantor Name"
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    name="guarantor_phone"
                    value={formData.guarantor_phone || ""}
                    onChange={handleInputChange}
                    placeholder="Phone Number"
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    name="guarantor_id_number"
                    value={formData.guarantor_id_number || ""}
                    onChange={handleInputChange}
                    placeholder="ID Number"
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Collateral / Security (Optional)
                </label>
                <textarea
                  name="collateral_description"
                  value={formData.collateral_description || ""}
                  onChange={handleInputChange}
                  rows="2"
                  placeholder="Describe any collateral or security (e.g., Vehicle KCA 123A, Title Deed, etc.)"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  {/* Late payment fee is opt-in per loan — not every lender
                      charges one. The toggle gates whether the input is
                      live; off keeps it at 0 regardless of what's typed. */}
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Late Payment Fee (KES)
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formData.late_fee_enabled}
                      onClick={() =>
                        setFormData({
                          ...formData,
                          late_fee_enabled: !formData.late_fee_enabled,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        formData.late_fee_enabled
                          ? "bg-ocean-600"
                          : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                          formData.late_fee_enabled
                            ? "translate-x-5"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <input
                    type="number"
                    name="late_payment_fee"
                    value={
                      formData.late_fee_enabled
                        ? formData.late_payment_fee
                        : 0
                    }
                    onChange={handleInputChange}
                    disabled={!formData.late_fee_enabled}
                    min="0"
                    step="50"
                    placeholder="e.g. 500"
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      formData.late_fee_enabled
                        ? "border-gray-200 focus:border-ocean-500"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.late_fee_enabled
                      ? "Flat fee charged once an installment becomes overdue."
                      : "No late fee on this loan."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Penalty Rate (% per month on overdue)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    name="penalty_rate"
                    value={formData.penalty_rate ?? 5}
                    onChange={handleInputChange}
                    placeholder="5.0"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Live Calculation Preview */}
            {formData.principal_amount && (
              <div className="bg-ocean-50 border border-ocean-200 rounded-lg p-4">
                <h3 className="font-semibold text-ocean-900 mb-3 flex items-center gap-2">
                  <BarChart3 size={20}/> Loan Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div>
                    <p className="text-gray-600">Principal</p>
                    <p className="font-bold text-gray-800">
                      KES{" "}
                      {parseFloat(
                        formData.principal_amount || 0,
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Per Annum</p>
                    <p className="font-bold text-gray-800">
                      {formData.annual_interest_rate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Per Month</p>
                    <p className="font-bold text-gray-800">
                      {calc.monthlyRate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Total Interest</p>
                    <p className="font-bold text-orange-600">
                      KES {parseFloat(calc.totalInterest).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Monthly Payment</p>
                    <p className="font-bold text-green-600">
                      KES {parseFloat(calc.monthlyPayment).toLocaleString()}
                    </p>
                  </div>
                </div>
                {calc.processingFee > 0 && (
                  <div className="mt-3 pt-3 border-t border-ocean-200 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-gray-600">
                        Processing Fee ({calc.feeRate}%)
                      </p>
                      <p className="font-bold text-amber-700">
                        − KES {parseFloat(calc.processingFee).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">To Disburse</p>
                      <p className="font-bold text-ocean-700">
                        KES {parseFloat(calc.netDisbursed).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-ocean-200">
                  <p className="text-sm text-gray-600">
                    Total Repayable:{" "}
                    <span className="font-bold text-ocean-600 text-lg">
                      KES {parseFloat(calc.totalAmount).toLocaleString()}
                    </span>
                  </p>
                </div>
              </div>
            )}

            {poolStatus &&
              formData.principal_amount &&
              parseFloat(formData.principal_amount) >
                poolStatus.available_pool && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle size={16} className="text-red-600 flex-shrink-0"/> This amount exceeds available pool balance (KES{" "}
                  {poolStatus.available_pool.toLocaleString()})!
                </div>
              )}

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
                disabled={
                  submitting ||
                  !formData.client_id ||
                  (clientCreditProfile &&
                    !clientCreditProfile.eligibility.can_borrow) ||
                  (poolStatus &&
                    formData.principal_amount &&
                    parseFloat(formData.principal_amount) >
                      poolStatus.available_pool)
                }
                className="px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting..." : <span className="inline-flex items-center gap-2"><ClipboardList size={16}/> Submit Application</span>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Bar */}
      {!loading && loans.length > 0 && (
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          {/* Search stands alone — full width — so the input stays generous
              even when the row of filters below grows. */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Search
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <Search size={16}/>
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Loan code, client name, or phone..."
                className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            {/* Status */}
            <div className="min-w-[180px]">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
              >
                <option value="all">All Statuses ({statusCounts.all})</option>
                <option value="active">
                  Active ({statusCounts.active})
                </option>
                <option value="completed">
                  Completed ({statusCounts.completed})
                </option>
                <option value="defaulted">
                  Defaulted ({statusCounts.defaulted})
                </option>
              </select>
            </div>

            {/* Refund Status */}
            <div className="min-w-[200px]">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Refund Status
              </label>
              <select
                value={filters.refundStatus}
                onChange={(e) =>
                  setFilters({ ...filters, refundStatus: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
              >
                <option value="all">All Refunds ({refundCounts.all})</option>
                <option value="pending">
                  Pending Refund ({refundCounts.pending})
                </option>
                <option value="refunded">
                  Refunded ({refundCounts.refunded})
                </option>
                <option value="none">No Refund ({refundCounts.none})</option>
              </select>
            </div>

            {/* Overdue */}
            <div className="min-w-[180px]">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Overdue Payments
              </label>
              <select
                value={filters.overdue}
                onChange={(e) =>
                  setFilters({ ...filters, overdue: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
              >
                <option value="all">
                  All ({loans.length})
                </option>
                <option value="yes">
                  Has overdue (
                  {loans.filter((l) => (l.overdue_count || 0) > 0).length})
                </option>
                <option value="no">
                  No overdue (
                  {loans.filter((l) => (l.overdue_count || 0) === 0).length})
                </option>
              </select>
            </div>

            {/* Disbursed-date range */}
            <div className="min-w-[150px]">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Disbursed From
              </label>
              <input
                type="date"
                value={filters.disbursedFrom}
                onChange={(e) =>
                  setFilters({ ...filters, disbursedFrom: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>
            <div className="min-w-[150px]">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Disbursed To
              </label>
              <input
                type="date"
                value={filters.disbursedTo}
                onChange={(e) =>
                  setFilters({ ...filters, disbursedTo: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>

            {/* Clear */}
            {filtersActive && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition inline-flex items-center gap-1"
              >
                <X size={16}/> Clear
              </button>
            )}
          </div>

          {/* Active Filter Tags */}
          {filtersActive && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
              <span className="text-sm text-gray-500">
                Showing{" "}
                <span className="font-semibold text-gray-800">
                  {filteredLoans.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-gray-800">
                  {loans.length}
                </span>{" "}
                loans
              </span>

              {searchQuery.trim() && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                  Search: "{searchQuery.trim()}"
                  <button
                    onClick={() => setSearchQuery("")}
                    className="hover:text-blue-900"
                    aria-label="Remove search filter"
                  >
                    <X size={12}/>
                  </button>
                </span>
              )}

              {filters.status !== "all" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                  Status: {filters.status}
                  <button
                    onClick={() => setFilters({ ...filters, status: "all" })}
                    className="hover:text-green-900"
                    aria-label="Remove status filter"
                  >
                    <X size={12}/>
                  </button>
                </span>
              )}

              {filters.refundStatus !== "all" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
                  Refund:{" "}
                  {filters.refundStatus === "none"
                    ? "No Refund"
                    : filters.refundStatus}
                  <button
                    onClick={() =>
                      setFilters({ ...filters, refundStatus: "all" })
                    }
                    className="hover:text-ocean-900"
                    aria-label="Remove refund filter"
                  >
                    <X size={12}/>
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile card list (desktop uses the table below) */}
      {!loading && filteredLoans.length > 0 && (
        <div className="md:hidden space-y-3 mb-4">
          {paginatedLoans.map((loan) => {
            const balance = parseFloat(loan.balance_due || 0);
            return (
              <div
                key={loan.id}
                onClick={() => navigate(`/loans/${loan.id}`)}
                className={`bg-white rounded-xl shadow-md p-4 cursor-pointer hover:shadow-lg transition ${
                  bulk.isSelected(loan.id) ? "ring-2 ring-ocean-400" : ""
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={bulk.isSelected(loan.id)}
                      onChange={() => bulk.toggle(loan.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 mt-1 cursor-pointer flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold text-ocean-600">
                        {loan.loan_code}
                      </p>
                      <p className="font-semibold text-gray-800 truncate">
                        {loan.first_name} {loan.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {loan.phone_number}
                      </p>
                      {loan.disbursed_at && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Disbursed{" "}
                          {new Date(loan.disbursed_at).toLocaleDateString(
                            "en-KE",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            },
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex flex-col gap-1 items-end">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        loan.status === "active"
                          ? "bg-green-100 text-green-700"
                          : loan.status === "completed"
                            ? "bg-blue-100 text-blue-700"
                            : loan.status === "defaulted"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {loan.status}
                    </span>
                    {(loan.overdue_count || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                        <AlertTriangle size={10} />
                        {loan.overdue_count} overdue
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm border-t border-gray-100 pt-3">
                  <div>
                    <p className="text-xs text-gray-500">Principal</p>
                    <p className="font-bold">
                      KES{" "}
                      {parseFloat(loan.principal_amount).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Interest</p>
                    <p className="font-bold text-emerald-700">
                      KES{" "}
                      {parseFloat(loan.total_interest || 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Due</p>
                    <p className="font-bold">
                      KES{" "}
                      {parseFloat(loan.total_amount_due).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Paid</p>
                    <p className="font-bold text-green-600">
                      KES {parseFloat(loan.total_paid || 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p
                      className={`font-bold ${
                        balance > 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      KES {balance.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loans List */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading loans...
        </div>
      ) : loans.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="flex justify-center mb-4"><Coins size={48} className="text-gray-300"/></div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No loans yet
          </h3>
          <p className="text-gray-500">
            Click "Create Loan" to issue your first loan
          </p>
        </div>
      ) : filteredLoans.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="flex justify-center mb-4"><Search size={48} className="text-gray-300"/></div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No loans match your filters
          </h3>
          <p className="text-gray-500 mb-4">
            Try adjusting your search or filter criteria
          </p>
          <button
            onClick={clearFilters}
            className="px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-2"
          >
            <X size={16}/> Clear Filters
          </button>
        </div>
      ) : (
        <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-400px)]">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-4 w-10">
                    <input
                      type="checkbox"
                      checked={bulk.allOnPageSelected}
                      onChange={bulk.togglePage}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  {[
                    ["Loan Code", "loan_code", "left"],
                    ["Client", "first_name", "left"],
                    ["Disbursed", "disbursed_at", "left"],
                    ["Principal", "principal_amount", "right"],
                    ["Interest", "total_interest", "right"],
                    ["Total to Pay", "total_amount_due", "right"],
                    ["Paid", "total_paid", "right"],
                    ["Balance", "balance", "right"],
                    ["Refund Due", "overpayment_amount", "right"],
                    ["Status", "status", "left"],
                  ].map(([label, key, align]) => (
                    <SortableHeader
                      key={key}
                      label={label}
                      sortKey={key}
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align={align}
                      className={`px-4 py-4 text-${align} text-xs font-semibold text-gray-600 uppercase`}
                    />
                  ))}
                  <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                    View
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedLoans.map((loan) => {
                  const totalPaid = parseFloat(loan.total_paid || 0);
                  const totalDue = parseFloat(loan.total_amount_due);
                  const balance = parseFloat(loan.balance_due || 0);
                  const overpayment = parseFloat(loan.overpayment_amount || 0);

                  return (
                    <tr
                      key={loan.id}
                      onClick={() => navigate(`/loans/${loan.id}`)}
                      className={`border-b border-gray-100 hover:bg-ocean-50 transition cursor-pointer ${
                        bulk.isSelected(loan.id) ? "bg-ocean-50" : ""
                      }`}
                    >
                      <td
                        className="px-4 py-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={bulk.isSelected(loan.id)}
                          onChange={() => bulk.toggle(loan.id)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-4 font-mono text-sm font-semibold text-ocean-600">
                        {loan.loan_code}
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-semibold text-gray-800 text-sm">
                            {loan.first_name} {loan.last_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {loan.phone_number}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {loan.disbursed_at
                          ? new Date(loan.disbursed_at).toLocaleDateString(
                              "en-KE",
                              { day: "numeric", month: "short", year: "numeric" },
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-semibold text-gray-800 text-sm">
                          KES{" "}
                          {parseFloat(loan.principal_amount).toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-semibold text-emerald-700 text-sm">
                          KES{" "}
                          {parseFloat(
                            loan.total_interest || 0,
                          ).toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-ocean-600 text-sm">
                          KES {totalDue.toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-green-600 text-sm">
                          KES {totalPaid.toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p
                          className={`font-bold text-sm ${balance > 0 ? "text-orange-600" : "text-green-600"}`}
                        >
                          KES {balance.toLocaleString()}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {overpayment > 0 ? (
                          <div>
                            <p className="font-bold text-ocean-600 text-sm">
                              KES {overpayment.toLocaleString()}
                            </p>
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${
                                loan.refund_status === "refunded"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {loan.refund_status === "refunded" ? (
                                <span className="inline-flex items-center gap-1"><Check size={12}/> Refunded</span>
                              ) : (
                                "Pending"
                              )}
                            </span>
                          </div>
                        ) : (
                          <p className="text-gray-400 text-sm">-</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-semibold text-center ${
                              loan.status === "active"
                                ? "bg-green-100 text-green-700"
                                : loan.status === "completed"
                                  ? "bg-blue-100 text-blue-700"
                                  : loan.status === "defaulted"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {loan.status}
                          </span>
                          {(loan.overdue_count || 0) > 0 && (
                            <span
                              className="inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700"
                              title={`${loan.overdue_count} overdue installment${loan.overdue_count !== 1 ? "s" : ""} · KES ${Number(loan.overdue_amount || 0).toLocaleString()} (max ${loan.max_days_late}d late)`}
                            >
                              <AlertTriangle size={10} />
                              {loan.overdue_count} overdue
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="text-ocean-600 font-bold">→</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* TOTALS ROW */}
              <tfoot className="bg-ocean-gradient-soft border-t-2 border-ocean-200">
                <tr>
                  <td
                    colSpan="4"
                    className="px-4 py-4 font-bold text-gray-800 text-sm"
                  >
                    <span className="inline-flex items-center gap-2"><BarChart3 size={16}/> TOTALS ({filteredLoans.length} loans)</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="font-bold text-gray-800 text-sm">
                      KES{" "}
                      {filteredLoans
                        .reduce(
                          (sum, l) => sum + parseFloat(l.principal_amount || 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="font-bold text-emerald-700 text-sm">
                      KES{" "}
                      {filteredLoans
                        .reduce(
                          (sum, l) => sum + parseFloat(l.total_interest || 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="font-bold text-ocean-700 text-sm">
                      KES{" "}
                      {filteredLoans
                        .reduce(
                          (sum, l) => sum + parseFloat(l.total_amount_due || 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="font-bold text-green-700 text-sm">
                      KES{" "}
                      {filteredLoans
                        .reduce(
                          (sum, l) => sum + parseFloat(l.total_paid || 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <p className="font-bold text-orange-700 text-sm">
                      KES{" "}
                      {filteredLoans
                        .reduce(
                          (sum, l) => sum + parseFloat(l.balance_due || 0),
                          0,
                        )
                        .toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div>
                      <p className="font-bold text-ocean-700 text-sm">
                        KES{" "}
                        {filteredLoans
                          .reduce(
                            (sum, l) =>
                              sum + parseFloat(l.overpayment_amount || 0),
                            0,
                          )
                          .toLocaleString()}
                      </p>
                      <p className="text-xs text-ocean-600 mt-1">
                        Pending: KES{" "}
                        {filteredLoans
                          .filter((l) => l.refund_status === "pending")
                          .reduce(
                            (sum, l) =>
                              sum + parseFloat(l.overpayment_amount || 0),
                            0,
                          )
                          .toLocaleString()}
                      </p>
                    </div>
                  </td>
                  <td colSpan="2" className="px-4 py-4">
                    <p className="text-xs text-gray-600">
                      Active:{" "}
                      {filteredLoans.filter((l) => l.status === "active")
                        .length}{" "}
                      • Completed:{" "}
                      {
                        filteredLoans.filter((l) => l.status === "completed")
                          .length
                      }
                    </p>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 border-t border-gray-200">
              <div className="text-sm text-gray-600">
                Showing{" "}
                <span className="font-semibold">{startIndex + 1}</span> to{" "}
                <span className="font-semibold">
                  {Math.min(endIndex, filteredLoans.length)}
                </span>{" "}
                of{" "}
                <span className="font-semibold">{filteredLoans.length}</span>{" "}
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
                    .filter((page) => {
                      return (
                        page === 1 ||
                        page === totalPages ||
                        (page >= currentPage - 2 && page <= currentPage + 2)
                      );
                    })
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
                                ? "bg-ocean-600 text-white"
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

      <BulkActionBar
        selectedCount={bulk.count}
        totalCount={filteredLoans.length}
        onClear={bulk.clear}
      >
        <button
          onClick={handleBulkExport}
          className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
        >
          <Download size={16}/> Export
        </button>

        <BulkMessaging
          clientIds={selectedClientIds}
          onComplete={bulk.clear}
        />

        <PermissionGate role={["admin", "manager"]}>
          <div className="border-l border-white/30 mx-1 h-6"></div>
          <button
            onClick={() => handleBulkStatus("defaulted")}
            className="px-4 py-2 bg-red-500/30 hover:bg-red-500/50 rounded-lg text-sm font-semibold"
          >
            Mark Defaulted
          </button>
          <button
            onClick={() => handleBulkStatus("suspended")}
            className="px-4 py-2 bg-yellow-500/30 hover:bg-yellow-500/50 rounded-lg text-sm font-semibold"
          >
            Suspend
          </button>
          <button
            onClick={() => handleBulkStatus("active")}
            className="px-4 py-2 bg-green-500/30 hover:bg-green-500/50 rounded-lg text-sm font-semibold inline-flex items-center gap-1"
          >
            <Check size={16}/> Reactivate
          </button>
        </PermissionGate>
      </BulkActionBar>
    </div>
  );
}

export default Loans;
