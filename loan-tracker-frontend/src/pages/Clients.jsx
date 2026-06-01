import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  X,
  Check,
  Download,
  CheckCircle,
} from "lucide-react";
import api from "../services/api";
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
import SortableHeader from "../components/SortableHeader";

function Clients() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
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
  });
  const [branches, setBranches] = useState([]);

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
      });
      setShowForm(false);
      fetchClients();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create client");
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
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
            Clients
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            Total: <span className="font-semibold">{clients.length}</span>{" "}
            clients
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
        >
          {showForm ? <><X size={16} /> Cancel</> : <><Check size={16} className="text-white" /> Add Client</>}
        </button>
      </div>

      {/* Search Bar (real-time, client-side) */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, phone, email, ID, or code..."
                className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>
          </div>
          {searchTerm.trim() && (
            <button
              onClick={() => setSearchTerm("")}
              className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition"
            >
              <X size={14} className="inline mr-1" />Clear
            </button>
          )}
        </div>

        {searchTerm.trim() && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              Showing{" "}
              <span className="font-semibold text-gray-800">
                {filteredClients.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-gray-800">
                {clients.length}
              </span>{" "}
              clients
            </span>
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
              Search: "{searchTerm.trim()}"
              <button
                onClick={() => setSearchTerm("")}
                className="hover:text-blue-900"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-500 shrink-0" />{success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Add Client Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Add New Client
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type — controls whether the Business Name section shows
                and adapts its label (Group → Group Name). */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
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
                        setFormData({ ...formData, client_type: t.value })
                      }
                      className={`text-left p-3 rounded-lg border-2 transition ${
                        selected
                          ? "border-ocean-500 bg-ocean-50"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold text-gray-800">
                        <Icon size={16} />
                        {t.label}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {t.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  First Name *
                </label>
                <input
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleInputChange}
                  required
                  placeholder="John"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Last Name *
                </label>
                <input
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleInputChange}
                  required
                  placeholder="Mwangi"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Phone Number *
                </label>
                <input
                  name="phone_number"
                  value={formData.phone_number}
                  onChange={handleInputChange}
                  required
                  placeholder="0712345678"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@example.com"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  ID Number
                </label>
                <input
                  name="id_number"
                  value={formData.id_number}
                  onChange={handleInputChange}
                  placeholder="12345678"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Gender
                </label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                >
                  <option value="">-- Select --</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Business / Group block — hidden for individual clients. */}
            {formData.client_type !== "individual" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
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
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {formData.client_type === "group"
                      ? "Group Activity"
                      : "Business Type"}
                  </label>
                  <select
                    name="business_type"
                    value={formData.business_type}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                  >
                    <option value="">-- Select Type --</option>
                    {BUSINESS_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  name="date_of_birth"
                  value={formData.date_of_birth}
                  onChange={handleInputChange}
                  max={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Optional — powers borrower-age analytics
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Branch
                </label>
                <select
                  name="branch_id"
                  value={formData.branch_id}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
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
                <p className="text-xs text-gray-500 mt-1">
                  Add branches in Settings to assign new clients here.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  City
                </label>
                <input
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  placeholder="Nairobi"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  County
                </label>
                <select
                  name="county"
                  value={formData.county}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
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
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Address
              </label>
              <input
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="P.O Box 123-00100"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
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
              className={`bg-white rounded-xl shadow-md p-4 cursor-pointer hover:shadow-lg transition ${
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
                    <h3 className="font-bold text-gray-800 truncate">
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
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {client.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm border-t border-gray-100 pt-3">
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="font-semibold">{client.phone_number}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Branch</p>
                  <p className="font-semibold truncate">
                    {client.branch_name || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Score</p>
                  <p className="font-semibold">
                    {client.credit_score == null ? "—" : client.credit_score}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Last Activity</p>
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
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading clients...
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No clients yet
          </h3>
          <p className="text-gray-500">
            Click "Add Client" to add your first client
          </p>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="flex justify-center mb-4">
            <Search size={48} className="text-gray-300" />
          </div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No clients match your search
          </h3>
          <p className="text-gray-500 mb-4">
            Try a different name, phone, email, ID, or code
          </p>
          <button
            onClick={() => setSearchTerm("")}
            className="inline-flex items-center gap-2 px-6 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            <X size={16} /> Clear Search
          </button>
        </div>
      ) : (
        <div className="hidden md:block bg-white rounded-xl shadow-md overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
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
                    ["Code", "client_code"],
                    ["Name", "first_name"],
                    ["Type", "client_type"],
                    ["Phone", "phone_number"],
                    ["Branch", "branch_name"],
                    ["Joined", "created_at"],
                    ["Score", "credit_score"],
                    ["Last Activity", "last_activity"],
                    ["Status", "status"],
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
                {paginatedClients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}/profile`)}
                    className={`border-b border-gray-100 hover:bg-ocean-50 transition cursor-pointer ${
                      bulk.isSelected(client.id) ? "bg-ocean-50" : ""
                    }`}
                  >
                    <td
                      className="px-4 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={bulk.isSelected(client.id)}
                        onChange={() => bulk.toggle(client.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-6 py-4 font-mono text-sm font-semibold text-ocean-600">
                      {client.client_code}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-800">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          client.client_type === "business"
                            ? "bg-violet-100 text-violet-700"
                            : client.client_type === "group"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {clientTypeLabel(client.client_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.phone_number}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.branch_name || "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                      {client.created_at
                        ? new Date(client.created_at).toLocaleDateString(
                            "en-GB",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            },
                          )
                        : "—"}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-700">
                      {client.credit_score == null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span
                          className={
                            client.credit_score >= 80
                              ? "text-emerald-600"
                              : client.credit_score >= 60
                                ? "text-amber-600"
                                : "text-rose-600"
                          }
                        >
                          {client.credit_score}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                      {timeAgo(client.last_activity)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                          client.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {client.status}
                      </span>
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
