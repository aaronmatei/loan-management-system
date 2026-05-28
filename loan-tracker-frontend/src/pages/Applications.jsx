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
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";

// Format a date (Date | YYYY-MM-DD string) as "DD/MM/YYYY". Native
// <input type="date"> displays in the browser's locale, which may not
// be dd/mm/yyyy — we use this helper to surface the canonical format
// next to the input and on read-only date displays.
const ddmmyyyy = (value) => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
};

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
    start_date: "", // empty = let backend default to disbursement + 1 month
    start_date_manual: false, // sticks once user touches the Start Date input
  });
  const [submitting, setSubmitting] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterNote, setCounterNote] = useState("");
  const [qualifiedMax, setQualifiedMax] = useState(null);

  // Which application rows are expanded to reveal their full details.
  const [expanded, setExpanded] = useState(() => new Set());

  // Bulk selection across applications shown by the current filter.
  const bulk = useBulkSelection(applications);
  const [bulkRunning, setBulkRunning] = useState(null);

  // Mass-disburse modal: opens with the currently-selected approved
  // loans pre-populated as editable rows (one row per loan).
  const [showBulkDisburseModal, setShowBulkDisburseModal] = useState(false);
  const [bulkDisburseRows, setBulkDisburseRows] = useState([]);
  const toggleExpand = (id) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  useEffect(() => {
    setExpanded(new Set()); // collapse all when the filter changes
    bulk.clear(); // and clear any bulk selection
    fetchData();
    // bulk.clear is stable via useCallback in the hook, safe to skip dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Bulk actions (Mass review / approve / reject) ──
  const runBulk = async (task, body, confirmMsg, label) => {
    const ids = bulk.selectedArray;
    if (ids.length === 0) return;
    if (!window.confirm(confirmMsg(ids.length))) return;
    setBulkRunning(task);
    try {
      const res = await api.post(`/loans/bulk/${task}`, {
        loan_ids: ids,
        ...body,
      });
      const { processed, skipped } = res.data;
      let msg = `${label} done.\n\n${processed} processed`;
      if (skipped) msg += ` · ${skipped} skipped`;
      if (res.data.details?.length) {
        const reasons = res.data.details
          .slice(0, 5)
          .map((d) => `• ${d.loan_code}: ${d.reason}`)
          .join("\n");
        msg += `\n\nSkipped reasons:\n${reasons}`;
        if (res.data.details.length > 5) msg += `\n…and ${res.data.details.length - 5} more`;
      }
      alert(msg);
      bulk.clear();
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setBulkRunning(null);
    }
  };

  const handleBulkReview = () =>
    runBulk(
      "review",
      {},
      (n) => `Move ${n} application${n !== 1 ? "s" : ""} to "under review"?`,
      "Mass review",
    );
  const handleBulkApprove = () =>
    runBulk(
      "approve",
      {},
      (n) => `Approve ${n} application${n !== 1 ? "s" : ""}? Eligibility + capital are re-checked per loan.`,
      "Mass approve",
    );
  const handleBulkReject = () => {
    const reason = window.prompt(
      `Reject ${bulk.count} application${bulk.count !== 1 ? "s" : ""}.\nReason (required):`,
      "",
    );
    if (reason == null) return; // cancelled
    if (!reason.trim()) {
      alert("A rejection reason is required.");
      return;
    }
    return runBulk(
      "reject",
      { reason: reason.trim() },
      () => "Confirm rejection?", // already confirmed by typing a reason
      "Mass reject",
    );
  };

  // Are every selected row in 'approved' status? Only then does the
  // Mass Disburse button become available.
  // Per-action gating — the bulk bar only shows actions that are
  // valid for the current selection. Mass Review needs every row to
  // still be pending; approve/reject accept pending or under_review;
  // disburse needs every row already approved. counter_offered and
  // rejected rows can't be bulk-acted from this bar.
  const selectedStatuses = bulk.selectedArray
    .map((id) => applications.find((x) => x.id === id)?.status)
    .filter(Boolean);
  const everyIs = (...allowed) =>
    bulk.count > 0 &&
    selectedStatuses.length === bulk.count &&
    selectedStatuses.every((s) => allowed.includes(s));
  const canMassReview = everyIs("pending");
  const canMassApprove = everyIs("pending", "under_review");
  const canMassReject = everyIs("pending", "under_review");
  const selectedAllApproved = everyIs("approved");

  const openBulkDisburseModal = () => {
    const today = new Date().toISOString().split("T")[0];
    const rows = bulk.selectedArray
      .map((id) => applications.find((x) => x.id === id))
      .filter((a) => a && a.status === "approved")
      .map((a) => ({
        id: a.id,
        loan_code: a.loan_code,
        first_name: a.first_name,
        last_name: a.last_name,
        amount: parseFloat(
          a.net_disbursed_amount ?? a.principal_amount ?? 0,
        ),
        disbursement_method: "mpesa",
        disbursement_reference: "",
        disbursement_date: today,
        // Empty start_date → backend default (disb + 1 month).
        start_date: "",
      }));
    if (rows.length === 0) {
      alert("Select at least one approved loan to disburse.");
      return;
    }
    setBulkDisburseRows(rows);
    setShowBulkDisburseModal(true);
  };

  const patchBulkRow = (id, patch) =>
    setBulkDisburseRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const handleBulkDisburseSubmit = async (e) => {
    e.preventDefault();
    // Per-row sanity: start_date ≥ disbursement_date when provided.
    for (const r of bulkDisburseRows) {
      if (r.start_date && r.start_date < r.disbursement_date) {
        alert(
          `${r.loan_code}: start date cannot be before the disbursement date.`,
        );
        return;
      }
    }
    if (
      !window.confirm(
        `Disburse ${bulkDisburseRows.length} loan${
          bulkDisburseRows.length !== 1 ? "s" : ""
        }? Capital and eligibility are re-checked per loan.`,
      )
    )
      return;
    setBulkRunning("disburse");
    try {
      const items = bulkDisburseRows.map((r) => ({
        id: r.id,
        disbursement_method: r.disbursement_method,
        disbursement_reference: r.disbursement_reference || null,
        disbursement_date: r.disbursement_date,
        start_date: r.start_date || null,
      }));
      const res = await api.post("/loans/bulk/disburse", { items });
      const { processed, skipped } = res.data;
      let msg = `Mass disburse done.\n\n${processed} processed`;
      if (skipped) msg += ` · ${skipped} skipped`;
      if (res.data.details?.length) {
        const reasons = res.data.details
          .slice(0, 5)
          .map((d) => `• ${d.loan_code || d.id}: ${d.reason}`)
          .join("\n");
        msg += `\n\nSkipped reasons:\n${reasons}`;
        if (res.data.details.length > 5)
          msg += `\n…and ${res.data.details.length - 5} more`;
      }
      alert(msg);
      setShowBulkDisburseModal(false);
      bulk.clear();
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setBulkRunning(null);
    }
  };

  // Compute "disbursement + 1 month" as YYYY-MM-DD, the standard
  // default for the first repayment date.
  const defaultStartFor = (disb) => {
    if (!disb) return "";
    const d = new Date(disb);
    if (Number.isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split("T")[0];
  };

  const handleDisburse = async (e) => {
    e.preventDefault();
    // Date chain: application_date ≤ disbursement_date ≤ start_date.
    const appYmd = selectedLoan?.application_date
      ? new Date(selectedLoan.application_date).toISOString().split("T")[0]
      : null;
    if (appYmd && disburseData.disbursement_date < appYmd) {
      alert(
        `Disbursement date (${ddmmyyyy(
          disburseData.disbursement_date,
        )}) cannot be before the loan creation date (${ddmmyyyy(appYmd)}).`,
      );
      return;
    }
    const effectiveStart =
      disburseData.start_date_manual && disburseData.start_date
        ? disburseData.start_date
        : defaultStartFor(disburseData.disbursement_date);
    if (effectiveStart < disburseData.disbursement_date) {
      alert(
        "Start date cannot be before the disbursement date.",
      );
      return;
    }
    if (
      !window.confirm(
        `Confirm disbursement of KES ${parseFloat(
          selectedLoan.net_disbursed_amount ?? selectedLoan.principal_amount,
        ).toLocaleString()} to ${selectedLoan.first_name}?`,
      )
    )
      return;
    setSubmitting(true);
    try {
      const payload = {
        disbursement_method: disburseData.disbursement_method,
        disbursement_reference: disburseData.disbursement_reference,
        disbursement_date: disburseData.disbursement_date,
        start_date: effectiveStart,
      };
      await api.post(`/loans/${selectedLoan.id}/disburse`, payload);
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

  // Contextual action buttons for an application (status-dependent). Reused by
  // the desktop table rows and the mobile cards.
  const actBtn =
    "px-2.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1 whitespace-nowrap";
  const renderActions = (app) => (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {app.status === "pending" && (
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => handleStartReview(app)}
            className={`${actBtn} bg-blue-600 hover:bg-blue-700 text-white`}
          >
            <Search size={14} /> Review
          </button>
        </PermissionGate>
      )}
      {app.status === "under_review" && (
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => handleApprove(app)}
            className={`${actBtn} bg-green-600 hover:bg-green-700 text-white`}
          >
            <CheckCircle size={14} /> Approve
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
            className={`${actBtn} bg-red-600 hover:bg-red-700 text-white`}
          >
            <X size={14} /> Reject
          </button>
          <button
            onClick={() => openCounterOffer(app)}
            className={`${actBtn} bg-amber-500 hover:bg-amber-600 text-white`}
          >
            <Banknote size={14} /> Counter
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
            className={`${actBtn} bg-ocean-600 hover:bg-ocean-700 text-white`}
          >
            <Coins size={14} /> Disburse
          </button>
        </PermissionGate>
      )}
      <button
        onClick={() => navigate(`/loans/${app.id}`)}
        className={`${actBtn} bg-gray-100 hover:bg-gray-200 text-gray-700`}
      >
        <Eye size={14} /> View
      </button>
    </div>
  );

  // Full detail panel for an expanded application (the financials, fee, purpose
  // and processing meta). Reused by the desktop expanded row and mobile cards.
  const renderDetails = (app) => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-gray-500">Principal</p>
          <p className="font-bold text-lg">
            KES {parseFloat(app.principal_amount).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total Due</p>
          <p className="font-bold">
            KES {parseFloat(app.total_amount_due).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Duration</p>
          <p className="font-bold">{app.loan_duration_months} months</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Interest Rate</p>
          <p className="font-bold">
            {(parseFloat(app.interest_rate) * 12).toFixed(2)}% p.a.
          </p>
        </div>
      </div>

      {/* Counter-offer — requested vs offered (+ note) */}
      {app.offered_amount != null && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-gray-500">Requested</p>
            <p className="font-bold text-gray-700">
              KES{" "}
              {parseFloat(
                app.requested_amount ?? app.principal_amount,
              ).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Counter-offer</p>
            <p className="font-bold text-amber-700">
              KES {parseFloat(app.offered_amount).toLocaleString()}
            </p>
          </div>
          {app.counter_offer_note && (
            <div className="w-full">
              <p className="text-xs text-gray-500">Note</p>
              <p className="text-sm text-gray-700">{app.counter_offer_note}</p>
            </div>
          )}
        </div>
      )}

      {/* Processing fee + net amount to disburse */}
      {(app.status === "approved" ||
        parseFloat(app.processing_fee || 0) > 0) && (
        <div className="bg-ocean-50 border border-ocean-100 rounded-lg p-3 flex flex-wrap gap-x-8 gap-y-2">
          {parseFloat(app.processing_fee || 0) > 0 && (
            <div>
              <p className="text-xs text-gray-500">
                Processing Fee ({parseFloat(app.processing_fee_rate)}%)
              </p>
              <p className="font-bold text-amber-700">
                − KES {parseFloat(app.processing_fee).toLocaleString()}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500">To Disburse</p>
            <p className="font-bold text-ocean-700">
              KES{" "}
              {parseFloat(
                app.net_disbursed_amount ?? app.principal_amount,
              ).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {app.purpose && (
        <div>
          <p className="text-xs text-gray-500">Purpose:</p>
          <p className="text-sm text-gray-700">{app.purpose}</p>
        </div>
      )}

      {app.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-700">Rejection Reason:</p>
          <p className="text-sm text-red-600">{app.rejection_reason}</p>
        </div>
      )}

      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span className="inline-flex items-center gap-1">
          <Calendar size={12} /> Applied:{" "}
          {app.application_date
            ? new Date(app.application_date).toLocaleDateString()
            : "—"}
        </span>
        {app.created_by_name && (
          <span className="inline-flex items-center gap-1">
            <User size={12} /> By: {app.created_by_name}
          </span>
        )}
        {app.reviewed_by_name && (
          <span className="inline-flex items-center gap-1">
            <Search size={12} /> Reviewed: {app.reviewed_by_name}
          </span>
        )}
        {app.approved_by_name && (
          <span className="inline-flex items-center gap-1">
            <CheckCircle size={12} /> Approved: {app.approved_by_name}
          </span>
        )}
      </div>
    </div>
  );

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
      {applications.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-500">
          No applications found
        </div>
      ) : (
        <>
          {/* Desktop table — one row per application, expand for full details */}
          <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden">
            <div className="overflow-auto max-h-[calc(100vh-340px)]">
              <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={bulk.allOnPageSelected}
                        onChange={bulk.togglePage}
                        className="w-4 h-4 cursor-pointer"
                        aria-label="Select all on page"
                      />
                    </th>
                    <th className="px-3 py-3 w-10"></th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                      Loan Code
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                      Client
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                      Principal
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((app) => {
                    const open = expanded.has(app.id);
                    const badge = getStatusBadge(app.status);
                    return (
                      <React.Fragment key={app.id}>
                        <tr
                          className={`border-b border-gray-100 hover:bg-gray-50 transition ${
                            bulk.isSelected(app.id) ? "bg-ocean-50" : open ? "bg-gray-50" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={bulk.isSelected(app.id)}
                              onChange={() => bulk.toggle(app.id)}
                              className="w-4 h-4 cursor-pointer"
                              aria-label="Select application"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <button
                              onClick={() => toggleExpand(app.id)}
                              className="text-gray-400 hover:text-gray-700"
                              aria-label={open ? "Collapse" : "Expand"}
                            >
                              {open ? (
                                <ChevronDown size={18} />
                              ) : (
                                <ChevronRight size={18} />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => toggleExpand(app.id)}
                              className="font-mono text-sm font-bold text-ocean-600 hover:underline"
                            >
                              {app.loan_code}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-gray-800 text-sm">
                              {app.first_name} {app.last_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {app.phone_number} • {app.client_code}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-gray-800 text-sm">
                            KES{" "}
                            {parseFloat(app.principal_amount).toLocaleString()}
                            {app.status === "counter_offered" &&
                              app.offered_amount != null && (
                                <p className="text-xs font-semibold text-amber-700">
                                  → KES{" "}
                                  {parseFloat(
                                    app.offered_amount,
                                  ).toLocaleString()}
                                </p>
                              )}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-700">
                            {app.loan_duration_months} mo
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}
                            >
                              {badge.icon}{" "}
                              {app.status.replace("_", " ").toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3">{renderActions(app)}</td>
                        </tr>
                        {open && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={8} className="px-6 pb-4 pt-1">
                              {renderDetails(app)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards — collapsed summary, expand for details + actions */}
          <div className="md:hidden space-y-3">
            {applications.map((app) => {
              const open = expanded.has(app.id);
              const badge = getStatusBadge(app.status);
              return (
                <div
                  key={app.id}
                  className={`bg-white rounded-xl shadow-md p-4 ${
                    bulk.isSelected(app.id) ? "ring-2 ring-ocean-400" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <input
                      type="checkbox"
                      checked={bulk.isSelected(app.id)}
                      onChange={() => bulk.toggle(app.id)}
                      className="w-5 h-5 mt-1 cursor-pointer flex-shrink-0"
                      aria-label="Select application"
                    />
                    <button
                      onClick={() => toggleExpand(app.id)}
                      className="flex items-start gap-2 text-left flex-1 min-w-0"
                    >
                      <span className="text-gray-400 mt-0.5">
                        {open ? (
                          <ChevronDown size={18} />
                        ) : (
                          <ChevronRight size={18} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-ocean-600 text-xs font-bold">
                          {app.loan_code}
                        </p>
                        <p className="font-semibold text-gray-800 truncate">
                          {app.first_name} {app.last_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {app.phone_number}
                        </p>
                      </div>
                    </button>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${badge.color}`}
                    >
                      {badge.icon} {app.status.replace("_", " ").toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-3 pt-3 border-t border-gray-100">
                    <span className="text-gray-500">Principal</span>
                    <span className="font-bold">
                      KES {parseFloat(app.principal_amount).toLocaleString()}
                    </span>
                  </div>
                  {open && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                      {renderDetails(app)}
                      {renderActions(app)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <BulkActionBar
        selectedCount={bulk.count}
        totalCount={applications.length}
        onClear={bulk.clear}
      >
        <PermissionGate role={["admin", "manager"]}>
          {canMassReview && (
            <button
              onClick={handleBulkReview}
              disabled={bulkRunning === "review"}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold disabled:opacity-50"
              title="Move selected pending applications to under_review"
            >
              <Search size={15} />
              {bulkRunning === "review" ? "Reviewing…" : "Mass Review"}
            </button>
          )}
          {canMassApprove && (
            <button
              onClick={handleBulkApprove}
              disabled={bulkRunning === "approve"}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-semibold disabled:opacity-50"
              title="Approve selected pending / under_review applications"
            >
              <CheckCircle size={15} />
              {bulkRunning === "approve" ? "Approving…" : "Mass Approve"}
            </button>
          )}
          {canMassReject && (
            <button
              onClick={handleBulkReject}
              disabled={bulkRunning === "reject"}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-semibold disabled:opacity-50"
              title="Reject selected pending / under_review applications"
            >
              <X size={15} />
              {bulkRunning === "reject" ? "Rejecting…" : "Mass Reject"}
            </button>
          )}
          {selectedAllApproved && (
            <button
              onClick={openBulkDisburseModal}
              disabled={bulkRunning === "disburse"}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-ocean-600 hover:bg-ocean-700 rounded-lg text-sm font-semibold disabled:opacity-50"
              title="Disburse all selected approved loans with per-loan details"
            >
              <Coins size={15} />
              {bulkRunning === "disburse" ? "Disbursing…" : "Mass Disburse"}
            </button>
          )}
        </PermissionGate>
      </BulkActionBar>

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
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-900 space-y-1">
              <div className="flex justify-between">
                <span>Principal</span>
                <span className="font-semibold">
                  KES {parseFloat(selectedLoan.principal_amount).toLocaleString()}
                </span>
              </div>
              {parseFloat(selectedLoan.processing_fee || 0) > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>
                    Processing Fee ({parseFloat(selectedLoan.processing_fee_rate)}%)
                  </span>
                  <span className="font-semibold">
                    − KES{" "}
                    {parseFloat(selectedLoan.processing_fee).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-green-200 pt-1">
                <span className="font-bold">Amount to Disburse</span>
                <span className="font-bold">
                  KES{" "}
                  {parseFloat(
                    selectedLoan.net_disbursed_amount ??
                      selectedLoan.principal_amount,
                  ).toLocaleString()}
                </span>
              </div>
              <div className="pt-1">
                <strong>Client:</strong> {selectedLoan.first_name}{" "}
                {selectedLoan.last_name}
                <br />
                <strong>Phone:</strong> {selectedLoan.phone_number}
                <br />
                <strong>Applied on:</strong>{" "}
                {ddmmyyyy(
                  selectedLoan.application_date || selectedLoan.created_at,
                )}
              </div>
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
                      setDisburseData((p) => ({
                        ...p,
                        disbursement_date: e.target.value,
                        // Slide start_date along the default unless the user
                        // has manually overridden it.
                        start_date: p.start_date_manual
                          ? p.start_date
                          : defaultStartFor(e.target.value),
                      }))
                    }
                    required
                    min={
                      selectedLoan?.application_date
                        ? new Date(selectedLoan.application_date)
                            .toISOString()
                            .split("T")[0]
                        : undefined
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    = {ddmmyyyy(disburseData.disbursement_date)}
                    {selectedLoan?.application_date && (
                      <>
                        {" "}· must be on or after the loan creation date (
                        {ddmmyyyy(selectedLoan.application_date)})
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    First Repayment Date
                  </label>
                  <input
                    type="date"
                    value={
                      disburseData.start_date ||
                      defaultStartFor(disburseData.disbursement_date)
                    }
                    onChange={(e) =>
                      setDisburseData((p) => ({
                        ...p,
                        start_date: e.target.value,
                        start_date_manual: true,
                      }))
                    }
                    min={disburseData.disbursement_date}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Default: 1 month after disbursement.{" "}
                    {disburseData.start_date_manual && (
                      <button
                        type="button"
                        onClick={() =>
                          setDisburseData((p) => ({
                            ...p,
                            start_date: defaultStartFor(p.disbursement_date),
                            start_date_manual: false,
                          }))
                        }
                        className="text-ocean-600 hover:text-ocean-800 underline"
                      >
                        reset
                      </button>
                    )}
                  </p>
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

      {/* Mass Disburse modal — one editable row per selected approved loan */}
      {showBulkDisburseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-5 lg:p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Coins size={20} className="text-ocean-600" />
                  Mass Disburse
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {bulkDisburseRows.length} approved loan
                  {bulkDisburseRows.length !== 1 ? "s" : ""} — set per-loan
                  method, reference and dates, then disburse.
                </p>
              </div>
              <button
                onClick={() => setShowBulkDisburseModal(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <form
              onSubmit={handleBulkDisburseSubmit}
              className="flex-1 overflow-y-auto p-5 lg:p-6"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase border-b">
                    <tr>
                      <th className="text-left py-2 pr-3">Loan</th>
                      <th className="text-right py-2 pr-3">Amount</th>
                      <th className="text-left py-2 pr-3">Method</th>
                      <th className="text-left py-2 pr-3">Reference</th>
                      <th className="text-left py-2 pr-3">Disb. date</th>
                      <th className="text-left py-2">Start date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkDisburseRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b last:border-b-0 align-top"
                      >
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-gray-900">
                            {r.loan_code}
                          </div>
                          <div className="text-xs text-gray-500">
                            {r.first_name} {r.last_name}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                          KES {r.amount.toLocaleString()}
                        </td>
                        <td className="py-3 pr-3">
                          <select
                            value={r.disbursement_method}
                            onChange={(e) =>
                              patchBulkRow(r.id, {
                                disbursement_method: e.target.value,
                              })
                            }
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                          >
                            <option value="mpesa">M-Pesa</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="cash">Cash</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </td>
                        <td className="py-3 pr-3">
                          <input
                            type="text"
                            value={r.disbursement_reference}
                            onChange={(e) =>
                              patchBulkRow(r.id, {
                                disbursement_reference: e.target.value,
                              })
                            }
                            placeholder="optional"
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm w-36"
                          />
                        </td>
                        <td className="py-3 pr-3">
                          <input
                            type="date"
                            value={r.disbursement_date}
                            onChange={(e) =>
                              patchBulkRow(r.id, {
                                disbursement_date: e.target.value,
                              })
                            }
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          />
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {ddmmyyyy(r.disbursement_date)}
                          </div>
                        </td>
                        <td className="py-3">
                          <input
                            type="date"
                            value={r.start_date}
                            onChange={(e) =>
                              patchBulkRow(r.id, {
                                start_date: e.target.value,
                              })
                            }
                            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                          />
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {r.start_date
                              ? ddmmyyyy(r.start_date)
                              : "default: disb + 1 month"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-5 mt-5 border-t">
                <button
                  type="button"
                  onClick={() => setShowBulkDisburseModal(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkRunning === "disburse"}
                  className="px-6 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Coins size={16} />
                  {bulkRunning === "disburse"
                    ? "Disbursing…"
                    : `Disburse ${bulkDisburseRows.length} loan${
                        bulkDisburseRows.length !== 1 ? "s" : ""
                      }`}
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
