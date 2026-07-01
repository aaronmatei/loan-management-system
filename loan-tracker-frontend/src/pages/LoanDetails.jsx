import React, { useState, useEffect, useRef } from "react";
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
  Handshake,
  RotateCcw,
  XCircle,
  Clock,
  Info,
  ChevronDown,
  Pause,
  Settings2,
} from "lucide-react";
import api from "../services/api";
import PaymentReceipt from "../components/PaymentReceipt";
import PermissionGate from "../components/PermissionGate";
import PawnPanel from "../components/PawnPanel";
import VehicleSecurityPanel from "../components/VehicleSecurityPanel";
import SalaryDetailsPanel from "../components/SalaryDetailsPanel";
import Skeleton, { SkeletonText } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import DataTable from "../components/DataTable";
import { useColumnPreset } from "../hooks/useTablePrefs";
import { useSortableTable } from "../hooks/useSortableTable";
import { formatKES, exactKES } from "../utils/money";

// Payment-history column presets (shared DataTable, matching the loans table).
// "actions" stays in every preset; other columns demote into the expandable
// detail row.
const TXN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["payment_date", "amount_paid", "balance_after", "actions"],
  },
  financials: {
    label: "Financials",
    keys: ["payment_date", "amount_paid", "payment_method", "balance_after", "actions"],
  },
  full: {
    label: "Everything",
    keys: [
      "payment_date",
      "amount_paid",
      "payment_method",
      "payment_reference",
      "notes",
      "balance_after",
      "actions",
    ],
  },
};

