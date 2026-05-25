import React, { useState, useEffect } from "react";
import {
  Search,
  Download,
  Pencil,
  Trash2,
  RotateCcw,
  LockOpen,
  Ban,
  Lock,
  Coins,
  Smartphone,
  Mail,
  Landmark,
  BarChart3,
  FileText,
  Sparkles,
  Upload,
  Info,
  X,
} from "lucide-react";
import api from "../services/api";

function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filters, setFilters] = useState({
    action: "all",
    entity_type: "all",
    date_from: "",
    date_to: "",
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Detail modal
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchQuery]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [logsRes, statsRes] = await Promise.all([
        api.get("/audit"),
        api.get("/audit/stats"),
      ]);
      setLogs(logsRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error("Failed to fetch audit data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.date_from) params.append("date_from", filters.date_from);
      if (filters.date_to) params.append("date_to", filters.date_to);

      const response = await api.get(`/audit/export?${params}`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit_logs_${new Date().toISOString().split("T")[0]}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    }
  };

  // Filter logs client-side
  const filteredLogs = logs.filter((log) => {
    if (filters.action !== "all" && log.action !== filters.action) return false;
    if (filters.entity_type !== "all" && log.entity_type !== filters.entity_type)
      return false;
    if (filters.date_from && new Date(log.created_at) < new Date(filters.date_from))
      return false;
    if (
      filters.date_to &&
      new Date(log.created_at) > new Date(filters.date_to + "T23:59:59")
    )
      return false;

    if (searchQuery.trim()) {
      const search = searchQuery.toLowerCase();
      if (
        !(
          log.description?.toLowerCase().includes(search) ||
          log.entity_code?.toLowerCase().includes(search) ||
          log.user_name?.toLowerCase().includes(search) ||
          log.user_email?.toLowerCase().includes(search)
        )
      )
        return false;
    }

    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedLogs = filteredLogs.slice(
    startIndex,
    startIndex + itemsPerPage,
  );

  // Action badges
  const getActionBadge = (action) => {
    const styles = {
      created: "bg-green-100 text-green-700",
      updated: "bg-blue-100 text-blue-700",
      deleted: "bg-red-100 text-red-700",
      status_changed: "bg-ocean-100 text-ocean-700",
      login: "bg-ocean-100 text-ocean-700",
      login_failed: "bg-red-100 text-red-700",
      logout: "bg-gray-100 text-gray-700",
      payment_recorded: "bg-emerald-100 text-emerald-700",
      refund_processed: "bg-ocean-100 text-ocean-700",
      sms_sent: "bg-blue-100 text-blue-700",
      email_sent: "bg-cyan-100 text-cyan-700",
      capital_adjusted: "bg-yellow-100 text-yellow-700",
      report_exported: "bg-pink-100 text-pink-700",
    };
    return styles[action] || "bg-gray-100 text-gray-700";
  };

  const getActionIcon = (action) => {
    const icons = {
      created: <Sparkles size={12} />,
      updated: <Pencil size={12} />,
      deleted: <Trash2 size={12} />,
      status_changed: <RotateCcw size={12} />,
      login: <LockOpen size={12} />,
      login_failed: <Ban size={12} />,
      logout: <Lock size={12} />,
      payment_recorded: <Coins size={12} />,
      refund_processed: <Coins size={12} />,
      sms_sent: <Smartphone size={12} />,
      email_sent: <Mail size={12} />,
      capital_adjusted: <Landmark size={12} />,
      report_exported: <BarChart3 size={12} />,
    };
    return icons[action] || <FileText size={12} />;
  };

  const renderJson = (value) => {
    if (value == null) return null;
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(value);
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading audit logs...</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2"><Search size={28} /> Audit Log</h1>
          <p className="text-gray-600 mt-2">
            Track all system activity and changes
          </p>
        </div>
        <button
          onClick={handleExport}
          className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-2"
        >
          <Download size={16} /> Export Excel
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-6">
          <p className="text-ocean-100 text-sm uppercase">Total Logs</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.totals?.total_logs || 0}
          </p>
        </div>
        <div className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-blue-100 text-sm uppercase">Today</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.totals?.today_count || 0}
          </p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-green-100 text-sm uppercase">Last 7 Days</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.totals?.week_count || 0}
          </p>
        </div>
        <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-6">
          <p className="text-ocean-100 text-sm uppercase">Active Users</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.totals?.unique_users || 0}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search descriptions, codes, users..."
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Action
            </label>
            <select
              value={filters.action}
              onChange={(e) =>
                setFilters({ ...filters, action: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
            >
              <option value="all">All Actions</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="deleted">Deleted</option>
              <option value="status_changed">Status Changed</option>
              <option value="login">Login</option>
              <option value="login_failed">Failed Login</option>
              <option value="payment_recorded">Payment Recorded</option>
              <option value="refund_processed">Refund Processed</option>
              <option value="capital_adjusted">Capital Adjusted</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Entity
            </label>
            <select
              value={filters.entity_type}
              onChange={(e) =>
                setFilters({ ...filters, entity_type: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
            >
              <option value="all">All Entities</option>
              <option value="client">Client</option>
              <option value="loan">Loan</option>
              <option value="transaction">Transaction</option>
              <option value="user">User</option>
              <option value="capital_pool">Capital Pool</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              From
            </label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) =>
                setFilters({ ...filters, date_from: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              To
            </label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) =>
                setFilters({ ...filters, date_to: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-450px)]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Date/Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Entity
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-12 text-center text-gray-500">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-semibold text-gray-800">
                        {log.user_name || "System"}
                      </p>
                      <p className="text-xs text-gray-500">{log.user_email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${getActionBadge(
                          log.action,
                        )}`}
                      >
                        {getActionIcon(log.action)} {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="text-gray-700 capitalize">
                        {log.entity_type}
                      </p>
                      {log.entity_code && (
                        <p className="text-xs text-ocean-600 font-mono">
                          {log.entity_code}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-md">
                      {log.description}
                    </td>
                    <td className="px-4 py-3">
                      {(log.old_values || log.new_values || log.metadata) && (
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="text-ocean-600 hover:text-ocean-800 text-sm"
                        >
                          View Changes →
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center p-4 bg-gray-50 border-t">
            <span className="text-sm text-gray-600">
              Showing{" "}
              <strong>
                {startIndex + 1}-
                {Math.min(startIndex + itemsPerPage, filteredLogs.length)}
              </strong>{" "}
              of <strong>{filteredLogs.length}</strong>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 bg-white border rounded disabled:opacity-50"
              >
                ← Previous
              </button>
              <span className="px-3 py-1 bg-ocean-600 text-white rounded font-semibold">
                {currentPage} of {totalPages}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage === totalPages}
                className="px-3 py-1 bg-white border rounded disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold text-gray-800">
                  Audit Details
                </h3>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={22} />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Date/Time</p>
                  <p className="font-semibold">
                    {new Date(selectedLog.created_at).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">User</p>
                  <p className="font-semibold">
                    {selectedLog.user_name} ({selectedLog.user_email})
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Action</p>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getActionBadge(
                      selectedLog.action,
                    )}`}
                  >
                    {getActionIcon(selectedLog.action)} {selectedLog.action}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Entity</p>
                  <p className="font-semibold capitalize">
                    {selectedLog.entity_type}{" "}
                    {selectedLog.entity_code &&
                      `(${selectedLog.entity_code})`}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">IP Address</p>
                  <p className="font-mono text-sm">
                    {selectedLog.ip_address}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Description</p>
                  <p>{selectedLog.description}</p>
                </div>
              </div>

              {selectedLog.old_values && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                    <Upload size={14} /> Old Values:
                  </p>
                  <pre className="bg-red-50 p-3 rounded-lg text-xs overflow-x-auto">
                    {renderJson(selectedLog.old_values)}
                  </pre>
                </div>
              )}

              {selectedLog.new_values && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                    <Download size={14} /> New Values:
                  </p>
                  <pre className="bg-green-50 p-3 rounded-lg text-xs overflow-x-auto">
                    {renderJson(selectedLog.new_values)}
                  </pre>
                </div>
              )}

              {selectedLog.metadata && (
                <div className="mt-4">
                  <p className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1">
                    <Info size={14} /> Metadata:
                  </p>
                  <pre className="bg-blue-50 p-3 rounded-lg text-xs overflow-x-auto">
                    {renderJson(selectedLog.metadata)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuditLog;
