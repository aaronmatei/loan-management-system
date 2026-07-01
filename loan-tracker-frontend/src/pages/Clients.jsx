import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Check,
  Download,
  CheckCircle,
  Users,
  UserPlus,
} from "lucide-react";
import api from "../services/api";
import { apiErrorMessage } from "../utils/apiError";
import { KENYA_COUNTIES } from "../utils/counties";
import { BUSINESS_TYPES } from "../utils/businessTypes";
import {
  CLIENT_TYPES,
  businessNameLabel,
  clientTypeLabel,
  clientTags,
  tagChipClass,
} from "../utils/clientTypes";
import { timeAgo } from "../utils/relativeTime";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import PermissionGate from "../components/PermissionGate";
import { bulkExport } from "../utils/bulkExport";
import { useSortableTable } from "../hooks/useSortableTable";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import DataTable from "../components/DataTable";
import SegmentBar from "../components/SegmentBar";
import { useColumnPreset, useFilterSegments } from "../hooks/useTablePrefs";
import { formatKES } from "../utils/money";

// ── Clients table column model ───────────────────────────────────────
// The desktop clients table is column-driven so we can offer client-side
// presets (which columns show in the row) and push the rest into an
// expandable detail row — without forking the rendering logic. The client
// identity (code + name + tags) is pinned (sticky) and rendered specially
// in the row, so it is NOT part of this generic list. There are no money
// columns here, so the table has no totals row.
const CLIENT_COLUMNS = [
  {
    key: "client_type",
    label: "Type",
    align: "left",
    cell: (client) => (
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
          client.client_type === "business"
            ? "bg-violet-100 text-violet-700"
            : client.client_type === "group"
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
        }`}
      >
        {clientTypeLabel(client.client_type)}
      </span>
    ),
  },
  {
    key: "phone_number",
    label: "Phone",
    align: "left",
    cell: (client) => (
      <span className="text-gray-600 dark:text-slate-400">
        {client.phone_number}
      </span>
    ),
  },
  {
    key: "branch_name",
    label: "Branch",
    align: "left",
    cell: (client) => (
      <span className="text-gray-600 dark:text-slate-400">
        {client.branch_name || "—"}
      </span>
    ),
  },
  {
    key: "created_at",
    label: "Joined",
    align: "left",
    cell: (client) => (
      <span className="text-gray-600 dark:text-slate-400 whitespace-nowrap">
        {client.created_at
          ? new Date(client.created_at).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "—"}
      </span>
    ),
  },
  {
    key: "credit_score",
    label: "Score",
    align: "left",
    cell: (client) =>
      client.credit_score == null ? (
        <span className="font-semibold text-gray-400 dark:text-slate-400">
          —
        </span>
      ) : (
        <span
          className={`font-semibold ${
            client.credit_score >= 80
              ? "text-emerald-600"
              : client.credit_score >= 60
                ? "text-amber-600"
                : "text-rose-600"
          }`}
        >
          {client.credit_score}
        </span>
      ),
  },
  {
    key: "last_activity",
    label: "Last Activity",
    align: "left",
    cell: (client) => (
      <span className="text-gray-600 dark:text-slate-400 whitespace-nowrap">
        {timeAgo(client.last_activity)}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    align: "left",
    cell: (client) => (
      <span
        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
          client.status === "active"
            ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
        }`}
      >
        {client.status}
      </span>
    ),
  },
];

// Column presets — which keys render in the row. The client identity is
// always pinned and shown outside this set. Anything not visible drops
// into the expandable detail row, so no data is ever hidden — just demoted.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["phone_number", "credit_score", "status"],
  },
  standard: {
    label: "Standard",
    keys: [
      "client_type",
      "phone_number",
      "branch_name",
      "credit_score",
      "status",
    ],
  },
  full: {
    label: "Everything",
    keys: CLIENT_COLUMNS.map((c) => c.key),
  },
};

const PRESET_STORAGE_KEY = "clients.columnPreset";
const SEGMENTS_STORAGE_KEY = "clients.segments";