// Payment-schedule column presets (shared DataTable). "#" is the pinned column;
// demoted columns fold into the expandable detail row.
const SCHED_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["due_date", "amount_due", "amount_paid", "status"],
  },
  financials: {
    label: "Financials",
    keys: [
      "due_date",
      "amount_due",
      "amount_paid",
      "interest_portion",
      "principal_portion",
      "balance_after",
      "penalty_total",
      "status",
    ],
  },
  full: {
    label: "Everything",
    keys: [
      "due_date",
      "amount_due",
      "amount_paid",
      "interest_portion",
      "interest_paid",
      "principal_portion",
      "balance_after",
      "late_fee",
      "penalty_interest",
      "penalty_total",
      "penalty_paid",
      "status",
      "paid_date",
    ],
  },
};

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
  // Reason picker — five presets cover most real waivers; "other"
  // unlocks a free-text input. Kept as separate UI state so we can
  // tell "user picked Other and is typing" apart from "user has not
  // chosen yet" — both have empty waiverForm.reason but different
  // intent.
  const WAIVER_REASONS = [
    "Goodwill — first late payment",
    "Financial hardship (illness, job loss, family emergency)",
    "Negotiated settlement",
    "Billing or system error",
    "Uncollectable — write-off",
  ];
  const [reasonChoice, setReasonChoice] = useState("");
  const [savingWaiver, setSavingWaiver] = useState(false);
  const [waiverError, setWaiverError] = useState("");
  // Reverse-waiver confirmation modal.
  const [reversingWaiver, setReversingWaiver] = useState(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversingBusy, setReversingBusy] = useState(false);

  // Promise to Pay — modal state + form. Borrower commits to pay
  // KES X by date Y; we log it so the follow-up team can chase.
  const [showPromiseModal, setShowPromiseModal] = useState(false);
  const [promiseForm, setPromiseForm] = useState({
    amount: "",
    promised_date: "",
    notes: "",
  });
  const [savingPromise, setSavingPromise] = useState(false);
  const [promiseError, setPromiseError] = useState("");

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();
  const isAdminRole = currentUser?.role === "admin";

  // "Loan Management Actions" dropdown — collapses Edit / Waive /
  // Promise / status-change / Delete into one menu so the header
  // doesn't sprawl when many actions are valid. Click-outside +
  // Escape close it; the ref scopes the outside-click test so a
  // tap inside the menu doesn't dismiss it before the handler fires.
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef(null);

  useEffect(() => {
    fetchLoanDetails();
    fetchWaivers();
  }, [id]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const onClick = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
        setActionsMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setActionsMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionsMenuOpen]);

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
    setReasonChoice("");
    setWaiverError("");
    setShowWaiverModal(true);
    // Re-fetch waivers + loan summary so the modal's Loan Snapshot
    // (principal / interest / penalty outstanding) reflects any
    // waivers that landed since the page mounted — e.g. one
    // approved from the Waivers admin page, or one applied in a
    // separate browser tab. Without this the snapshot can stay
    // stuck at "0 waivers applied" and the admin sees the wrong
    // outstanding the next time they open the modal.
    fetchWaivers();
    fetchLoanDetails();
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

  const [reversingTxn, setReversingTxn] = useState(null); // the transaction being reversed

  // Payment-history table UX (shared DataTable): column preset, expandable
  // rows for demoted columns, and client-side sorting. Hooks run on
  // loanData?.transactions so they sit above the loading/error guards.
  const [txnPreset, setTxnPreset] = useColumnPreset(
    "loanDetail.txnColumns",
    TXN_PRESETS,
    "essentials",
  );
  const [expandedTxns, setExpandedTxns] = useState(() => new Set());
  const toggleTxn = (id) =>
    setExpandedTxns((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const {
    sortedData: sortedTxns,
    requestSort: txnRequestSort,
    getSortIndicator: txnSortIndicator,
  } = useSortableTable(loanData?.transactions || [], "payment_date", "desc");

  // Payment-schedule table UX (shared DataTable).
  const [schedPreset, setSchedPreset] = useColumnPreset(
    "loanDetail.schedColumns",
    SCHED_PRESETS,
    "financials",
  );
  const [expandedSched, setExpandedSched] = useState(() => new Set());
  const toggleSched = (id) =>
    setExpandedSched((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const {
    sortedData: sortedSched,
    requestSort: schedRequestSort,
    getSortIndicator: schedSortIndicator,
  } = useSortableTable(loanData?.schedule || [], "payment_number", "asc");

  const reversePayment = async (txn) => {
    const reason = window.prompt(
      `Reverse payment ${txn.transaction_code} (KES ${parseFloat(txn.amount_paid).toLocaleString()})?\n\nThis restores the loan balance and undoes the capital-pool entry. Optionally note why:`,
      "",
    );
    if (reason === null) return; // cancelled
    setReversingTxn(txn.id);
    try {
      const r = await api.post(`/payments/${txn.id}/void`, { reason: reason.trim() || undefined });
      if (r.data?.data?.was_refunded_warning) {
        alert("Reversed. Note: an overpayment on this loan was already marked refunded — verify any cash paid out.");
      }
      fetchLoanDetails();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to reverse payment");
    } finally {
      setReversingTxn(null);
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

  // Open the Promise modal pre-filled with a sensible default date
  // (today + 3 days — the typical "I'll pay you by Friday" window).
  const openPromiseModal = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    setPromiseForm({
      amount: "",
      promised_date: d.toISOString().slice(0, 10),
      notes: "",
    });
    setPromiseError("");
    setShowPromiseModal(true);
  };

  const handleSubmitPromise = async (e) => {
    e.preventDefault();
    const amt = parseFloat(promiseForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setPromiseError("Enter a positive amount.");
      return;
    }
    if (!promiseForm.promised_date) {
      setPromiseError("Pick a date the borrower committed to.");
      return;
    }
    setSavingPromise(true);
    setPromiseError("");
    try {
      await api.post(`/loans/${id}/promises`, {
        amount: amt,
        promised_date: promiseForm.promised_date,
        notes: promiseForm.notes.trim() || null,
      });
      setShowPromiseModal(false);
    } catch (err) {
      setPromiseError(err.response?.data?.error || "Failed to log promise");
    } finally {
      setSavingPromise(false);
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
      penalty_rate_enabled: parseFloat(l.penalty_rate || 0) > 0,
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
        penalty_rate: editForm.penalty_rate_enabled
          ? parseFloat(editForm.penalty_rate) || 0
          : 0,
      };
      // Don't send the UI-only flags to the API.
      delete payload.late_fee_enabled;
      delete payload.penalty_rate_enabled;
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
        {/* Back link placeholder */}
        <Skeleton className="h-4 w-28 mb-6" />

        {/* Identity hero placeholder */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6 dark:bg-slate-800">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" rounded="rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-6 w-56 mb-2" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        </div>

        {/* Summary cards placeholder */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-md p-6 dark:bg-slate-800">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>

        {/* Schedule table placeholder */}
        <div className="bg-white rounded-xl shadow-md overflow-hidden dark:bg-slate-800">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700">
            <Skeleton className="h-5 w-44 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonText key={i} lines={1} />
            ))}
          </div>
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

  // Payment-history columns for the shared DataTable. Defined in-render so the
  // action cells can close over setReceiptTxn / downloadPdf / reversePayment.
  const TXN_COLUMNS = [
    {
      key: "payment_date",
      label: "Date",
      align: "left",
      cell: (t) => (
        <span className="text-sm text-slate-700 dark:text-slate-200">
          {new Date(t.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </span>
      ),
    },
    {
      key: "amount_paid",
      label: "Amount",
      align: "right",
      money: true,
      total: (rows) =>
        rows.filter((r) => !r.voided).reduce((s, r) => s + parseFloat(r.amount_paid || 0), 0),
      totalClass: "text-money-pos",
      cell: (t) => {
        const penalty = parseFloat(t.penalty_portion || 0);
        const overpay = parseFloat(t.receipt?.overpayment_for_this || 0);
        const towardBalance = parseFloat(t.amount_paid || 0) - penalty - overpay;
        return (
          <div>
            <div className={`font-bold ${t.voided ? "text-slate-400 line-through" : "text-money-pos"}`}>
              {formatKES(t.amount_paid)}
            </div>
            {!t.voided && (penalty > 0 || overpay > 0) && (
              <div className="text-xs font-normal text-slate-500 dark:text-slate-400 mt-1 space-y-0.5 whitespace-normal">
                {penalty > 0 && <div className="text-amber-700">Penalty: {formatKES(penalty)}</div>}
                {towardBalance > 0 && <div>Toward balance: {exactKES(towardBalance)}</div>}
                {overpay > 0 && <div className="text-ocean-700">Overpaid: {formatKES(overpay)}</div>}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "payment_method",
      label: "Method",
      align: "left",
      cell: (t) => (
        <span className="inline-block px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
          {t.payment_method}
        </span>
      ),
    },
    {
      key: "payment_reference",
      label: "Reference",
      align: "left",
      sortable: false,
      cell: (t) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 whitespace-normal">
          {t.payment_reference || "—"}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Notes",
      align: "left",
      sortable: false,
      fullSpan: true,
      cell: (t) => (
        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-normal">
          {t.notes || "—"}
        </span>
      ),
    },
    {
      key: "balance_after",
      label: "Balance After",
      align: "right",
      sortable: false,
      cell: (t) =>
        t.receipt ? (
          <div>
            <p className="font-bold text-money-warn">
              {formatKES(t.receipt.remaining_balance_after_this)}
            </p>
            <p className="text-xs text-slate-400">
              {t.receipt.completion_percentage_after_this}% paid
            </p>
          </div>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "actions",
      label: "Receipt",
      align: "center",
      sortable: false,
      cell: (t) => (
        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
          <button
            onClick={() => setReceiptTxn(t)}
            className="text-ocean-600 hover:text-ocean-800"
            title="View receipt"
          >
            <Receipt size={18} />
          </button>
          <button
            onClick={() =>
              downloadPdf(`/reports/pdf/receipt/${t.id}`, `receipt_${t.transaction_code}.pdf`)
            }
            className="text-ocean-600 hover:text-ocean-800"
            title="Download receipt"
          >
            <Download size={18} />
          </button>
          {!t.voided && (
            <PermissionGate role={["admin", "manager"]}>
              <button
                onClick={() => reversePayment(t)}
                disabled={reversingTxn === t.id}
                className="text-rose-600 hover:text-rose-800 disabled:opacity-50"
                title="Reverse this payment"
              >
                <RotateCcw size={18} />
              </button>
            </PermissionGate>
          )}
        </div>
      ),
    },
  ];

  // Payment-schedule columns for the shared DataTable. Defined in-render so
  // cells can use getDaysStatus and the last-row balance fallback.
  const schedDate = (d) =>
    new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtTotal = (n) => (n > 0 ? exactKES(n) : "—");
  const penaltyRowSum = (rows, key) =>
    rows.reduce(
      (a, s) => a + (parseFloat(s.penalty_total || 0) > 0 ? parseFloat(s[key] || 0) : 0),
      0,
    );
  const lastPayNo = schedule[schedule.length - 1]?.payment_number;
  const moneyTotal = (key) => (rows) =>
    rows.reduce((a, s) => a + parseFloat(s[key] || 0), 0);
  const SCHED_COLUMNS = [
    {
      key: "due_date",
      label: "Due Date",
      align: "left",
      cell: (s) => {
        const ds = getDaysStatus(s.due_date, s.status);
        return (
          <div>
            <p className="text-slate-800 dark:text-slate-100">{schedDate(s.due_date)}</p>
            {ds && <p className={`text-xs ${ds.color}`}>{ds.text}</p>}
          </div>
        );
      },
    },
    {
      key: "amount_due",
      label: "Amount Due",
      align: "right",
      money: true,
      total: moneyTotal("amount_due"),
      totalClass: "text-navy-900 dark:text-slate-100",
      cell: (s) => (
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {formatKES(s.amount_due)}
        </span>
      ),
    },
    {
      key: "amount_paid",
      label: "Amount Paid",
      align: "right",
      money: true,
      total: moneyTotal("amount_paid"),
      totalClass: "text-money-pos",
      cell: (s) => (
        <span className="font-semibold text-money-pos">{formatKES(s.amount_paid || 0)}</span>
      ),
    },
    {
      key: "interest_portion",
      label: "Interest",
      align: "right",
      money: true,
      total: moneyTotal("interest_portion"),
      totalClass: "text-emerald-700",
      cell: (s) =>
        parseFloat(s.interest_portion || 0) > 0 ? (
          <span className="text-emerald-700 font-semibold">{formatKES(s.interest_portion)}</span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "interest_paid",
      label: "Interest Paid",
      align: "right",
      money: true,
      total: moneyTotal("interest_paid"),
      totalClass: "text-emerald-700",
      cell: (s) =>
        parseFloat(s.interest_paid || 0) > 0 ? (
          <span className="text-emerald-700 font-semibold">{formatKES(s.interest_paid)}</span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "principal_portion",
      label: "Principal",
      align: "right",
      money: true,
      total: moneyTotal("principal_portion"),
      totalClass: "text-ocean-700",
      cell: (s) =>
        parseFloat(s.principal_portion || 0) > 0 ? (
          <span className="text-ocean-700 font-semibold">{formatKES(s.principal_portion)}</span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "balance_after",
      label: "Balance After",
      align: "right",
      sortable: false,
      footer: () => (
        <span className="font-bold text-sm text-slate-500 dark:text-slate-400">
          {formatKES(0)}
        </span>
      ),
      cell: (s) =>
        parseFloat(s.balance_after || 0) > 0 ? (
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {formatKES(s.balance_after)}
          </span>
        ) : s.payment_number === lastPayNo ? (
          <span className="font-semibold text-slate-700 dark:text-slate-200">{formatKES(0)}</span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "late_fee",
      label: "Late Fee",
      align: "right",
      sortable: false,
      footer: (rows) => (
        <span className="font-bold text-sm text-slate-700 dark:text-slate-200">
          {fmtTotal(penaltyRowSum(rows, "late_fee"))}
        </span>
      ),
      cell: (s) =>
        parseFloat(s.penalty_total || 0) > 0 ? (
          <span className="text-slate-700 dark:text-slate-200">{formatKES(s.late_fee || 0)}</span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "penalty_interest",
      label: "Penalty Interest",
      align: "right",
      sortable: false,
      footer: (rows) => (
        <span className="font-bold text-sm text-slate-700 dark:text-slate-200">
          {fmtTotal(penaltyRowSum(rows, "penalty_interest"))}
        </span>
      ),
      cell: (s) =>
        parseFloat(s.penalty_total || 0) > 0 ? (
          <span className="text-slate-700 dark:text-slate-200">
            {formatKES(s.penalty_interest || 0)}
          </span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "penalty_total",
      label: "Penalty Total",
      align: "right",
      money: true,
      total: moneyTotal("penalty_total"),
      totalClass: "text-amber-700",
      cell: (s) =>
        parseFloat(s.penalty_total || 0) > 0 ? (
          <div className="text-amber-700 font-semibold">
            <div>{formatKES(s.penalty_total || 0)}</div>
            {parseFloat(s.penalty_outstanding || 0) > 0 &&
              parseFloat(s.penalty_paid || 0) > 0 && (
                <div className="text-xs text-red-600 font-normal">
                  {formatKES(s.penalty_outstanding)} unpaid
                </div>
              )}
          </div>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "penalty_paid",
      label: "Penalty Paid",
      align: "right",
      money: true,
      total: moneyTotal("penalty_paid"),
      totalClass: "text-money-pos",
      cell: (s) =>
        parseFloat(s.penalty_paid || 0) > 0 ? (
          <div className="text-money-pos font-semibold">
            <div>{formatKES(s.penalty_paid)}</div>
            {parseFloat(s.penalty_outstanding || 0) === 0 &&
              parseFloat(s.penalty_total || 0) > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400 font-normal">
                  cleared
                </div>
              )}
          </div>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      align: "left",
      cell: (s) => (
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
            s.status === "paid"
              ? "bg-green-100 text-green-700"
              : s.status === "waived"
                ? "bg-emerald-100 text-emerald-700"
                : s.status === "overdue"
                  ? "bg-red-100 text-red-700"
                  : "bg-yellow-100 text-yellow-700"
          }`}
        >
          {s.status}
        </span>
      ),
    },
    {
      key: "paid_date",
      label: "Paid Date",
      align: "left",
      sortable: false,
      cell: (s) =>
        s.actual_payment_date ? (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {schedDate(s.actual_payment_date)}
          </span>
        ) : (
          <span className="text-money-muted">—</span>
        ),
    },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Back Button */}
      <button
        onClick={() => navigate("/loans")}
        className="mb-4 text-ocean-600 hover:text-ocean-800 font-semibold flex items-center gap-2"
      >
        ← Back to Loans
      </button>

      {loan.loan_type === "pawn" && (
        <PawnPanel
          loanId={loan.id}
          loanCode={loan.loan_code}
          loanStatus={loan.status}
          onChange={fetchLoanDetails}
        />
      )}

      {loan.loan_type === "logbook" && (
        <VehicleSecurityPanel
          loanId={loan.id}
          loanCode={loan.loan_code}
          loanStatus={loan.status}
          onChange={fetchLoanDetails}
        />
      )}

      {loan.loan_type === "salary" && (
        <SalaryDetailsPanel
          loanId={loan.id}
          loanCode={loan.loan_code}
          onChange={fetchLoanDetails}
        />
      )}

      {/* Loan Actions — two groups:
          1. Reports & Agreements (always visible)
          2. Loan Management Actions — every status-changing /
             mutating action collapses into a single dropdown so the
             header stays calm regardless of how many actions are
             valid for this loan's status + role combo. The dropdown
             body short-circuits each item on the same status/role
             gates the old flat row used; if nothing renders, the
             whole button hides via `hasManagementActions`. */}
      {(() => {
        // Payments page only lists active loans in its loan-picker,
        // so "Record Payment" mirrors that gate. The Payments route
        // accepts ?loan=<id> and auto-selects + opens the form.
        const canRecordPayment = loan.status === "active";
        const canEdit =
          !["completed", "defaulted", "rejected"].includes(loan.status);
        const canDelete = [
          "pending",
          "under_review",
          "approved",
          "counter_offered",
          "rejected",
        ].includes(loan.status);
        const canWaive = ["active", "suspended"].includes(loan.status);
        const canPromise = ["active", "suspended"].includes(loan.status);
        const canDefault = loan.status === "active";
        const canSuspend = loan.status === "active";
        const canReactivate = ["defaulted", "suspended"].includes(loan.status);
        const hasManagementActions =
          canRecordPayment || canEdit || canDelete || canWaive ||
          canPromise || canDefault || canSuspend || canReactivate;

        const closeMenu = () => setActionsMenuOpen(false);
        const itemBase =
          "w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition text-left";

        return (
          <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5 dark:text-slate-400">
                Reports &amp; Agreements
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    downloadPdf(
                      `/reports/pdf/loan-statement/${loan.id}`,
                      `loan_${loan.loan_code}.pdf`,
                    )
                  }
                  className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
                >
                  <Download size={16} /> Download Statement
                </button>
                <button
                  onClick={() =>
                    downloadPdf(
                      `/reports/pdf/loan-agreement/${loan.id}`,
                      `loan_agreement_${loan.loan_code}.pdf`,
                    )
                  }
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition font-semibold inline-flex items-center gap-2"
                >
                  <FileText size={16} /> Download Agreement
                </button>
              </div>
            </div>

            {hasManagementActions && (
              <div ref={actionsMenuRef} className="relative ml-auto">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5 dark:text-slate-400">
                  Loan Management Actions
                </p>
                <button
                  type="button"
                  onClick={() => setActionsMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuOpen}
                  className="px-4 py-2 bg-white border border-ocean-200 text-ocean-700 hover:bg-ocean-50 rounded-lg transition font-semibold inline-flex items-center gap-2 shadow-sm dark:bg-slate-800"
                >
                  <Settings2 size={16} />
                  Loan Management Actions
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${
                      actionsMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {actionsMenuOpen && (
                  <div
                    role="menu"
                    className="absolute z-30 mt-1 right-0 sm:right-auto sm:left-0 min-w-[240px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden dark:bg-slate-800 dark:border-slate-700"
                  >
                    {canRecordPayment && (
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button
                          onClick={() => {
                            closeMenu();
                            navigate(`/payments?loan=${loan.id}`);
                          }}
                          className={itemBase}
                          title="Open Payments with this loan pre-selected"
                        >
                          <Coins size={16} className="text-emerald-600" />
                          Record Payment
                        </button>
                      </PermissionGate>
                    )}
                    {canEdit && (
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => {
                            closeMenu();
                            openEditModal();
                          }}
                          className={itemBase}
                        >
                          <Pencil size={16} className="text-ocean-600" />
                          Edit Loan
                        </button>
                      </PermissionGate>
                    )}
                    {canWaive && (
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button
                          onClick={() => {
                            closeMenu();
                            openWaiverModal();
                          }}
                          className={itemBase}
                          title={
                            isAdminRole
                              ? "Record a waiver (applies immediately)"
                              : "Request a waiver (admin must approve)"
                          }
                        >
                          <HandCoins size={16} className="text-emerald-700" />
                          {isAdminRole ? "Waive Loan" : "Request Waiver"}
                        </button>
                      </PermissionGate>
                    )}
                    {canPromise && (
                      <PermissionGate role={["admin", "manager", "loan_officer"]}>
                        <button
                          onClick={() => {
                            closeMenu();
                            openPromiseModal();
                          }}
                          className={itemBase}
                          title="Record the borrower's verbal promise to pay by a specific date"
                        >
                          <Handshake size={16} className="text-amber-600" />
                          Log Promise to Pay
                        </button>
                      </PermissionGate>
                    )}
                    {(canDefault || canSuspend || canReactivate) && (
                      <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    )}
                    {canReactivate && (
                      <button
                        onClick={() => {
                          closeMenu();
                          setStatusFormData({ status: "active", notes: "" });
                          setActionError("");
                          setShowStatusModal(true);
                        }}
                        className={itemBase}
                      >
                        <CheckCircle size={16} className="text-emerald-600" />
                        Reactivate Loan
                      </button>
                    )}
                    {canSuspend && (
                      <button
                        onClick={() => {
                          closeMenu();
                          setStatusFormData({ status: "suspended", notes: "" });
                          setActionError("");
                          setShowStatusModal(true);
                        }}
                        className={itemBase}
                      >
                        <Pause size={16} className="text-amber-600" />
                        Suspend Loan
                      </button>
                    )}
                    {canDefault && (
                      <button
                        onClick={() => {
                          closeMenu();
                          setStatusFormData({ status: "defaulted", notes: "" });
                          setActionError("");
                          setShowStatusModal(true);
                        }}
                        className={itemBase}
                      >
                        <AlertTriangle size={16} className="text-red-600" />
                        Mark as Defaulted
                      </button>
                    )}
                    {canDelete && (
                      <>
                        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                        <PermissionGate role="admin">
                          <button
                            onClick={() => {
                              closeMenu();
                              setShowDeleteModal(true);
                            }}
                            className={`${itemBase} text-red-700 hover:bg-red-50`}
                          >
                            <Trash2 size={16} className="text-red-600" />
                            Delete Loan
                          </button>
                        </PermissionGate>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Loan overview — identity, figures and repayment progress, all in one
          card (replaces the old gradient header + 4-tile grid + progress card). */}
      {(() => {
        const initials =
          `${(loan.first_name || "").charAt(0)}${(loan.last_name || "").charAt(0)}`.toUpperCase() ||
          "—";
        const principal = parseFloat(loan.principal_amount) || 0;
        const interestPct =
          principal > 0
            ? Math.round((parseFloat(loan.total_interest || 0) / principal) * 1000) / 10
            : 0;
        const installmentsTotal = schedule.length || loan.loan_duration_months || 0;
        const settled = parseFloat(summary.balance) <= 0;
        const nextSched = schedule.find(
          (s) => s.status !== "paid" && s.status !== "waived",
        );
        const pendingCount = schedule.filter(
          (s) => s.status !== "paid" && s.status !== "waived",
        ).length;
        const scheduleTotal = schedule.length;
        // "Cleared" date for a settled loan = the latest non-voided payment.
        const clearedDate =
          settled && transactions?.length
            ? transactions
                .filter((t) => !t.voided && t.payment_date)
                .map((t) => t.payment_date)
                .sort()
                .slice(-1)[0]
            : null;
        const fmtDay = (d) =>
          new Date(d).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
        const progressNote = clearedDate
          ? `cleared ${fmtDay(clearedDate)}`
          : nextSched
            ? `next due ${fmtDay(nextSched.due_date)}`
            : "";
        const STATUS_META = {
          active: { label: "Active", dot: "#16a37a", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300" },
          completed: { label: "Completed", dot: "#16a37a", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300" },
          defaulted: { label: "Defaulted", dot: "#ef4444", cls: "bg-rose-50 text-rose-700 dark:bg-rose-900/25 dark:text-rose-300" },
          pending: { label: "Pending", dot: "#d9892a", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300" },
          approved: { label: "Approved", dot: "#16a37a", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300" },
        };
        const sm = STATUS_META[loan.status] || {
          label: (loan.status || "").toUpperCase(),
          dot: "#64748b",
          cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
        };
        const Col = ({ label, value, valueCls = "text-navy-900 dark:text-slate-100", children }) => (
          <div className="p-5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p
              className={`text-2xl font-extrabold tracking-tight mt-1 ${valueCls}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {value}
            </p>
            {children}
          </div>
        );
        const Field = ({ label, children }) => (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {label}
            </p>
            <div className="font-semibold text-navy-900 dark:text-slate-100 mt-1">
              {children}
            </div>
          </div>
        );
        const methodPill = (
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
              loan.interest_method === "reducing"
                ? "bg-ocean-100 text-ocean-700"
                : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
            }`}
          >
            {loan.interest_method === "reducing" ? "Reducing" : "Flat"}
          </span>
        );
        const fmtSlash = (d) =>
          new Date(d).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
        return (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700 mb-6 overflow-hidden">
            {/* identity */}
            <div className="flex flex-wrap items-start gap-4 p-6 pb-5">
              <div className="w-16 h-16 rounded-full bg-navy-gradient text-white flex items-center justify-center text-lg font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Loan Code</p>
                <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 dark:text-slate-100 font-mono">
                  {loan.loan_code}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-bold text-navy-900 dark:text-slate-100">
                    {loan.first_name} {loan.last_name}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <Smartphone size={14} /> {loan.phone_number}
                  </span>
                  {loan.email && (
                    <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <Mail size={14} /> {loan.email}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold ${sm.cls}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: sm.dot }} />
                  {sm.label}
                </span>
                <p className="text-xs text-slate-400 mt-2">
                  Client{" "}
                  <span className="font-mono text-slate-500 dark:text-slate-400">{loan.client_code}</span>
                </p>
              </div>
            </div>
            {/* figures */}
            <div className="grid grid-cols-2 md:grid-cols-4 border-t border-slate-100 dark:border-slate-700 divide-x divide-slate-100 dark:divide-slate-700">
              <Col label="Principal" value={formatKES(loan.principal_amount)}>
                {parseFloat(loan.processing_fee || 0) > 0 && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Less {parseFloat(loan.processing_fee_rate)}% processing fee · disbursed{" "}
                    {formatKES(loan.net_disbursed_amount ?? loan.principal_amount)}
                  </p>
                )}
              </Col>
              <Col label="Total due" value={formatKES(summary.total_due)}>
                <p className="text-xs text-slate-400 mt-1.5">
                  Principal{interestPct > 0 ? ` + ${interestPct}% interest` : ""}
                </p>
              </Col>
              <Col label="Paid" value={formatKES(summary.total_paid)} valueCls="text-money-pos">
                {installmentsTotal > 0 && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Across {installmentsTotal} instalment{installmentsTotal === 1 ? "" : "s"}
                  </p>
                )}
              </Col>
              <Col label="Balance" value={formatKES(summary.balance)}>
                {settled ? (
                  <span className="inline-flex items-center gap-1.5 mt-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle size={13} /> Settled in full
                  </span>
                ) : (
                  <p className="text-xs text-slate-400 mt-1.5">{summary.progress_percentage}% repaid</p>
                )}
              </Col>
            </div>
            {/* progress */}
            <div className="border-t border-slate-100 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-navy-900 dark:text-slate-100">
                  Repayment progress
                  {progressNote && (
                    <span className="font-normal text-slate-400"> · {progressNote}</span>
                  )}
                </p>
                <span className="text-sm font-extrabold text-navy-900 dark:text-slate-100">
                  {summary.progress_percentage}%
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-ocean-gradient rounded-full transition-all duration-500"
                  style={{ width: `${summary.progress_percentage}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-slate-400">
                <span>{formatKES(0)}</span>
                <span>{formatKES(summary.total_due)}</span>
              </div>
            </div>
            {/* loan information + where it stands (merged from the old
                separate "Loan Information" and "What's Remaining" cards) */}
            <div className="border-t border-slate-100 dark:border-slate-700 p-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-4">
                Loan Information
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-5 gap-x-4 text-sm">
                <Field label="Package">
                  {loan.package_name ? (
                    <span className="inline-flex items-center gap-1.5">
                      {loan.package_name}
                      {loan.package_active === false && (
                        <span className="text-xs text-slate-400">(archived)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400">Custom loan</span>
                  )}
                </Field>
                <Field label="Interest Method">{methodPill}</Field>
                <Field label="Interest Rate (Monthly)">
                  {parseFloat(loan.interest_rate).toFixed(2)}%
                </Field>
                <Field label="Duration">{loan.loan_duration_months} months</Field>
                <Field label="Total Interest">{formatKES(loan.total_interest)}</Field>
                <Field label="Start Date">
                  {loan.start_date ? fmtSlash(loan.start_date) : "— (on disbursement)"}
                </Field>
                <Field label="End Date">{fmtSlash(loan.end_date)}</Field>
                <Field label="Application Date">
                  {fmtSlash(loan.application_date || loan.created_at)}
                </Field>
                {scheduleTotal > 0 && (
                  <Field label="Next Installment">
                    {nextSched ? formatKES(nextSched.amount_due) : "—"}
                    {nextSched && (
                      <span className="block text-xs font-normal text-slate-400 mt-0.5">
                        Due {fmtSlash(nextSched.due_date)}
                      </span>
                    )}
                  </Field>
                )}
                {scheduleTotal > 0 && (
                  <Field label="Installments Left">
                    {pendingCount}{" "}
                    <span className="text-sm font-medium text-slate-400">
                      of {scheduleTotal}
                    </span>
                  </Field>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Notes */}
      {loan.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-yellow-900 mb-1 flex items-center gap-1">
            <StickyNote size={14}/> Notes
          </p>
          <p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{loan.notes}</p>
        </div>
      )}

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
              <p className="text-sm text-gray-700 mb-2 dark:text-slate-200">
                {summary.refund_status === "refunded"
                  ? "Refund has been processed for this loan."
                  : "The client paid more than the loan amount. A refund is due."}
              </p>
              <p className="text-3xl font-bold text-ocean-700">
                {formatKES(summary.overpayment)}
              </p>
              {loan.refunded_date && (
                <p className="text-sm text-gray-600 mt-2 dark:text-slate-400">
                  Refunded on:{" "}
                  {new Date(loan.refunded_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
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

      {/* Payment Schedule */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Calendar size={20} className="text-navy-900 dark:text-slate-100" />
          <h3 className="text-lg font-semibold text-navy-900 dark:text-slate-100">
            Payment Schedule
          </h3>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            · {schedule.filter((s) => s.status === "paid").length} of{" "}
            {schedule.length} completed
            {(() => {
              // Penalty breakdown across the schedule. Accrued is what
              // was ever charged across all installments (per-row
              // penalty_total, which already takes the max of the live
              // formula and what's been paid — so it doesn't drop just
              // because a cleared row's recompute hit zero). The other
              // three legs come off the loan-summary totals so they
              // agree with the Payments page's Loan Status panel.
              const totalAccrued = schedule.reduce(
                (sum, s) => sum + parseFloat(s.penalty_total || 0),
                0,
              );
              const cashPaid = parseFloat(summary.total_penalty_paid || 0);
              const waived = parseFloat(summary.total_waived_penalty || 0);
              const outstanding = parseFloat(
                summary.total_penalty_outstanding || 0,
              );
              if (
                totalAccrued <= 0 &&
                cashPaid <= 0 &&
                waived <= 0 &&
                outstanding <= 0
              )
                return null;
              return (
                <>
                  <span className="text-amber-700 font-medium">
                    {" "}
                    · {formatKES(totalAccrued)} penalty accrued
                  </span>
                  {waived > 0 && (
                    <span className="text-fuchsia-700 font-medium">
                      {" "}
                      · {formatKES(waived)} waived
                    </span>
                  )}
                  {cashPaid > 0 && (
                    <span className="text-green-700 font-medium">
                      {" "}
                      · {formatKES(cashPaid)} paid
                    </span>
                  )}
                  {outstanding > 0 && (
                    <span className="text-orange-700 font-medium">
                      {" "}
                      · {formatKES(outstanding)} outstanding
                    </span>
                  )}
                </>
              );
            })()}
          </span>
        </div>
        <DataTable
          columns={SCHED_COLUMNS}
          rows={sortedSched}
          rowKey={(s) => s.id}
          pinned={{
            label: "#",
            sortKey: "payment_number",
            cell: (s) => (
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {s.payment_number}
              </span>
            ),
          }}
          presets={SCHED_PRESETS}
          preset={schedPreset}
          onPresetChange={setSchedPreset}
          expandedRows={expandedSched}
          onToggleRow={toggleSched}
          sort={{ requestSort: schedRequestSort, getSortIndicator: schedSortIndicator }}
          totals={schedule}
          totalsLabel={
            <span className="inline-flex items-center gap-2">
              <BarChart3 size={16} /> TOTALS · {schedule.length} payment
              {schedule.length !== 1 ? "s" : ""}
            </span>
          }
          maxHeight="calc(100vh - 220px)"
        />
      </div>

      {/* Transaction History */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList size={20} className="text-navy-900 dark:text-slate-100" />
          <h3 className="text-lg font-semibold text-navy-900 dark:text-slate-100">
            Payment History
          </h3>
          {transactions.length > 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              ·{" "}
              {(() => {
                const live = transactions.filter((t) => !t.voided).length;
                const reversed = transactions.length - live;
                return `${live} payment${live !== 1 ? "s" : ""} recorded${reversed ? ` · ${reversed} reversed` : ""}`;
              })()}
            </span>
          )}
        </div>
        <DataTable
          columns={TXN_COLUMNS}
          rows={sortedTxns}
          rowKey={(t) => t.id}
          pinned={{
            label: "Transaction",
            sortKey: "transaction_code",
            cell: (t) => (
              <div className="font-mono text-sm font-semibold text-money-pos">
                {t.transaction_code}
                {t.voided && (
                  <span className="ml-2 inline-block px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[10px] font-bold uppercase tracking-wide">
                    Reversed
                  </span>
                )}
              </div>
            ),
          }}
          presets={TXN_PRESETS}
          preset={txnPreset}
          onPresetChange={setTxnPreset}
          expandedRows={expandedTxns}
          onToggleRow={toggleTxn}
          sort={{ requestSort: txnRequestSort, getSortIndicator: txnSortIndicator }}
          totals={transactions}
          totalsLabel={
            <span className="inline-flex items-center gap-2">
              <BarChart3 size={16} /> TOTALS
            </span>
          }
          maxHeight="calc(100vh - 260px)"
          empty={
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card p-6">
              <EmptyState
                tone="muted"
                icon={Coins}
                title="No payments recorded yet"
                description="Payments recorded against this loan will appear here."
              />
            </div>
          }
        />

        {/* Loan-level receipt summary (current status + next payment). */}
        {receiptSummary && transactions.length > 0 && (
          <div className="rounded-xl shadow-card mt-4 p-4 lg:p-6 bg-ocean-gradient-soft dark:bg-slate-800">
            <h3 className="font-bold mb-3 text-gray-800 flex items-center gap-2 dark:text-slate-100"><BarChart3 size={18}/> Current Status</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Total Loan</p>
                <p className="font-bold">
                  {formatKES(loan.total_amount_due)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Total Paid</p>
                <p className="font-bold text-green-600">
                  {formatKES(receiptSummary.total_paid)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Remaining</p>
                <p className="font-bold text-orange-600">
                  {formatKES(receiptSummary.remaining_balance)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Progress</p>
                <p className="font-bold text-ocean-600">
                  {receiptSummary.completion_percentage}%
                </p>
              </div>
            </div>
            {receiptSummary.next_payment_date &&
              !receiptSummary.is_fully_paid && (
                <div className="mt-3 pt-3 border-t border-ocean-200 text-center">
                  <p className="text-xs text-gray-500 flex items-center justify-center gap-1 dark:text-slate-400"><Calendar size={12}/> Next Payment Due</p>
                  <p className="font-bold text-xl text-ocean-600">
                    {formatKES(receiptSummary.next_payment_amount)}
                  </p>
                  <p className="text-sm text-ocean-600">
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
        <div className="bg-white rounded-xl shadow-md overflow-hidden mt-6 dark:bg-slate-800">
          <div className="p-6 border-b border-gray-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2 dark:text-slate-100">
              <HandCoins size={20} /> Waivers
            </h3>
            <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
              {waivers.length} record{waivers.length !== 1 ? "s" : ""} ·
              total approved:{" "}
              <span className="font-semibold text-emerald-700">
                {formatKES(
                  waivers
                    .filter((w) => w.status === "approved")
                    .reduce((s, w) => s + parseFloat(w.amount || 0), 0),
                )}
              </span>
            </p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
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
                          − {formatKES(w.amount)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold uppercase dark:bg-slate-700 dark:text-slate-200">
                          {w.type}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusPill.bg} ${statusPill.text}`}
                        >
                          {statusPill.icon} {statusPill.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 dark:text-slate-200">
                        <strong>Reason:</strong> {w.reason}
                      </p>
                      {w.notes && (
                        <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                          {w.notes}
                        </p>
                      )}
                      <div className="mt-2 text-xs text-gray-500 space-y-0.5 dark:text-slate-400">
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
                          <p className="text-gray-600 dark:text-slate-400">
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
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full dark:bg-slate-800">
            <h3 className="text-2xl font-bold text-gray-800 mb-4 dark:text-slate-100">
              {statusFormData.status === "defaulted" && "Mark Loan as Defaulted"}
              {statusFormData.status === "suspended" && "Suspend Loan"}
              {statusFormData.status === "active" && (
                <span className="inline-flex items-center gap-2"><CheckCircle size={24}/> Reactivate Loan</span>
              )}
            </h3>

            <p className="text-gray-600 mb-4 dark:text-slate-400">
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
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full dark:bg-slate-800">
            <h3 className="text-2xl font-bold text-gray-800 mb-4 dark:text-slate-100">
              Process Refund
            </h3>
            <p className="text-gray-600 mb-4 dark:text-slate-400">
              Refund Amount:{" "}
              <strong className="text-ocean-600 text-xl">
                {formatKES(summary.overpayment)}
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
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                    required
                  >
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
          fetchReceiptPdf={async () => {
            const r = await api.get(
              `/reports/pdf/receipt/${receiptTxn.id}`,
              { responseType: "blob" },
            );
            return {
              blob: r.data,
              filename: `Receipt-${receiptTxn.transaction_code || receiptTxn.id}.pdf`,
            };
          }}
          onClose={() => setReceiptTxn(null)}
        />
      )}

      {/* Edit Loan Modal */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-3xl w-full my-8 dark:bg-slate-800">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2 dark:text-slate-100">
                  <Pencil size={22} /> Edit Loan
                </h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  {loan.loan_code} ·{" "}
                  <span className="font-semibold">
                    {loan.first_name} {loan.last_name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                disabled={editing}
                className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
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

            {/* Package-bound loans inherit their contract from the
                loan_packages table. Rate, processing fee, and
                interest method are LOCKED here so an admin can't
                silently break a customer's terms; principal and
                duration stay editable but get clamped to the
                package's min/max via input min/max + a backend
                guard that 400s on violations. Custom loans
                (loan.package_name = null) don't render this banner
                and keep every field free. */}
            {loan.package_name && (
              <div className="bg-ocean-50 border border-ocean-200 text-ocean-900 text-sm rounded-lg p-3 mb-4 flex items-start gap-2">
                <Info size={16} className="flex-shrink-0 mt-0.5 text-ocean-600" />
                <span>
                  This loan is bound by the <strong>{loan.package_name}</strong>{" "}
                  package. Rate, processing fee and interest method are fixed
                  by the package; principal and duration must stay within the
                  package range. Late fee, penalty rate, dates, guarantor and
                  collateral stay editable per loan.
                </span>
              </div>
            )}

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* Package constraints derived once per render so we
                  don't re-parse on every keystroke. `pkgLocked` is
                  the boolean every disable-able field reads from;
                  the min/max hints render only on bounds that exist
                  (a custom loan has loan.package_name = null so
                  every input keeps its original free behaviour). */}
              {(() => null)()}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Principal (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min={loan.package_min_amount ?? 1}
                    max={loan.package_max_amount ?? undefined}
                    value={editForm.principal_amount}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        principal_amount: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                  {loan.package_name &&
                    (loan.package_min_amount != null ||
                      loan.package_max_amount != null) && (
                      <p className="text-xs text-ocean-700 mt-1">
                        Package range: {formatKES(loan.package_min_amount || 0)}
                        {" – "}
                        {loan.package_max_amount
                          ? formatKES(loan.package_max_amount)
                          : "no max"}
                      </p>
                    )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Annual Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.annual_interest_rate}
                    onChange={(e) => onEditAnnualChange(e.target.value)}
                    disabled={!!loan.package_name}
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:border-ocean-500 focus:outline-none ${
                      loan.package_name
                        ? "border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                        : "border-gray-200 dark:border-slate-700"
                    }`}
                  />
                  {loan.package_name && (
                    <p className="text-xs text-ocean-700 mt-1">
                      Fixed by package
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Monthly Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.monthly_interest_rate}
                    onChange={(e) => onEditMonthlyChange(e.target.value)}
                    disabled={!!loan.package_name}
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:border-ocean-500 focus:outline-none ${
                      loan.package_name
                        ? "border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                        : "border-gray-200 dark:border-slate-700"
                    }`}
                  />
                  {loan.package_name && (
                    <p className="text-xs text-ocean-700 mt-1">
                      Fixed by package
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Duration (months) *
                  </label>
                  <input
                    type="number"
                    required
                    min={loan.package_min_duration_months ?? 1}
                    max={loan.package_max_duration_months ?? 60}
                    value={editForm.loan_duration_months}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        loan_duration_months: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                  {loan.package_name &&
                    (loan.package_min_duration_months != null ||
                      loan.package_max_duration_months != null) && (
                      <p className="text-xs text-ocean-700 mt-1">
                        Package range: {loan.package_min_duration_months ?? 1}
                        {" – "}
                        {loan.package_max_duration_months ?? "60"} months
                      </p>
                    )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                  disabled={!!loan.package_name}
                  className={`w-full md:w-1/2 px-3 py-2 border-2 rounded-lg focus:border-ocean-500 focus:outline-none ${
                    loan.package_name
                      ? "border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                      : "border-gray-200 dark:border-slate-700"
                  }`}
                />
                {loan.package_name && (
                  <p className="text-xs text-ocean-700 mt-1">
                    Fixed by package
                  </p>
                )}
              </div>

              {/* Date chain: creation ≤ disbursement ≤ start. min/max on
                  each input gives the user immediate feedback, plus
                  client-side validation runs on submit. */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                        ? "border-gray-200 focus:border-ocean-500 dark:border-slate-700"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  />
                  {![
                    "active",
                    "completed",
                    "defaulted",
                    "suspended",
                  ].includes(loan.status) && (
                    <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                      Set at disbursement.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                        ? "border-gray-200 focus:border-ocean-500 dark:border-slate-700"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  />
                  {[
                    "active",
                    "completed",
                    "defaulted",
                    "suspended",
                  ].includes(loan.status) && (
                    <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                      Default: 1 month after disbursement.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                  Purpose
                </label>
                <input
                  type="text"
                  value={editForm.purpose}
                  onChange={(e) =>
                    setEditForm({ ...editForm, purpose: e.target.value })
                  }
                  placeholder="e.g. Business expansion"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-3 dark:bg-slate-900">
                <h4 className="font-semibold text-gray-700 mb-2 text-sm dark:text-slate-200">
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
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
                    className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700 whitespace-nowrap dark:text-slate-200">
                      Late Payment Fee (KES)
                    </label>
                    {loan.package_name && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ocean-700 bg-ocean-50 border border-ocean-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                        Per-loan · editable
                      </span>
                    )}
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
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-slate-800 transition ${
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
                        ? "border-gray-200 focus:border-ocean-500 dark:border-slate-700"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  />
                </div>
                <div>
                  {/* Penalty rate is opt-in per loan — same pattern as
                      the Late Payment Fee toggle above. Off sends 0
                      to the backend regardless of what's typed. */}
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700 whitespace-nowrap dark:text-slate-200">
                      Penalty Rate (%)
                    </label>
                    {loan.package_name && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ocean-700 bg-ocean-50 border border-ocean-200 px-1.5 py-0.5 rounded whitespace-nowrap">
                        Per-loan · editable
                      </span>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editForm.penalty_rate_enabled}
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          penalty_rate_enabled: !editForm.penalty_rate_enabled,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        editForm.penalty_rate_enabled
                          ? "bg-ocean-600"
                          : "bg-gray-300"
                      }`}
                      title={
                        editForm.penalty_rate_enabled
                          ? "Penalty rate enabled — turn off to remove"
                          : "Penalty rate disabled — turn on to charge"
                      }
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-slate-800 transition ${
                          editForm.penalty_rate_enabled
                            ? "translate-x-5"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={
                      editForm.penalty_rate_enabled
                        ? editForm.penalty_rate
                        : 0
                    }
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        penalty_rate: e.target.value,
                      })
                    }
                    disabled={!editForm.penalty_rate_enabled}
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      editForm.penalty_rate_enabled
                        ? "border-gray-200 focus:border-ocean-500 dark:border-slate-700"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                    {editForm.penalty_rate_enabled
                      ? "Monthly % charged on the overdue principal balance."
                      : "No penalty rate on this loan."}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                  Notes
                </label>
                <textarea
                  rows="2"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
                  className="px-6 py-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 lg:p-8 max-w-md w-full dark:bg-slate-800">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2 dark:text-slate-100">
              <Trash2 size={22} className="text-red-700" /> Delete loan?
            </h3>
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
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
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-xl w-full my-8 dark:bg-slate-800">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2 dark:text-slate-100">
                  <HandCoins size={22} className="text-emerald-700" />
                  {isAdminRole ? "Waive Loan" : "Request Waiver"}
                </h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  {loan.loan_code} ·{" "}
                  <span className="font-semibold">
                    {loan.first_name} {loan.last_name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowWaiverModal(false)}
                disabled={savingWaiver}
                className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
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

            {/* Loan snapshot. Three outstanding buckets — only the
                two waivable ones (Interest, Penalty) get a "USE"
                button that fills the form. Principal stays visible
                for context with a "Not waivable" badge.

                Outstanding math separates waivers (admin-declared
                buckets, read from loan_waivers.allocation) from cash
                (no declared split, prorated by the contract ratio).
                Without this split, a "waive interest" action looks
                like it also paid down principal because both numbers
                are derived from the same amount_due bucket — which is
                exactly the "principal dropped from 3,000 to 2,272.73
                after I only waived interest" confusion. */}
            {(() => {
              const principal = parseFloat(loan.principal_amount || 0);
              const totalInterest = parseFloat(loan.total_interest || 0);
              const totalAmountDue = principal + totalInterest;
              const totalAmountPaid = (schedule || []).reduce(
                (acc, s) => acc + parseFloat(s.amount_paid || 0),
                0,
              );
              const approvedW = (waivers || []).filter(
                (w) => w.status === "approved",
              );
              // Defensive parse — allocation comes off a JSONB column.
              // node-postgres normally hands it back as an object, but
              // for some payloads (or if a transformer ever stops
              // running) it arrives as a string and `w.allocation?.[k]`
              // silently returns undefined → every bucket reads as 0
              // → modal says "Interest outstanding 6,000" on a loan
              // that's clearly had a 2k interest waiver applied.
              const allocOf = (w) =>
                typeof w.allocation === "string"
                  ? JSON.parse(w.allocation || "{}")
                  : w.allocation || {};
              const sumAlloc = (key) =>
                approvedW.reduce(
                  (a, w) => a + parseFloat(allocOf(w)[key] || 0),
                  0,
                );
              const waiverAmountTotal = sumAlloc("amount_total");
              const waiverInterest = sumAlloc("interest_total");
              const waiverPrincipal = sumAlloc("principal_total");
              const cashToAmountDue = Math.max(
                0,
                totalAmountPaid - waiverAmountTotal,
              );
              const principalRatio =
                totalAmountDue > 0 ? principal / totalAmountDue : 0;
              const interestRatio =
                totalAmountDue > 0 ? totalInterest / totalAmountDue : 0;
              const principalPaid =
                cashToAmountDue * principalRatio + waiverPrincipal;
              const interestPaid =
                cashToAmountDue * interestRatio + waiverInterest;
              const principalOutstanding = Math.max(0, principal - principalPaid);
              const interestOutstanding = Math.max(
                0,
                totalInterest - interestPaid,
              );
              const penaltyOutstanding = (schedule || []).reduce(
                (acc, s) => acc + parseFloat(s.penalty_outstanding || 0),
                0,
              );

              const useBucket = (value, type) =>
                setWaiverForm((p) => ({
                  ...p,
                  type,
                  amount: value > 0 ? value.toFixed(2) : "",
                }));

              const Row = ({
                label,
                value,
                color,
                fillType,
                badge,
              }) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${color}`}>
                      {formatKES(value)}
                    </span>
                    {fillType ? (
                      <button
                        type="button"
                        onClick={() => useBucket(value, fillType)}
                        disabled={!(value > 0)}
                        className="text-[10px] text-emerald-700 hover:text-emerald-900 underline font-medium uppercase tracking-wider disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                        title={`Use the full ${fillType} outstanding as the waiver amount`}
                      >
                        use
                      </button>
                    ) : badge ? (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 font-semibold dark:bg-slate-700 dark:text-slate-400">
                        {badge}
                      </span>
                    ) : null}
                  </div>
                </div>
              );

              return (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 space-y-1.5 dark:bg-slate-900 dark:border-slate-700">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1 dark:text-slate-400">
                    Loan snapshot
                  </p>
                  <Row
                    label="Principal outstanding"
                    value={principalOutstanding}
                    color="text-gray-700"
                    badge="Not waivable"
                  />
                  <Row
                    label="Interest outstanding"
                    value={interestOutstanding}
                    color="text-ocean-700"
                    fillType="interest"
                  />
                  <Row
                    label="Penalty outstanding"
                    value={penaltyOutstanding}
                    color="text-rose-700"
                    fillType="penalty"
                  />
                </div>
              );
            })()}

            {waiverError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
                {waiverError}
              </div>
            )}

            <form onSubmit={handleSubmitWaiver} className="space-y-4">
              {(() => {
                // Live cap + percentage indicator for the Amount
                // field. Mirrors the snapshot block above — admin-
                // declared waivers carve out their own buckets;
                // cash gets prorated by contract ratio.
                const principal = parseFloat(loan.principal_amount || 0);
                const totalInterest = parseFloat(loan.total_interest || 0);
                const totalAmountDue = principal + totalInterest;
                const totalAmountPaid = (schedule || []).reduce(
                  (acc, s) => acc + parseFloat(s.amount_paid || 0),
                  0,
                );
                const approvedW = (waivers || []).filter(
                  (w) => w.status === "approved",
                );
                // Same defensive parse as the snapshot block above —
                // see the comment there.
                const allocOf = (w) =>
                  typeof w.allocation === "string"
                    ? JSON.parse(w.allocation || "{}")
                    : w.allocation || {};
                const sumAlloc = (key) =>
                  approvedW.reduce(
                    (a, w) => a + parseFloat(allocOf(w)[key] || 0),
                    0,
                  );
                const waiverAmountTotal = sumAlloc("amount_total");
                const waiverInterest = sumAlloc("interest_total");
                const cashToAmountDue = Math.max(
                  0,
                  totalAmountPaid - waiverAmountTotal,
                );
                const interestRatio =
                  totalAmountDue > 0 ? totalInterest / totalAmountDue : 0;
                const interestPaid =
                  cashToAmountDue * interestRatio + waiverInterest;
                const interestOutstanding = Math.max(
                  0,
                  totalInterest - interestPaid,
                );
                const penaltyOutstanding = (schedule || []).reduce(
                  (acc, s) => acc + parseFloat(s.penalty_outstanding || 0),
                  0,
                );
                const cap =
                  waiverForm.type === "interest"
                    ? interestOutstanding
                    : penaltyOutstanding;
                const enteredAmount = parseFloat(waiverForm.amount || 0);
                const pctOfCap =
                  cap > 0 ? Math.min(100, (enteredAmount / cap) * 100) : 0;
                const overCap = enteredAmount > cap + 0.01;
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                          Type *
                        </label>
                        <select
                          value={waiverForm.type}
                          onChange={(e) =>
                            setWaiverForm({
                              ...waiverForm,
                              type: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                        >
                          <option value="penalty">
                            Penalty (late fees + interest on overdue)
                          </option>
                          <option value="interest">
                            Interest (forgive remaining interest)
                          </option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                          Amount (KES) *
                        </label>
                        <input
                          type="number"
                          required
                          min="0.01"
                          step="0.01"
                          max={cap > 0 ? cap.toFixed(2) : undefined}
                          value={waiverForm.amount}
                          onChange={(e) =>
                            setWaiverForm({
                              ...waiverForm,
                              amount: e.target.value,
                            })
                          }
                          placeholder="e.g. 500"
                          className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                            overCap
                              ? "border-rose-300 focus:border-rose-500"
                              : "border-gray-200 focus:border-emerald-500 dark:border-slate-700"
                          }`}
                        />
                        {enteredAmount > 0 && (
                          <div className="mt-1.5">
                            <div
                              className={`text-[11px] mb-1 ${
                                overCap ? "text-rose-700" : "text-gray-600 dark:text-slate-400"
                              }`}
                            >
                              {overCap
                                ? `Exceeds ${formatKES(cap)} ${waiverForm.type} outstanding`
                                : `Waiving ${pctOfCap.toFixed(1)}% of ${formatKES(cap)} ${waiverForm.type} outstanding`}
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden dark:bg-slate-700">
                              <div
                                className={`h-1.5 rounded-full transition-all ${
                                  overCap
                                    ? "bg-rose-500"
                                    : waiverForm.type === "interest"
                                      ? "bg-ocean-500"
                                      : "bg-rose-500"
                                }`}
                                style={{
                                  width: `${pctOfCap}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                  Reason *
                </label>
                <select
                  required
                  value={reasonChoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReasonChoice(v);
                    setWaiverForm({
                      ...waiverForm,
                      reason: v === "other" ? "" : v,
                    });
                  }}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                >
                  <option value="" disabled>
                    Select a reason…
                  </option>
                  {WAIVER_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="other">Other (specify)</option>
                </select>
                {reasonChoice === "other" && (
                  <input
                    type="text"
                    required
                    autoFocus
                    value={waiverForm.reason}
                    onChange={(e) =>
                      setWaiverForm({ ...waiverForm, reason: e.target.value })
                    }
                    placeholder="Enter the reason…"
                    className="mt-2 w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                  Notes (optional)
                </label>
                <textarea
                  rows="2"
                  value={waiverForm.notes}
                  onChange={(e) =>
                    setWaiverForm({ ...waiverForm, notes: e.target.value })
                  }
                  placeholder="Anything internal you'd like to capture…"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full dark:bg-slate-800">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2 dark:text-slate-100">
              <RotateCcw size={20} className="text-rose-700" />
              Reverse waiver?
            </h3>
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
              Restores{" "}
              <strong className="text-rose-700">
                {formatKES(reversingWaiver.amount)}
              </strong>{" "}
              back onto this loan's outstanding balance. The borrower
              will be notified.
            </p>
            <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
              Reason for reversal *
            </label>
            <textarea
              rows="2"
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="e.g. Borrower paid in cash — recorded waiver in error"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-rose-500 focus:outline-none mb-4 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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

      {/* Promise to Pay modal */}
      {showPromiseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full dark:bg-slate-800">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2 dark:text-slate-100">
                  <Handshake size={22} className="text-amber-600" />
                  Log Promise to Pay
                </h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  {loan.loan_code} ·{" "}
                  <span className="font-semibold">
                    {loan.first_name} {loan.last_name}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowPromiseModal(false)}
                disabled={savingPromise}
                className="text-gray-400 hover:text-gray-600 dark:text-slate-400"
              >
                <X size={22} />
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 mb-4 text-sm flex items-start gap-2">
              <Clock size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                Records the borrower's verbal commitment. Shows up in the
                Promises queue until you mark it kept or cancel it. Becomes
                "broken" automatically if the date passes without resolution.
              </span>
            </div>

            {promiseError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-3 text-sm">
                {promiseError}
              </div>
            )}

            <form onSubmit={handleSubmitPromise} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Amount (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={promiseForm.amount}
                    onChange={(e) =>
                      setPromiseForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    placeholder="e.g. 5000"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                    Promised by *
                  </label>
                  <input
                    type="date"
                    required
                    value={promiseForm.promised_date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) =>
                      setPromiseForm((p) => ({
                        ...p,
                        promised_date: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">
                  Notes (optional)
                </label>
                <textarea
                  rows="2"
                  value={promiseForm.notes}
                  onChange={(e) =>
                    setPromiseForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  placeholder="Context for the follow-up officer (e.g. 'will pay after salary on Friday')"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowPromiseModal(false)}
                  disabled={savingPromise}
                  className="px-5 py-2 bg-gray-500 text-white font-semibold rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPromise}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Handshake size={16} />
                  {savingPromise ? "Saving…" : "Log Promise"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoanDetails;
