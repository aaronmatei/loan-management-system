import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { KENYA_COUNTIES } from "../utils/counties";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionBar from "../components/BulkActionBar";
import BulkMessaging from "../components/BulkMessaging";
import PermissionGate from "../components/PermissionGate";
import { bulkExport } from "../utils/bulkExport";

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
  });

  useEffect(() => {
    fetchClients();
  }, []);

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
        `✅ Client ${response.data.data.client_code} created successfully!`,
      );
      setFormData({
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

  // ✅ Real-time client-side search (same pattern as the Loans page)
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

  const itemsPerPage = 50;
  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedClients = filteredClients.slice(startIndex, endIndex);

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
      alert(`✅ ${res.data.message}`);
      bulk.clear();
      fetchClients();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Clients</h1>
          <p className="text-gray-600 mt-1">
            Total: <span className="font-semibold">{clients.length}</span>{" "}
            clients
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-lg hover:shadow-lg transition"
        >
          {showForm ? "✖ Cancel" : "+ Add Client"}
        </button>
      </div>

      {/* Search Bar (real-time, client-side) */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                🔍
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, phone, email, ID, or code..."
                className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          {searchTerm.trim() && (
            <button
              onClick={() => setSearchTerm("")}
              className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition"
            >
              ✖ Clear
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
                ✖
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
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

      {/* Add Client Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-md p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">
            Add New Client
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Business Name
                </label>
                <input
                  name="business_name"
                  value={formData.business_name}
                  onChange={handleInputChange}
                  placeholder="John's Shop"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none bg-white"
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
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
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
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
              >
                {submitting ? "Saving..." : "✓ Save Client"}
              </button>
            </div>
          </form>
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
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No clients match your search
          </h3>
          <p className="text-gray-500 mb-4">
            Try a different name, phone, email, ID, or code
          </p>
          <button
            onClick={() => setSearchTerm("")}
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            ✖ Clear Search
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
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
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Code
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Phone
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Email
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Business
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    City
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedClients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}/profile`)}
                    className={`border-b border-gray-100 hover:bg-indigo-50 transition cursor-pointer ${
                      bulk.isSelected(client.id) ? "bg-indigo-50" : ""
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
                    <td className="px-6 py-4 font-mono text-sm font-semibold text-indigo-600">
                      {client.client_code}
                    </td>
                    <td className="px-6 py-4 font-semibold text-gray-800">
                      {client.first_name} {client.last_name}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.phone_number}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.email || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.business_name || "-"}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {client.city || "-"}
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
                                ? "bg-indigo-600 text-white"
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
          className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          ⬇️ Export
        </button>

        <BulkMessaging
          clientIds={bulk.selectedArray}
          onComplete={bulk.clear}
        />

        <PermissionGate role={["admin", "manager"]}>
          <div className="border-l border-white/30 mx-1 h-6"></div>
          <button
            onClick={() => handleBulkStatus("active")}
            className="px-4 py-2 bg-green-500/30 hover:bg-green-500/50 rounded-lg text-sm font-semibold"
          >
            ✓ Activate
          </button>
          <button
            onClick={() => handleBulkStatus("inactive")}
            className="px-4 py-2 bg-yellow-500/30 hover:bg-yellow-500/50 rounded-lg text-sm font-semibold"
          >
            ⏸️ Deactivate
          </button>
          <button
            onClick={() => handleBulkStatus("blacklisted")}
            className="px-4 py-2 bg-red-500/30 hover:bg-red-500/50 rounded-lg text-sm font-semibold"
          >
            🚫 Blacklist
          </button>
        </PermissionGate>
      </BulkActionBar>
    </div>
  );
}

export default Clients;
