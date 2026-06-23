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
  CheckCircle,
  Plus,
  RotateCcw,
  Car,
  Banknote,
  Users,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  SlidersHorizontal,
  Bookmark,
  Trash2,
} from "lucide-react";
import api from "../services/api";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import PermissionGate from "../components/PermissionGate";
import { bulkExport } from "../utils/bulkExport";
import { useSortableTable } from "../hooks/useSortableTable";
import SortableHeader from "../components/SortableHeader";
import { computeLoanTotals } from "../utils/loanMath";
import { evaluatePackageEligibility } from "../utils/packageEligibility";
import { purposesForPackage } from "../utils/loanPurposes";
import Skeleton from "../components/Skeleton";
import { formatKES, exactKES } from "../utils/money";

// ── Loans table column model (UX pilot) ──────────────────────────────
// The desktop loans table is column-driven so we can offer client-side
// presets (which columns show in the row) and push the rest into an
// expandable detail row — without forking the rendering logic. Loan Code
// is pinned (sticky) and rendered specially in the row, so it is NOT part
// of this generic list. `money` columns also contribute to the totals row.
const num = (v) => parseFloat(v || 0);

const LOAN_COLUMNS = [
  {
    key: "first_name",
    label: "Client",
    align: "left",
    cell: (l) => (
      <div>
        <p className="font-semibold text-gray-800 text-sm">
          {l.first_name} {l.last_name}
        </p>
        <p className="text-xs text-gray-500">{l.phone_number}</p>
      </div>
    ),
  },
  {
    key: "disbursed_at",
    label: "Disbursed",
    align: "left",
    cell: (l) => (
      <span className="text-sm text-gray-700">
        {l.disbursed_at
          ? new Date(l.disbursed_at).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : "—"}
      </span>
    ),
  },
  {
    key: "principal_amount",
    label: "Principal",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.principal_amount), 0),
    totalClass: "text-gray-800",
    cell: (l) => (
      <p className="font-semibold text-gray-800 text-sm">
        {formatKES(l.principal_amount)}
      </p>
    ),
  },
  {
    key: "total_interest",
    label: "Interest",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.total_interest), 0),
    totalClass: "text-money-pos",
    cell: (l) => (
      <p className="font-semibold text-money-pos text-sm">
        {formatKES(l.total_interest || 0)}
      </p>
    ),
  },
  {
    key: "total_amount_due",
    label: "Total to Pay",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.total_amount_due), 0),
    totalClass: "text-ocean-700",
    cell: (l) => (
      <p className="font-bold text-ocean-600 text-sm">
        {formatKES(l.total_amount_due)}
      </p>
    ),
  },
  {
    key: "total_paid",
    label: "Paid",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.total_paid), 0),
    totalClass: "text-money-pos",
    cell: (l) => (
      <p className="font-bold text-money-pos text-sm">
        {formatKES(l.total_paid || 0)}
      </p>
    ),
  },
  {
    key: "total_fines_paid",
    label: "Fines",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.total_fines_paid), 0),
    totalClass: "text-fuchsia-700",
    cell: (l) =>
      num(l.total_fines_paid) > 0 ? (
        <p className="font-semibold text-fuchsia-700 text-sm">
          {formatKES(l.total_fines_paid)}
        </p>
      ) : (
        <p className="text-money-muted text-sm">—</p>
      ),
  },
  {
    key: "total_waived",
    label: "Waivers",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.total_waived), 0),
    totalClass: "text-money-neg",
    cell: (l) =>
      num(l.total_waived) > 0 ? (
        <p className="font-semibold text-money-neg text-sm">
          {formatKES(l.total_waived)}
        </p>
      ) : (
        <p className="text-money-muted text-sm">—</p>
      ),
  },
  {
    key: "balance",
    label: "Balance",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.balance_due), 0),
    totalClass: "text-money-warn",
    cell: (l) => {
      const b = num(l.balance_due);
      return (
        <p
          className={`font-bold text-sm ${b > 0 ? "text-money-warn" : "text-money-pos"}`}
        >
          {formatKES(b)}
        </p>
      );
    },
  },
  {
    key: "overpayment_amount",
    label: "Refund Due",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.overpayment_amount), 0),
    totalClass: "text-ocean-700",
    cell: (l) => {
      const o = num(l.overpayment_amount);
      if (o <= 0) return <p className="text-money-muted text-sm">-</p>;
      return (
        <div>
          <p className="font-bold text-ocean-600 text-sm">{formatKES(o)}</p>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mt-1 ${
              l.refund_status === "refunded"
                ? "bg-green-100 text-green-700"
                : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {l.refund_status === "refunded" ? (
              <span className="inline-flex items-center gap-1">
                <Check size={12} /> Refunded
              </span>
            ) : (
              "Pending"
            )}
          </span>
        </div>
      );
    },
  },
  {
    key: "status",
    label: "Status",
    align: "left",
    cell: (l) => (
      <div className="flex flex-col gap-1 items-start">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold text-center ${
            l.status === "active"
              ? "bg-green-100 text-green-700"
              : l.status === "completed"
                ? "bg-ocean-100 text-ocean-700"
                : l.status === "defaulted"
                  ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-700"
          }`}
        >
          {l.status}
        </span>
        {(l.overdue_count || 0) > 0 && (
          <span
            className="inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700"
            title={`${l.overdue_count} overdue installment${l.overdue_count !== 1 ? "s" : ""} · ${exactKES(l.overdue_amount)} (max ${l.max_days_late}d late)`}
          >
            <AlertTriangle size={10} />
            {l.overdue_count} overdue
          </span>
        )}
      </div>
    ),
  },
];

// Column presets — which keys render in the row. Loan Code is always
// pinned and shown outside this set. Anything not visible drops into the
// expandable detail row, so no data is ever hidden — just demoted.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["first_name", "principal_amount", "balance", "status"],
  },
  financials: {
    label: "Financials",
    keys: [
      "first_name",
      "principal_amount",
      "total_interest",
      "total_amount_due",
      "total_paid",
      "balance",
      "status",
    ],
  },
  full: {
    label: "Everything",
    keys: LOAN_COLUMNS.map((c) => c.key),
  },
};

const PRESET_STORAGE_KEY = "loans.columnPreset";
const SEGMENTS_STORAGE_KEY = "loans.segments";

// Skeleton placeholder for the desktop loans table while the first page
// of data loads. Mirrors the real row rhythm so nothing jumps.
function LoansTableSkeleton({ rows = 8 }) {
  return (
    <div
      className="hidden md:block bg-white rounded-xl shadow-card overflow-hidden"
      aria-busy="true"
    >
      <div className="px-4 py-4 border-b border-gray-100 flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-4 border-b border-gray-50 flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Loans() {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duesPrompt, setDuesPrompt] = useState(null); // {error, dues:{defaulted,overdue}} when a client has dues/defaults
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

  // ── Table UX state (pilot, client-side only) ──────────────────
  // Expanded rows reveal columns demoted by the active preset.
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleRow = (id) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Column preset — persisted in localStorage, never server-side.
  const [columnPreset, setColumnPreset] = useState(() => {
    const saved = localStorage.getItem(PRESET_STORAGE_KEY);
    return saved && COLUMN_PRESETS[saved] ? saved : "financials";
  });
  useEffect(() => {
    localStorage.setItem(PRESET_STORAGE_KEY, columnPreset);
  }, [columnPreset]);

  // Saved filter "segments" — named snapshots of search + filters, stored
  // in localStorage only. Purely a UI convenience; no backend involvement.
  const [segments, setSegments] = useState(() => {
    try {
      const raw = localStorage.getItem(SEGMENTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(SEGMENTS_STORAGE_KEY, JSON.stringify(segments));
  }, [segments]);

  const visibleColumnKeys = COLUMN_PRESETS[columnPreset].keys;
  const visibleColumns = LOAN_COLUMNS.filter((c) =>
    visibleColumnKeys.includes(c.key),
  );
  const hiddenColumns = LOAN_COLUMNS.filter(
    (c) => !visibleColumnKeys.includes(c.key),
  );

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
    package_id: "",
    interest_method: "flat",
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
    penalty_rate_enabled: false,
    penalty_rate: 0,
  });

  const [packages, setPackages] = useState([]);

  // Logbook loans capture a vehicle (kept separate from formData so the big
  // form's reset/package-lock logic stays untouched). POSTed after the loan is
  // created, when the selected package's type is 'logbook'.
  const blankVehicle = {
    make: "",
    model: "",
    year: "",
    registration_number: "",
    logbook_number: "",
    chassis_number: "",
    engine_number: "",
    color: "",
    valuation: "",
    storage_location: "",
  };
  const [vehicleForm, setVehicleForm] = useState(blankVehicle);
  const setVeh = (k) => (e) =>
    setVehicleForm((v) => ({ ...v, [k]: e.target.value }));

  // Salary advances capture employer + check-off details (same two-step,
  // separate-state approach as the vehicle block above).
  const blankSalary = {
    employer_name: "",
    employer_contact: "",
    staff_number: "",
    net_monthly_pay: "",
    payday_day: "",
    max_deduction_percent: 50,
  };
  const [salaryForm, setSalaryForm] = useState(blankSalary);
  const setSal = (k) => (e) =>
    setSalaryForm((s) => ({ ...s, [k]: e.target.value }));

  // "Loan against collateral" — an opt-in pledge captured on the new-loan form.
  // When on, the loan is created as loan_type='pawn' and the item is stored as
  // structured collateral (so it shares the redeem / forfeit / auction
  // lifecycle). Photos reuse the existing pawn upload endpoint.
  const [againstCollateral, setAgainstCollateral] = useState(false);
  const blankCollateral = {
    category: "",
    description: "",
    serial_number: "",
    condition: "",
    appraised_value: "",
    ltv_percent: "50",
    storage_location: "",
    photos: [],
  };
  const [collateralForm, setCollateralForm] = useState(blankCollateral);
  const setCol = (k) => (e) =>
    setCollateralForm((c) => ({ ...c, [k]: e.target.value }));
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const uploadCollateralPhotos = async (files) => {
    if (!files?.length) return;
    setUploadingPhotos(true);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 6).forEach((f) => fd.append("photos", f));
      const r = await api.post("/pawn/photos", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setCollateralForm((c) => ({
        ...c,
        photos: [...c.photos, ...(r.data.urls || [])].slice(0, 6),
      }));
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't upload photos.");
    } finally {
      setUploadingPhotos(false);
    }
  };

  // Group loans: pick which group the member loan belongs to. The borrower
  // (selected client) must be an active member — the backend enforces this.
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState("");
  // Open lending cycles for the chosen group (optional on a group loan).
  const [groupCycles, setGroupCycles] = useState([]);
  const [cycleId, setCycleId] = useState("");

  useEffect(() => {
    if (!groupId) {
      setGroupCycles([]);
      setCycleId("");
      return;
    }
    (async () => {
      try {
        const r = await api.get(`/groups/${groupId}/cycles`);
        setGroupCycles((r.data.data || []).filter((c) => c.status === "open"));
      } catch {
        setGroupCycles([]);
      }
    })();
  }, [groupId]);

  useEffect(() => {
    fetchLoans();
    fetchClients();
    fetchPoolStatus();
    fetchLoanPolicy();
    fetchPackages();
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const r = await api.get("/groups");
      setGroups((r.data.data || []).filter((g) => g.status === "active"));
    } catch {
      // non-fatal — group section just won't list groups
    }
  };

  // Active packages only — archived ones still resolve on historical
  // loans via the FK, but can't be picked for new applications.
  const fetchPackages = async () => {
    try {
      const r = await api.get("/packages");
      setPackages((r.data.data || []).filter((p) => p.active));
    } catch {
      // non-fatal — form falls back to free-form custom loan
    }
  };

  // Derived: the currently-selected package object (or null when the
  // staff picked "Custom"). Drives the field-lock and range hints.
  const selectedPackage =
    packages.find((p) => String(p.id) === String(formData.package_id)) || null;

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

  // Live calculation — defers to the shared loanMath helper so flat
  // and reducing-balance previews stay identical to what the backend
  // actually books at create time.
  const calculateLoanDetails = () => {
    const principal = parseFloat(formData.principal_amount) || 0;
    const annualRate = parseFloat(formData.annual_interest_rate) || 0;
    const months = parseInt(formData.loan_duration_months) || 0;
    const monthlyRate = annualRate / 12;

    const { totalInterest, totalAmountDue, monthlyPayment } =
      computeLoanTotals({
        principal,
        annualRatePct: annualRate,
        months,
        method: formData.interest_method,
      });

    // Processing fee snapshot — mirrors what the backend will store on the
    // loan: principal × the form's processing_fee_rate% (defaults to the
    // tenant policy on load, but the staff can override per loan).
    const feeRate = parseFloat(formData.processing_fee_rate) || 0;
    const processingFee = Math.round(principal * feeRate) / 100;
    const netDisbursed = Math.max(0, principal - processingFee);

    return {
      monthlyRate: monthlyRate.toFixed(2),
      totalInterest: totalInterest.toFixed(2),
      totalAmount: totalAmountDue.toFixed(2),
      monthlyPayment: monthlyPayment.toFixed(2),
      feeRate,
      processingFee,
      netDisbursed,
    };
  };

  const handleSubmit = async (e, acknowledgeDues = false) => {
    if (e?.preventDefault) e.preventDefault();

    if (!formData.client_id) {
      setError("Please select a client");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      // Late fee + penalty rate only count when their toggles are on.
      // If a toggle's off we send 0 so the backend doesn't pick up
      // a stale value the user never opted into.
      if (againstCollateral) {
        if (!collateralForm.description.trim()) {
          setError("Describe the collateral item being pledged");
          setSubmitting(false);
          return;
        }
        if (!(parseFloat(collateralForm.appraised_value) > 0)) {
          setError("The collateral's appraised value must be greater than 0");
          setSubmitting(false);
          return;
        }
      }
      const submitData = {
        ...formData,
        // Lender confirmed they want to lend despite the client's dues/defaults.
        acknowledge_dues: acknowledgeDues,
        late_payment_fee: formData.late_fee_enabled
          ? parseFloat(formData.late_payment_fee) || 0
          : 0,
        penalty_rate: formData.penalty_rate_enabled
          ? parseFloat(formData.penalty_rate) || 0
          : 0,
        ...(selectedPackage?.loan_type === "group" && groupId
          ? { group_id: groupId, ...(cycleId ? { cycle_id: cycleId } : {}) }
          : {}),
        // Loan against collateral: tag the type and ship the pledged item.
        ...(againstCollateral
          ? {
              loan_type: "pawn",
              collateral: {
                ...collateralForm,
                appraised_value: parseFloat(collateralForm.appraised_value),
                ltv_percent: parseFloat(collateralForm.ltv_percent) || 50,
              },
            }
          : {}),
      };
      const response = await api.post("/loans", submitData);

      // Logbook loans: attach the pledged vehicle to the new loan. Best-effort
      // — if it fails, the loan still exists and the vehicle can be added later
      // from the loan detail page, so we surface a note rather than hard-fail.
      let vehicleNote = "";
      if (
        selectedPackage?.loan_type === "logbook" &&
        vehicleForm.registration_number.trim() &&
        parseFloat(vehicleForm.valuation) > 0
      ) {
        try {
          await api.post(`/loans/${response.data.data.id}/vehicle-security`, {
            ...vehicleForm,
            year: vehicleForm.year ? parseInt(vehicleForm.year, 10) : null,
            valuation: parseFloat(vehicleForm.valuation),
          });
        } catch {
          vehicleNote = " (couldn't save the vehicle — add it from the loan page)";
        }
      }
      setVehicleForm(blankVehicle);

      // Salary advances: attach employer / check-off details (same best-effort).
      if (
        selectedPackage?.loan_type === "salary" &&
        salaryForm.employer_name.trim() &&
        parseFloat(salaryForm.net_monthly_pay) > 0
      ) {
        try {
          await api.post(`/loans/${response.data.data.id}/salary-details`, {
            ...salaryForm,
            net_monthly_pay: parseFloat(salaryForm.net_monthly_pay),
            payday_day: salaryForm.payday_day
              ? parseInt(salaryForm.payday_day, 10)
              : null,
            max_deduction_percent: parseFloat(salaryForm.max_deduction_percent) || 50,
          });
        } catch {
          vehicleNote += " (couldn't save salary details — add them from the loan page)";
        }
      }
      setSalaryForm(blankSalary);
      setAgainstCollateral(false);
      setCollateralForm(blankCollateral);
      setGroupId("");
      setCycleId("");

      setSuccess(
        `Application ${response.data.data.loan_code} submitted! A manager will review it shortly.${vehicleNote}`,
      );

      // Reset form — defaults come from the tenant's configured loan policy.
      setFormData({
        client_id: "",
        package_id: "",
        interest_method: "flat",
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
        penalty_rate_enabled: false,
        penalty_rate: 0,
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
      // Dues/defaults are a soft warning — show Cancel/Proceed instead of a hard error.
      if (err.response?.status === 409 && err.response.data?.requires_confirmation) {
        setDuesPrompt(err.response.data);
      } else {
        setError(err.response?.data?.error || "Failed to submit application");
      }
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

  // ── Saved filter segments (localStorage only) ─────────────────
  const saveSegment = () => {
    const name = window.prompt("Name this segment (e.g. Overdue actives)");
    if (!name || !name.trim()) return;
    const segment = {
      id: `${name.trim()}-${Date.now()}`,
      name: name.trim(),
      searchQuery,
      filters: { ...filters },
    };
    // Replace any existing segment with the same name, else append.
    setSegments((prev) => [
      ...prev.filter((s) => s.name !== segment.name),
      segment,
    ]);
  };
  const applySegment = (segment) => {
    setSearchQuery(segment.searchQuery || "");
    setFilters({
      status: "all",
      refundStatus: "all",
      overdue: "all",
      disbursedFrom: "",
      disbursedTo: "",
      ...segment.filters,
    });
    setCurrentPage(1);
  };
  const deleteSegment = (id) =>
    setSegments((prev) => prev.filter((s) => s.id !== id));

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

  // Mass refund: visible only when every selected loan has a pending
  // refund (refund_status='pending' AND overpayment_amount > 0).
  const selectedAllPendingRefund =
    bulk.count > 0 &&
    bulk.selectedArray.every((id) => {
      const l = loans.find((x) => x.id === id);
      return (
        l &&
        l.refund_status === "pending" &&
        parseFloat(l.overpayment_amount || 0) > 0
      );
    });

  const [showBulkRefundModal, setShowBulkRefundModal] = useState(false);
  const [bulkRefundData, setBulkRefundData] = useState({
    refund_method: "M-Pesa",
    refund_reference: "",
    refunded_date: new Date().toISOString().split("T")[0],
  });
  const [bulkRefundBusy, setBulkRefundBusy] = useState(false);

  const handleBulkRefund = async (e) => {
    e.preventDefault();
    if (!bulkRefundData.refund_method || !bulkRefundData.refunded_date) {
      alert("Method and date are required.");
      return;
    }
    const total = bulk.selectedArray.reduce((sum, id) => {
      const l = loans.find((x) => x.id === id);
      return sum + parseFloat(l?.overpayment_amount || 0);
    }, 0);
    if (
      !window.confirm(
        `Mark ${bulk.count} refund${bulk.count !== 1 ? "s" : ""} as paid (total KES ${total.toLocaleString()})?`,
      )
    )
      return;
    setBulkRefundBusy(true);
    try {
      const res = await api.post("/payments/bulk/refund", {
        loan_ids: bulk.selectedArray,
        ...bulkRefundData,
      });
      const { processed, skipped, details } = res.data;
      let msg = `Mass refund done.\n\n${processed} processed`;
      if (skipped) msg += ` · ${skipped} skipped`;
      if (details?.length) {
        const reasons = details
          .slice(0, 5)
          .map((d) => `• ${d.loan_code || d.id}: ${d.reason}`)
          .join("\n");
        msg += `\n\nSkipped reasons:\n${reasons}`;
        if (details.length > 5) msg += `\n…and ${details.length - 5} more`;
      }
      alert(msg);
      setShowBulkRefundModal(false);
      bulk.clear();
      fetchLoans();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setBulkRefundBusy(false);
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
            <span className="inline-flex items-center gap-1"><Plus size={16}/> New Loan</span>
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
            <div className="bg-ocean-50 border border-ocean-200 rounded-lg p-4 mb-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-ocean-900 flex items-center gap-1">
                    <Coins size={16} className="text-ocean-700"/> Available Pool Balance
                  </p>
                  <p className="text-xs text-ocean-700 mt-1">
                    Maximum amount you can lend
                  </p>
                </div>
                <p className="text-2xl font-bold text-ocean-700">
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
                  !clientCreditProfile.eligibility.can_borrow
                    ? "bg-red-50 border border-red-200"
                    : clientCreditProfile.eligibility.warnings?.length
                      ? "bg-amber-50 border border-amber-200"
                      : "bg-green-50 border border-green-200"
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
                      {clientCreditProfile.summary.on_time_rate == null
                        ? "—"
                        : `${clientCreditProfile.summary.on_time_rate.toFixed(0)}%`}{" "}
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

                    {clientCreditProfile.eligibility.can_borrow &&
                      clientCreditProfile.eligibility.warnings?.length > 0 && (
                        <div className="mt-2">
                          <p className="font-semibold text-amber-700 flex items-center gap-1">
                            <AlertTriangle size={16} className="text-amber-600" /> Heads up — lend with care:
                          </p>
                          <ul className="list-disc list-inside text-sm text-amber-700 mt-1">
                            {clientCreditProfile.eligibility.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                          <p className="text-xs text-amber-600 mt-1">
                            You can still proceed — you'll confirm before the loan is created.
                          </p>
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

            {/* Loan Package + Interest Method.
                The picker offers "Custom loan" + every active package.
                When a package is selected, the rate / fee / method are
                pulled from the package and the form fields become
                read-only so staff can see the values but can't
                override them. Range hints below amount/duration are
                informational; the backend re-validates on submit. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Loan Package
                </label>
                <select
                  value={formData.package_id}
                  onChange={(e) => {
                    const pkgId = e.target.value;
                    const pkg = packages.find(
                      (p) => String(p.id) === String(pkgId),
                    );
                    if (pkg) {
                      const annual = parseFloat(pkg.annual_interest_rate);
                      const allowed = pkg.allowed_purposes || [];
                      setFormData((prev) => ({
                        ...prev,
                        package_id: pkgId,
                        interest_method: pkg.interest_method || "flat",
                        annual_interest_rate: String(annual),
                        monthly_interest_rate: String(
                          roundRate(annual / 12),
                        ),
                        processing_fee_rate: String(pkg.processing_fee_rate),
                        // Snap purpose into the package's allow-list.
                        // Single allowed purpose → auto-fill; current
                        // value still valid → keep it; otherwise clear.
                        purpose:
                          allowed.length === 1
                            ? allowed[0]
                            : allowed.length === 0 ||
                                allowed.includes(prev.purpose)
                              ? prev.purpose
                              : "",
                      }));
                    } else {
                      setFormData((prev) => ({ ...prev, package_id: "" }));
                    }
                  }}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                >
                  <option value="">
                    Custom loan — no package (free-form)
                  </option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({Number(p.annual_interest_rate).toFixed(2)}%
                      {" · "}
                      {p.interest_method === "reducing" ? "reducing" : "flat"})
                    </option>
                  ))}
                </select>
                {selectedPackage && (
                  <p className="text-xs text-ocean-600 mt-1">
                    Rate, fee, and method are locked by this package.
                    Allowed amount{" "}
                    {Number(selectedPackage.min_amount).toLocaleString()}–
                    {Number(selectedPackage.max_amount).toLocaleString()},
                    duration {selectedPackage.min_duration_months}–
                    {selectedPackage.max_duration_months} months.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Interest Method *
                </label>
                <select
                  value={formData.interest_method}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      interest_method: e.target.value,
                    })
                  }
                  disabled={!!selectedPackage}
                  className={`w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white ${
                    selectedPackage ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  <option value="flat">
                    Flat — interest spread evenly
                  </option>
                  <option value="reducing">
                    Reducing balance — amortized (EMI)
                  </option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.interest_method === "reducing"
                    ? "Each installment is the same EMI; interest portion shrinks as the balance falls."
                    : "Total interest spread evenly across all installments (legacy default)."}
                </p>
              </div>
            </div>

            {/* Eligibility banner — appears only when a package is
                chosen AND a client is selected. Computes locally
                against the client's credit_score / client_type /
                branch_id so admin sees the verdict before submit.
                Backend re-checks on POST so this is advisory only. */}
            {selectedPackage && selectedClient && (() => {
              const verdict = evaluatePackageEligibility(
                selectedPackage,
                {
                  credit_score:
                    clientCreditProfile?.credit_score ??
                    selectedClient.credit_score,
                  client_type: selectedClient.client_type,
                  branch_id: selectedClient.branch_id,
                },
              );
              if (verdict.eligible) {
                return (
                  <div
                    className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${
                      verdict.recommended
                        ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                        : "bg-ocean-50 border border-ocean-200 text-ocean-800"
                    }`}
                  >
                    <CheckCircle size={16} className="mt-0.5 shrink-0" />
                    <span>
                      {verdict.recommended
                        ? `Recommended — this client is a strong fit for "${selectedPackage.name}".`
                        : `Client is eligible for "${selectedPackage.name}".`}
                    </span>
                  </div>
                );
              }
              return (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm">
                  <div className="font-semibold flex items-center gap-2">
                    <AlertTriangle size={16} /> Not eligible for "
                    {selectedPackage.name}"
                  </div>
                  <ul className="list-disc list-inside mt-1 text-rose-700">
                    {verdict.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}

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
                  min={selectedPackage ? selectedPackage.min_amount : 1000}
                  max={selectedPackage ? selectedPackage.max_amount : undefined}
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
                  readOnly={!!selectedPackage}
                  className={`w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none ${
                    selectedPackage ? "bg-gray-50 cursor-not-allowed" : ""
                  }`}
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
                  readOnly={!!selectedPackage}
                  className={`w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none ${
                    selectedPackage ? "bg-gray-50 cursor-not-allowed" : ""
                  }`}
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
                  min={selectedPackage ? selectedPackage.min_duration_months : 1}
                  max={
                    selectedPackage ? selectedPackage.max_duration_months : 60
                  }
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
                  readOnly={!!selectedPackage}
                  className={`w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none ${
                    selectedPackage ? "bg-gray-50 cursor-not-allowed" : ""
                  }`}
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
                  {purposesForPackage(selectedPackage).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {selectedPackage &&
                  (selectedPackage.allowed_purposes || []).length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Restricted by package to{" "}
                      {(selectedPackage.allowed_purposes || []).join(", ")}.
                    </p>
                  )}
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

              {/* Free-text security note — for informal security (a title
                  deed, a co-signer). Hidden once "Loan against collateral" is
                  on, since the structured item below replaces it. */}
              {!againstCollateral && (
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
              )}

              {/* Loan against collateral — opt-in structured pledge. When on,
                  the loan is created as a collateral loan (redeem / forfeit /
                  auction lifecycle) with the item recorded below. */}
              <div className="mb-4 rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={againstCollateral}
                    onChange={(e) => {
                      setAgainstCollateral(e.target.checked);
                      // Structured pledge is the single source of truth — drop
                      // any free-text note so we don't store both.
                      if (e.target.checked) {
                        setFormData((f) => ({ ...f, collateral_description: "" }));
                      }
                    }}
                    className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="flex items-center gap-2 font-semibold text-amber-900">
                    <Coins size={16} className="text-amber-600" /> Loan against collateral
                  </span>
                </label>
                <p className="text-xs text-amber-700 mt-1 ml-7">
                  Secure this loan with a pledged item the borrower hands over. You can
                  redeem it on repayment, or forfeit / auction it on default.
                </p>

                {againstCollateral && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      value={collateralForm.description}
                      onChange={setCol("description")}
                      placeholder="Item description * (e.g. Gold ring, 18k)"
                      className="md:col-span-2 px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <input
                      value={collateralForm.category}
                      onChange={setCol("category")}
                      placeholder="Category (jewelry, electronics…)"
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <select
                      value={collateralForm.condition}
                      onChange={setCol("condition")}
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    >
                      <option value="">Condition…</option>
                      <option value="excellent">Excellent</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="poor">Poor</option>
                    </select>
                    <input
                      value={collateralForm.serial_number}
                      onChange={setCol("serial_number")}
                      placeholder="Serial / model no."
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <input
                      value={collateralForm.storage_location}
                      onChange={setCol("storage_location")}
                      placeholder="Storage location"
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <input
                      type="number"
                      value={collateralForm.appraised_value}
                      onChange={setCol("appraised_value")}
                      placeholder="Appraised value * (KES)"
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <input
                      type="number"
                      value={collateralForm.ltv_percent}
                      onChange={setCol("ltv_percent")}
                      placeholder="LTV %"
                      className="px-3 py-2 border-2 border-amber-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                    />
                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-amber-800 mb-1">
                        Condition photos (up to 6)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => uploadCollateralPhotos(e.target.files)}
                        disabled={uploadingPhotos || collateralForm.photos.length >= 6}
                        className="text-sm text-amber-800"
                      />
                      {uploadingPhotos && (
                        <span className="ml-2 text-xs text-amber-600">Uploading…</span>
                      )}
                      {collateralForm.photos.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {collateralForm.photos.map((url, i) => (
                            <div key={i} className="relative">
                              <img
                                src={url}
                                alt={`collateral ${i + 1}`}
                                className="h-16 w-16 object-cover rounded-lg border border-amber-200"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setCollateralForm((c) => ({
                                    ...c,
                                    photos: c.photos.filter((_, j) => j !== i),
                                  }))
                                }
                                className="absolute -top-2 -right-2 bg-white rounded-full border border-amber-300 p-0.5 text-amber-700 hover:text-red-600"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {selectedPackage?.loan_type === "logbook" && (
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-sky-900 mb-1 flex items-center gap-2">
                    <Car size={16} className="text-sky-600" /> Vehicle Security
                  </h4>
                  <p className="text-xs text-sky-700 mb-3">
                    This is a logbook loan — record the vehicle whose logbook secures
                    it. You can also add or edit this later from the loan page.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <input
                      value={vehicleForm.make}
                      onChange={setVeh("make")}
                      placeholder="Make (Toyota)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.model}
                      onChange={setVeh("model")}
                      placeholder="Model (Premio)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={vehicleForm.year}
                      onChange={setVeh("year")}
                      placeholder="Year (2015)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.registration_number}
                      onChange={setVeh("registration_number")}
                      placeholder="Registration * (KCA 123A)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.color}
                      onChange={setVeh("color")}
                      placeholder="Colour"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={vehicleForm.valuation}
                      onChange={setVeh("valuation")}
                      placeholder="Valuation * (KES)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.logbook_number}
                      onChange={setVeh("logbook_number")}
                      placeholder="Logbook no."
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.chassis_number}
                      onChange={setVeh("chassis_number")}
                      placeholder="Chassis no."
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                    <input
                      value={vehicleForm.engine_number}
                      onChange={setVeh("engine_number")}
                      placeholder="Engine no."
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedPackage?.loan_type === "salary" && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-violet-900 mb-1 flex items-center gap-2">
                    <Banknote size={16} className="text-violet-600" /> Salary Check-off
                  </h4>
                  <p className="text-xs text-violet-700 mb-3">
                    This is a salary advance — record the employer and payslip so the
                    deduction can be checked for affordability. Editable later from the
                    loan page.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <input
                      value={salaryForm.employer_name}
                      onChange={setSal("employer_name")}
                      placeholder="Employer name * (Acme Ltd)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      value={salaryForm.employer_contact}
                      onChange={setSal("employer_contact")}
                      placeholder="Employer contact (HR)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      value={salaryForm.staff_number}
                      onChange={setSal("staff_number")}
                      placeholder="Staff / payroll no."
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={salaryForm.net_monthly_pay}
                      onChange={setSal("net_monthly_pay")}
                      placeholder="Net monthly pay * (KES)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={salaryForm.payday_day}
                      onChange={setSal("payday_day")}
                      placeholder="Payday (day of month)"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={salaryForm.max_deduction_percent}
                      onChange={setSal("max_deduction_percent")}
                      placeholder="Max deduction %"
                      className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedPackage?.loan_type === "group" && (
                <div className="bg-ocean-50 border border-ocean-200 rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-ocean-900 mb-1 flex items-center gap-2">
                    <Users size={16} className="text-ocean-600" /> Group / Chama
                  </h4>
                  <p className="text-xs text-ocean-700 mb-3">
                    This is a group loan — choose the group, then select one of its
                    members above as the borrower. The group co-guarantees the loan.
                  </p>
                  <select
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  >
                    <option value="">Select group…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.group_code}) — {g.member_count} members
                      </option>
                    ))}
                  </select>
                  {groups.length === 0 && (
                    <p className="text-xs text-amber-700 mt-2">
                      No active groups yet. Create one under Groups / Chama first.
                    </p>
                  )}
                  {groupId && groupCycles.length > 0 && (
                    <select
                      value={cycleId}
                      onChange={(e) => setCycleId(e.target.value)}
                      className="w-full mt-2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    >
                      <option value="">No lending cycle</option>
                      {groupCycles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || `Cycle ${c.cycle_number}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  {/* Late payment fee is opt-in per loan — not every lender
                      charges one. The toggle sits next to the label so it's
                      unambiguous which field it gates. Off keeps the
                      submitted value at 0 regardless of what's typed. */}
                  <div className="flex items-center gap-2 mb-1">
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
                      title={
                        formData.late_fee_enabled
                          ? "Late fee enabled — turn off to remove"
                          : "Late fee disabled — turn on to charge"
                      }
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
                  {/* Penalty rate is opt-in per loan — same pattern as the
                      Late Payment Fee toggle. Off sends 0 to the backend
                      regardless of what's typed. */}
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-sm font-semibold text-gray-700">
                      Penalty Rate (% per month on overdue)
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formData.penalty_rate_enabled}
                      onClick={() =>
                        setFormData({
                          ...formData,
                          penalty_rate_enabled: !formData.penalty_rate_enabled,
                        })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        formData.penalty_rate_enabled
                          ? "bg-ocean-600"
                          : "bg-gray-300"
                      }`}
                      title={
                        formData.penalty_rate_enabled
                          ? "Penalty rate enabled — turn off to remove"
                          : "Penalty rate disabled — turn on to charge"
                      }
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                          formData.penalty_rate_enabled
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
                    name="penalty_rate"
                    value={
                      formData.penalty_rate_enabled
                        ? formData.penalty_rate ?? 0
                        : 0
                    }
                    onChange={handleInputChange}
                    disabled={!formData.penalty_rate_enabled}
                    placeholder="e.g. 5.0"
                    className={`w-full px-3 py-2 border-2 rounded-lg focus:outline-none ${
                      formData.penalty_rate_enabled
                        ? "border-gray-200 focus:border-ocean-500"
                        : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.penalty_rate_enabled
                      ? "Monthly % charged on the overdue principal balance."
                      : "No penalty rate on this loan."}
                  </p>
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

          {/* Saved segments — named search + filter snapshots, stored in
              localStorage only (never server-side). A quick way to jump
              back to a frequent view. */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Bookmark size={14} /> Segments
            </span>
            {segments.length === 0 && (
              <span className="text-xs text-slate-400">
                None saved yet — set filters, then save this view.
              </span>
            )}
            {segments.map((seg) => (
              <span
                key={seg.id}
                className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 bg-ocean-50 text-ocean-700 rounded-full text-xs font-semibold"
              >
                <button
                  type="button"
                  onClick={() => applySegment(seg)}
                  className="hover:text-ocean-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 rounded"
                >
                  {seg.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSegment(seg.id)}
                  aria-label={`Delete segment ${seg.name}`}
                  className="text-ocean-400 hover:text-rose-600"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
            {filtersActive && (
              <button
                type="button"
                onClick={saveSegment}
                className="inline-flex items-center gap-1 px-3 py-1 border border-dashed border-slate-300 text-slate-600 rounded-full text-xs font-semibold hover:border-ocean-400 hover:text-ocean-700 transition"
              >
                <Plus size={12} /> Save current
              </button>
            )}
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
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
                  Search: "{searchQuery.trim()}"
                  <button
                    onClick={() => setSearchQuery("")}
                    className="hover:text-ocean-900"
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
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "2-digit",
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
                            ? "bg-ocean-100 text-ocean-700"
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
                    <p className="font-bold">{formatKES(loan.principal_amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Interest</p>
                    <p className="font-bold text-money-pos">
                      {formatKES(loan.total_interest || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Due</p>
                    <p className="font-bold">{formatKES(loan.total_amount_due)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Paid</p>
                    <p className="font-bold text-money-pos">
                      {formatKES(loan.total_paid || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p
                      className={`font-bold ${
                        balance > 0 ? "text-money-warn" : "text-money-pos"
                      }`}
                    >
                      {formatKES(balance)}
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
        <>
          <LoansTableSkeleton />
          <div className="md:hidden space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-xl shadow-card p-4 space-y-3"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </>
      ) : loans.length === 0 ? (
        /* Guided empty state — static illustrative UI, no DB rows. */
        <div className="bg-white rounded-2xl shadow-card p-10 lg:p-14 text-center max-w-xl mx-auto">
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-ocean-gradient-soft flex items-center justify-center">
            <Coins size={30} className="text-ocean-600" />
          </div>
          <h3 className="text-xl font-bold text-navy-900 mb-2">
            No loans issued yet
          </h3>
          <p className="text-slate-500 mb-6">
            When you issue a loan it shows up here with its balance, schedule
            and repayment progress. Create your first one to get started.
          </p>
          <PermissionGate role={["admin", "manager", "officer"]}>
            <button
              onClick={() => setShowForm(true)}
              className="px-6 py-2.5 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-2"
            >
              <Plus size={16} /> Create Loan
            </button>
          </PermissionGate>
        </div>
      ) : filteredLoans.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-10 lg:p-14 text-center max-w-xl mx-auto">
          <div className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Search size={30} className="text-slate-400" />
          </div>
          <h3 className="text-xl font-bold text-navy-900 mb-2">
            No loans match your filters
          </h3>
          <p className="text-slate-500 mb-6">
            Try adjusting your search or filter criteria.
          </p>
          <button
            onClick={clearFilters}
            className="px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-2"
          >
            <X size={16} /> Clear Filters
          </button>
        </div>
      ) : (
        <div className="hidden md:block bg-white rounded-xl shadow-card overflow-hidden">
          {/* Column-preset toolbar — client-side only (persisted in
              localStorage). Switches which columns ride in the row; the
              rest fall into each row's expandable detail panel. */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
              <SlidersHorizontal size={15} /> Columns
            </span>
            <div
              className="inline-flex rounded-lg bg-gray-100 p-0.5"
              role="group"
              aria-label="Column preset"
            >
              {Object.entries(COLUMN_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={columnPreset === key}
                  onClick={() => setColumnPreset(key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 ${
                    columnPreset === key
                      ? "bg-white text-ocean-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <div
              className="overflow-auto max-h-[calc(100vh-400px)]"
              role="region"
              aria-label="Loans — scroll horizontally for more columns"
              tabIndex={0}
            >
              <table className="w-full whitespace-nowrap [&_tbody_td]:align-top">
                <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-20 shadow-sm">
                  <tr>
                    <th className="px-4 py-4 w-10 sticky left-0 z-30 bg-gray-50">
                      <input
                        type="checkbox"
                        checked={bulk.allOnPageSelected}
                        onChange={bulk.togglePage}
                        className="w-4 h-4 cursor-pointer"
                        aria-label="Select all loans on this page"
                      />
                    </th>
                    <SortableHeader
                      label="Loan Code"
                      sortKey="loan_code"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="left"
                      className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase sticky left-10 z-30 bg-gray-50 border-r border-gray-200"
                    />
                    {visibleColumns.map((col) => (
                      <SortableHeader
                        key={col.key}
                        label={col.label}
                        sortKey={col.key}
                        requestSort={requestSort}
                        getSortIndicator={getSortIndicator}
                        align={col.align}
                        className={`px-4 py-4 text-${col.align} text-xs font-semibold text-gray-600 uppercase`}
                      />
                    ))}
                    <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                      View
                    </th>
                  </tr>
                </thead>
                <tbody>
                {paginatedLoans.map((loan) => {
                  const isSel = bulk.isSelected(loan.id);
                  const expanded = expandedRows.has(loan.id);
                  // Sticky identity cells need an opaque bg that still tracks
                  // the row's hover/selected state (a transparent sticky cell
                  // would let scrolled columns show through).
                  const stickyBg = isSel
                    ? "bg-ocean-50"
                    : "bg-white group-hover:bg-ocean-50";

                  return (
                    <React.Fragment key={loan.id}>
                      <tr
                        onClick={() => navigate(`/loans/${loan.id}`)}
                        className={`group border-b border-gray-100 transition cursor-pointer ${
                          isSel ? "bg-ocean-50" : "hover:bg-ocean-50"
                        }`}
                      >
                        <td
                          className={`px-4 py-4 sticky left-0 z-10 ${stickyBg}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => bulk.toggle(loan.id)}
                            className="w-4 h-4 cursor-pointer"
                            aria-label={`Select loan ${loan.loan_code}`}
                          />
                        </td>
                        <td
                          className={`px-4 py-4 sticky left-10 z-10 border-r border-gray-100 ${stickyBg}`}
                        >
                          <div className="flex items-start gap-2">
                            {hiddenColumns.length > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRow(loan.id);
                                }}
                                aria-expanded={expanded}
                                aria-label={
                                  expanded
                                    ? `Hide details for ${loan.loan_code}`
                                    : `Show details for ${loan.loan_code}`
                                }
                                className="mt-0.5 text-gray-400 hover:text-ocean-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400"
                              >
                                {expanded ? (
                                  <ChevronDown size={16} />
                                ) : (
                                  <ChevronRight size={16} />
                                )}
                              </button>
                            )}
                            <div className="font-mono text-sm font-semibold text-ocean-600">
                              <div>{loan.loan_code}</div>
                              {/* Package tag — only shown when the loan was
                                  applied via a published product. */}
                              {loan.package_name && (
                                <p className="text-[10px] font-semibold text-ocean-700 bg-ocean-50 inline-block px-1.5 py-0.5 rounded mt-1 font-sans">
                                  {loan.package_name}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className={`px-4 py-4 text-${col.align}`}
                          >
                            {col.cell(loan)}
                          </td>
                        ))}
                        <td
                          className="px-4 py-4 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/loans/${loan.id}`)}
                            aria-label={`Open loan ${loan.loan_code}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-ocean-600 hover:bg-ocean-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 transition"
                          >
                            <ArrowRight size={16} />
                          </button>
                        </td>
                      </tr>
                      {expanded && hiddenColumns.length > 0 && (
                        <tr className="bg-ocean-50/40 border-b border-gray-100">
                          <td
                            colSpan={visibleColumns.length + 3}
                            className="px-4 py-3"
                          >
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 pl-12">
                              {hiddenColumns.map((col) => (
                                <div key={col.key}>
                                  <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">
                                    {col.label}
                                  </p>
                                  {col.cell(loan)}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* TOTALS ROW — driven by the same visible columns as the
                  header so totals stay aligned across presets. */}
              <tfoot className="bg-ocean-gradient-soft border-t-2 border-ocean-200">
                <tr>
                  <td className="px-4 py-4 sticky left-0 z-10 bg-ocean-50" />
                  <td className="px-4 py-4 font-bold text-gray-800 text-sm sticky left-10 z-10 bg-ocean-50 border-r border-ocean-200">
                    <span className="inline-flex items-center gap-2">
                      <BarChart3 size={16} /> TOTALS ({filteredLoans.length})
                    </span>
                  </td>
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={`px-4 py-4 text-${col.align}`}>
                      {col.money ? (
                        <div>
                          <p
                            className={`font-bold text-sm ${col.totalClass || "text-gray-800"}`}
                          >
                            {formatKES(col.total(filteredLoans))}
                          </p>
                          {col.key === "overpayment_amount" && (
                            <p className="text-xs text-ocean-600 mt-1">
                              Pending:{" "}
                              {formatKES(
                                filteredLoans
                                  .filter((l) => l.refund_status === "pending")
                                  .reduce(
                                    (s, l) => s + num(l.overpayment_amount),
                                    0,
                                  ),
                              )}
                            </p>
                          )}
                        </div>
                      ) : col.key === "status" ? (
                        <p className="text-xs text-gray-600">
                          Active:{" "}
                          {
                            filteredLoans.filter((l) => l.status === "active")
                              .length
                          }{" "}
                          • Completed:{" "}
                          {
                            filteredLoans.filter((l) => l.status === "completed")
                              .length
                          }
                        </p>
                      ) : null}
                    </td>
                  ))}
                  <td className="px-4 py-4" />
                </tr>
              </tfoot>
            </table>
            </div>
            {/* horizontal-scroll affordance — a soft right-edge fade hints
                there are more columns when the table overflows. */}
            <div className="pointer-events-none absolute top-0 right-0 h-full w-10 bg-gradient-to-l from-slate-900/5 to-transparent" />
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
          {selectedAllPendingRefund && (
            <button
              onClick={() => setShowBulkRefundModal(true)}
              className="px-4 py-2 bg-ocean-500/30 hover:bg-ocean-500/50 rounded-lg text-sm font-semibold inline-flex items-center gap-1"
              title="Mark every selected pending refund as paid"
            >
              <RotateCcw size={16} /> Mass Refund
            </button>
          )}
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

      {/* Mass refund modal — one method/reference/date applied to every
          selected pending refund. Backend re-checks per-loan eligibility. */}
      {showBulkRefundModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <RotateCcw size={18} className="text-ocean-600" /> Mass
                Refund
              </h3>
              <button
                onClick={() => setShowBulkRefundModal(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleBulkRefund} className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Marking{" "}
                <strong>
                  {bulk.count} refund{bulk.count !== 1 ? "s" : ""}
                </strong>{" "}
                as paid — total{" "}
                <strong className="text-ocean-700">
                  KES{" "}
                  {bulk.selectedArray
                    .reduce((sum, id) => {
                      const l = loans.find((x) => x.id === id);
                      return (
                        sum + parseFloat(l?.overpayment_amount || 0)
                      );
                    }, 0)
                    .toLocaleString()}
                </strong>
                .
              </p>
              <div>
                <label className="block text-sm font-semibold mb-1 text-gray-700">
                  Refund method *
                </label>
                <select
                  value={bulkRefundData.refund_method}
                  onChange={(e) =>
                    setBulkRefundData({
                      ...bulkRefundData,
                      refund_method: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1 text-gray-700">
                  Reference
                </label>
                <input
                  type="text"
                  value={bulkRefundData.refund_reference}
                  onChange={(e) =>
                    setBulkRefundData({
                      ...bulkRefundData,
                      refund_reference: e.target.value,
                    })
                  }
                  placeholder="optional — shared by all"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1 text-gray-700">
                  Refund date *
                </label>
                <input
                  type="date"
                  value={bulkRefundData.refunded_date}
                  onChange={(e) =>
                    setBulkRefundData({
                      ...bulkRefundData,
                      refunded_date: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBulkRefundModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkRefundBusy}
                  className="px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <RotateCcw size={15} />
                  {bulkRefundBusy ? "Processing…" : "Mark as Refunded"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dues/defaults are a warning, not a wall — let the lender decide. */}
      {duesPrompt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDuesPrompt(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center"><AlertTriangle size={20} className="text-amber-600" /></div>
              <h3 className="text-lg font-bold text-slate-900">Heads up — this client has dues</h3>
            </div>
            <p className="text-sm text-slate-600 mb-1">{duesPrompt.error}</p>
            <p className="text-sm text-slate-500 mb-5">Lending is still your call. Cancel to hold off, or proceed to issue the loan anyway.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDuesPrompt(null)} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => { setDuesPrompt(null); handleSubmit(null, true); }}
                disabled={submitting}
                className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Proceed anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Loans;