function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Seed from a `?q=` param so the global topbar search (Layout) can deep-link
  // straight into a filtered client list.
  const [searchTerm, setSearchTerm] = useState(
    () => new URLSearchParams(window.location.search).get("q") || "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [formData, setFormData] = useState({
    client_type: "individual",
    first_name: "",
    last_name: "",
    phone_number: "",
    email: "",
    id_number: "",
    business_name: "",
    business_type: "",
    address: "",
    city: "",
    county: "",
    date_of_birth: "",
    gender: "",
    branch_id: "",
    registration_no: "",
    meeting_frequency: "",
    member_count: "",
  });
  const [branches, setBranches] = useState([]);
  // A group/business isn't a person, so the form adapts: name fields become a
  // contact person and individual-only fields (gender, DOB) are hidden.
  const isIndividual = formData.client_type === "individual";
  const isGroup = formData.client_type === "group";

  useEffect(() => {
    fetchClients();
    fetchBranches();
  }, []);

  // Only ACTIVE branches go in the create-client dropdown — archived
  // ones stay visible in Settings but can no longer be assigned.
  const fetchBranches = async () => {
    try {
      const r = await api.get("/branches");
      setBranches((r.data.data || []).filter((b) => b.active));
    } catch {
      // Non-fatal — form still works (backend falls back to default).
    }
  };

  // Reset to the first page whenever the search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const response = await api.get("/clients");
      setClients(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await api.post("/clients", formData);
      setSuccess(
        `Client ${response.data.data.client_code} created successfully!`,
      );
      setFormData({
        client_type: "individual",
        first_name: "",
        last_name: "",
        phone_number: "",
        email: "",
        id_number: "",
        business_name: "",
        business_type: "",
        address: "",
        city: "",
        county: "",
        date_of_birth: "",
        gender: "",
        branch_id: "",
        registration_no: "",
        meeting_frequency: "",
        member_count: "",
      });
      setShowForm(false);
      fetchClients();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to create client"));
    } finally {
      setSubmitting(false);
    }
  };

  // Real-time client-side search (same pattern as the Loans page)
  const query = searchTerm.trim().toLowerCase();
  const filteredClients = query
    ? clients.filter((c) =>
        [
          c.first_name,
          c.last_name,
          c.phone_number,
          c.email,
          c.id_number,
          c.client_code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : clients;

  // Sort the filtered set, then paginate the sorted view. Default
  // sort matches the prior implicit order (created_at desc).
  const {
    sortedData: sortedClients,
    requestSort,
    getSortIndicator,
  } = useSortableTable(filteredClients, "created_at", "desc");

  const itemsPerPage = 50;
  const totalPages = Math.ceil(sortedClients.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedClients = sortedClients.slice(startIndex, endIndex);

  // ── Bulk selection ──────────────────────────────────────────
  const bulk = useBulkSelection(paginatedClients);

  // ── Table UX state (client-side only) ─────────────────────────
  // Expanded rows reveal columns demoted by the active preset.
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleRow = (id) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Column preset + saved filter segments — shared hooks, localStorage only.
  const [columnPreset, setColumnPreset] = useColumnPreset(
    PRESET_STORAGE_KEY,
    COLUMN_PRESETS,
    "standard",
  );
  const { segments, saveSegment, deleteSegment } =
    useFilterSegments(SEGMENTS_STORAGE_KEY);

  // ── Saved filter segments (localStorage only, via shared hook) ─
  // The Clients page's only filter is the search box, so segments snapshot
  // that single piece of state.
  const handleSaveSegment = () => {
    const name = window.prompt("Name this segment (e.g. Acme search)");
    if (!name) return;
    saveSegment(name, { searchTerm });
  };
  const applySegment = (segment) => {
    const snap = segment.snapshot || {};
    setSearchTerm(snap.searchTerm || "");
    setCurrentPage(1);
  };

  const handleBulkExport = async () => {
    try {
      await bulkExport(
        "/clients/bulk/export",
        { client_ids: bulk.selectedArray },
        `selected_clients_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      bulk.clear();
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleBulkStatus = async (status) => {
    if (!window.confirm(`Update ${bulk.count} client(s) to "${status}"?`))
      return;
    try {
      const res = await api.post("/clients/bulk/status", {
        client_ids: bulk.selectedArray,
        status,
      });
      alert(res.data.message);
      bulk.clear();
      fetchClients();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <PageHeader
        icon={Users}
        title="Clients"
        kpis={[
          { label: "Total clients", value: clients.length },
          {
            label: "Active",
            value: clients.filter((c) => c.status === "active").length,
            tone: "pos",
          },
        ]}
        actions={
          <button
            onClick={() => setShowForm(!showForm)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            {showForm ? <><X size={16} /> Cancel</> : <><UserPlus size={16} className="text-white" /> Add Client</>}
          </button>
        }
      >
        {/* Search Bar (real-time, client-side) */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 pointer-events-none">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, phone, email, ID, or code..."
                className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
              />
            </div>
          </div>
          {searchTerm.trim() && (
            <button
              onClick={() => setSearchTerm("")}
              className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <X size={14} className="inline mr-1" />Clear
            </button>
          )}
        </div>

        {searchTerm.trim() && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
            <span className="text-sm text-gray-500 dark:text-slate-400">
              Showing{" "}
              <span className="font-semibold text-gray-800 dark:text-slate-100">
                {filteredClients.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-gray-800 dark:text-slate-100">
                {clients.length}
              </span>{" "}
              clients
            </span>
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
              Search: "{searchTerm.trim()}"
              <button
                onClick={() => setSearchTerm("")}
                className="hover:text-ocean-900"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}
      </PageHeader>

      {/* Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-500 shrink-0" />{success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Add Client Form */}
      {showForm && (
        <div className="bg-surface rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-6">
            Add New Client
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type — controls whether the Business Name section shows
                and adapts its label (Group → Group Name). */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
                Client Type *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {CLIENT_TYPES.map((t) => {
                  const Icon = t.icon;
                  const selected = formData.client_type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          client_type: t.value,
                          // Drop fields that don't apply to the new type so
                          // stale values aren't submitted.
                          ...(t.value === "individual"
                            ? { business_name: "", business_type: "", registration_no: "", meeting_frequency: "", member_count: "" }
                            : { gender: "", date_of_birth: "" }),
                          ...(t.value === "business"
                            ? { meeting_frequency: "", member_count: "" }
                            : {}),
                        })
                      }
                      className={`text-left p-3 rounded-lg border-2 transition ${
                        selected
                          ? "border-ocean-500 bg-ocean-50"
                          : "border-gray-200 hover:border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-slate-100">
                        <Icon size={16} />
                        {t.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {t.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  {isIndividual ? "First Name *" : "Contact First Name *"}
                </label>
                <input
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleInputChange}
                  required
                  placeholder="John"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  {isIndividual ? "Last Name *" : "Contact Last Name *"}
                </label>
                <input
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleInputChange}
                  required
                  placeholder="Mwangi"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Phone Number *
                </label>
                <input
                  name="phone_number"
                  value={formData.phone_number}
                  onChange={handleInputChange}
                  required
                  placeholder="0712345678"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  {isIndividual ? "ID Number" : "Contact ID Number"}
                </label>
                <input
                  name="id_number"
                  value={formData.id_number}
                  onChange={handleInputChange}
                  placeholder="12345678"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              {/* Gender is a person attribute — only for individual clients. */}
              {isIndividual && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Gender
                  </label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  >
                    <option value="">-- Select --</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}
            </div>

            {/* Business / Group block — hidden for individual clients. */}
            {formData.client_type !== "individual" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    {businessNameLabel(formData.client_type)}
                  </label>
                  <input
                    name="business_name"
                    value={formData.business_name}
                    onChange={handleInputChange}
                    placeholder={
                      formData.client_type === "group"
                        ? "Maendeleo Chama"
                        : "John's Shop"
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    {formData.client_type === "group"
                      ? "Group Activity"
                      : "Business Type"}
                  </label>
                  <select
                    name="business_type"
                    value={formData.business_type}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  >
                    <option value="">-- Select Type --</option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Registration number — relevant to both groups and businesses. */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Registration No.
                  </label>
                  <input
                    name="registration_no"
                    value={formData.registration_no}
                    onChange={handleInputChange}
                    placeholder={isGroup ? "e.g. SG/12345" : "e.g. PVT-2024-001"}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>

                {/* Group-only: how often they meet and how many members. */}
                {isGroup && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                        Meeting Frequency
                      </label>
                      <select
                        name="meeting_frequency"
                        value={formData.meeting_frequency}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                      >
                        <option value="">-- Select --</option>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                        Number of Members
                      </label>
                      <input
                        type="number"
                        min="0"
                        name="member_count"
                        value={formData.member_count}
                        onChange={handleInputChange}
                        placeholder="12"
                        className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Date of birth is a person attribute — only for individuals. */}
              {isIndividual && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    name="date_of_birth"
                    value={formData.date_of_birth}
                    onChange={handleInputChange}
                    max={new Date().toISOString().split("T")[0]}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                  />
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                    Optional — powers borrower-age analytics
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  Branch
                </label>
                <select
                  name="branch_id"
                  value={formData.branch_id}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                >
                  <option value="">
                    {branches.length === 0
                      ? "— Default branch —"
                      : "— Default branch —"}
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  Add branches in Settings to assign new clients here.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  City
                </label>
                <input
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  placeholder="Nairobi"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                  County
                </label>
                <select
                  name="county"
                  value={formData.county}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Address
              </label>
              <input
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="P.O Box 123-00100"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
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
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
              >
                {submitting ? "Saving..." : <><Check size={16} /> Save Client</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mobile card list (desktop uses the table below) */}
      {!loading && filteredClients.length > 0 && (
        <div className="md:hidden space-y-3 mb-4">
          {paginatedClients.map((client) => (
            <div
              key={client.id}
              onClick={() => navigate(`/clients/${client.id}/profile`)}
              className={`bg-surface rounded-xl shadow-md p-4 cursor-pointer hover:shadow-lg transition ${
                bulk.isSelected(client.id) ? "ring-2 ring-ocean-400" : ""
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={bulk.isSelected(client.id)}
                    onChange={() => bulk.toggle(client.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-5 h-5 cursor-pointer mt-1 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-800 dark:text-slate-100 truncate">
                      {client.first_name} {client.last_name}
                    </h3>
                    <p className="text-xs text-ocean-600 font-mono">
                      {client.client_code}
                    </p>
                    {clientTags(client).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {clientTags(client).map((t) => (
                          <span
                            key={t.key}
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${tagChipClass(
                              t.tone,
                            )}`}
                          >
                            {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                    client.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200"
                  }`}
                >
                  {client.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm border-t border-gray-100 dark:border-slate-700 pt-3">
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Phone</p>
                  <p className="font-semibold">{client.phone_number}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Branch</p>
                  <p className="font-semibold truncate">
                    {client.branch_name || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Score</p>
                  <p className="font-semibold">
                    {client.credit_score == null ? "—" : client.credit_score}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Last Activity</p>
                  <p className="font-semibold truncate">
                    {timeAgo(client.last_activity)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Clients List */}
      {loading ? (
        <div className="bg-surface rounded-xl shadow-md overflow-hidden">
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Add your first client to start tracking loans, payments, and credit scores."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
            >
              <UserPlus size={16} /> Add Client
            </button>
          }
        />
      ) : filteredClients.length === 0 ? (
        <EmptyState
          icon={Search}
          tone="muted"
          title="No clients match your search"
          description="Try a different name, phone, email, ID, or code."
          action={
            <button
              onClick={() => setSearchTerm("")}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
            >
              <X size={16} /> Clear Search
            </button>
          }
        />
      ) : (
        <div className="hidden md:block">
          <SegmentBar
            segments={segments}
            onApply={applySegment}
            onDelete={deleteSegment}
            onSave={handleSaveSegment}
            canSave={searchTerm.trim() !== ""}
            className="mb-3"
          />

          <DataTable
            columns={CLIENT_COLUMNS}
            rows={paginatedClients}
            rowKey={(client) => client.id}
            pinned={{
              label: "Client",
              sortKey: "client_code",
              cell: (client) => (
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-ocean-600">
                    {client.client_code}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5 font-semibold text-gray-800 dark:text-slate-100">
                    <span>
                      {client.first_name} {client.last_name}
                    </span>
                    {clientTags(client).map((t) => (
                      <span
                        key={t.key}
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${tagChipClass(
                          t.tone,
                        )}`}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              ),
            }}
            presets={COLUMN_PRESETS}
            preset={columnPreset}
            onPresetChange={setColumnPreset}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
            selection={{
              isSelected: bulk.isSelected,
              toggle: bulk.toggle,
              allSelected: bulk.allOnPageSelected,
              toggleAll: bulk.togglePage,
            }}
            sort={{ requestSort, getSortIndicator }}
            onRowClick={(client) =>
              navigate(`/clients/${client.id}/profile`)
            }
            openLabel={(client) =>
              `Open ${client.first_name} ${client.last_name}`
            }
          />

          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 mt-3 bg-surface rounded-xl shadow-card">
              <div className="text-sm text-gray-600 dark:text-slate-400">
                Showing <span className="font-semibold">{startIndex + 1}</span>{" "}
                to{" "}
                <span className="font-semibold">
                  {Math.min(endIndex, filteredClients.length)}
                </span>{" "}
                of{" "}
                <span className="font-semibold">{filteredClients.length}</span>{" "}
                results
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 bg-surface border border-gray-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
                            <span className="px-2 text-gray-400 dark:text-slate-400">...</span>
                          )}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                              currentPage === page
                                ? "bg-ocean-600 text-white"
                                : "bg-surface border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
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
                  className="px-3 py-2 bg-surface border border-gray-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
        totalCount={filteredClients.length}
        onClear={bulk.clear}
      >
        <button
          onClick={handleBulkExport}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          <Download size={15} /> Export
        </button>

        <BulkMessaging
          clientIds={bulk.selectedArray}
          onComplete={bulk.clear}
        />

        <PermissionGate role={["admin", "manager"]}>
          <div className="border-l border-white/30 mx-1 h-6"></div>
          <button
            onClick={() => handleBulkStatus("active")}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-500/30 hover:bg-green-500/50 rounded-lg text-sm font-semibold"
          >
            <Check size={15} /> Activate
          </button>
          <button
            onClick={() => handleBulkStatus("inactive")}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-yellow-500/30 hover:bg-yellow-500/50 rounded-lg text-sm font-semibold"
          >
            <X size={15} /> Deactivate
          </button>
          <button
            onClick={() => handleBulkStatus("blacklisted")}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-500/30 hover:bg-red-500/50 rounded-lg text-sm font-semibold"
          >
            <X size={15} /> Blacklist
          </button>
        </PermissionGate>
      </BulkActionBar>
    </div>
  );
}

export default Clients;
