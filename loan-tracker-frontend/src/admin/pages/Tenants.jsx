import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { useSortableTable } from "../../hooks/useSortableTable";
import SortableHeader from "../../components/SortableHeader";
import { Building2, Search } from "lucide-react";
import Spinner from "../../components/Spinner";

// Full KES figures (no K abbreviation) — e.g. KES 2,000,000, not 2.0K.
const K = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

function PlatformTenants() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (statusFilter !== "all") p.append("status", statusFilter);
    if (search) p.append("search", search);
    platformApi
      .get(`/platform/admin/tenants?${p}`)
      .then((r) => setTenants(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  // Sort the current server response client-side. Server-side
  // filtering means sorting reorders only what's already loaded —
  // good enough for the platform admin view (small tenant counts).
  const {
    sortedData: sortedTenants,
    requestSort,
    getSortIndicator,
  } = useSortableTable(tenants, "created_at", "desc");

  const updateStatus = async (tenant, newStatus) => {
    let reason = null;
    if (newStatus === "suspended") {
      reason = window.prompt("Reason for suspension?");
      if (!reason) return;
    }
    if (
      !window.confirm(
        `Change ${tenant.business_name} status to ${newStatus}?`,
      )
    )
      return;
    try {
      await platformApi.put(`/platform/admin/tenants/${tenant.id}/status`, {
        status: newStatus,
        reason,
      });
      alert("Status updated");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update status");
    }
  };

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Building2 size={28} className="text-gray-700" /> All Tenants
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          Manage all lenders on your platform
        </p>

        <div className="bg-white rounded-xl shadow p-4 mb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, subdomain, or code…"
              className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 bg-white focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl p-12">
            <Spinner centered label="Loading…" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            No tenants found.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <SortableHeader
                      label="Tenant"
                      sortKey="business_name"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      className="text-left p-3"
                    />
                    <SortableHeader
                      label="Subdomain"
                      sortKey="subdomain"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      className="text-left p-3 hidden lg:table-cell"
                    />
                    <SortableHeader
                      label="Clients"
                      sortKey="client_count"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="right"
                      className="text-right p-3"
                    />
                    <SortableHeader
                      label="Loans"
                      sortKey="loan_count"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="right"
                      className="text-right p-3 hidden lg:table-cell"
                    />
                    <SortableHeader
                      label="Disbursed"
                      sortKey="total_disbursed"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="right"
                      className="text-right p-3 hidden lg:table-cell"
                    />
                    <SortableHeader
                      label="Status"
                      sortKey="status"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="center"
                      className="text-center p-3"
                    />
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTenants.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                            style={{
                              backgroundColor: t.brand_color || "#0e8a6e",
                            }}
                          >
                            {t.business_name?.charAt(0)}
                          </div>
                          <div>
                            <p className="font-semibold">
                              {t.business_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {t.tenant_code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        <p className="font-mono text-xs">{t.subdomain}</p>
                      </td>
                      <td className="text-right p-3 font-semibold">
                        {t.client_count}
                      </td>
                      <td className="text-right p-3 hidden lg:table-cell">
                        {t.loan_count}
                      </td>
                      <td className="text-right p-3 hidden lg:table-cell font-bold">
                        {K(t.total_disbursed)}
                      </td>
                      <td className="text-center p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            t.status === "active"
                              ? "bg-green-100 text-green-700"
                              : t.status === "trial"
                                ? "bg-yellow-100 text-yellow-700"
                                : t.status === "suspended"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="text-right p-3 whitespace-nowrap">
                        <button
                          onClick={() =>
                            navigate(`/admin/tenants/${t.id}`)
                          }
                          className="px-3 py-1 bg-ocean-50 text-ocean-600 rounded text-xs font-semibold hover:bg-ocean-100"
                        >
                          View
                        </button>
                        {t.id !== 1 && t.status === "active" && (
                          <button
                            onClick={() => updateStatus(t, "suspended")}
                            className="ml-1 px-3 py-1 bg-red-50 text-red-600 rounded text-xs font-semibold hover:bg-red-100"
                          >
                            Suspend
                          </button>
                        )}
                        {t.id !== 1 && t.status === "suspended" && (
                          <button
                            onClick={() => updateStatus(t, "active")}
                            className="ml-1 px-3 py-1 bg-green-50 text-green-600 rounded text-xs font-semibold hover:bg-green-100"
                          >
                            Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}

export default PlatformTenants;
