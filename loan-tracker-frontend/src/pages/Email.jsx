import React, { useState, useEffect } from "react";
import {
  Mail,
  Zap,
  AlertTriangle,
  ClipboardList,
  Paperclip,
  Check,
  X,
} from "lucide-react";
import api from "../services/api";
import { useSortableTable } from "../hooks/useSortableTable";
import SortableHeader from "../components/SortableHeader";

function Email() {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [emailForm, setEmailForm] = useState({ subject: "", message: "" });
  const [attachStatement, setAttachStatement] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    fetchData();
  }, []);

  // Reset to first page whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, statusFilter]);

  // silent = manual refresh: don't blank the page with the loading
  // screen, just toggle the Refresh button state.
  const fetchData = async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const [statsRes, logsRes, clientsRes] = await Promise.all([
        api.get("/email/stats"),
        api.get("/email/logs"),
        api.get("/clients?limit=10000"),
      ]);
      setStats(statsRes.data.data);
      setLogs(logsRes.data.data);
      setClients(clientsRes.data.data.filter((c) => c.email));
    } catch (err) {
      console.error("Failed to fetch email data:", err);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  const handleSendOverdueReminders = async () => {
    if (
      !window.confirm(
        "Send overdue reminder emails to all clients with overdue payments?",
      )
    )
      return;

    setSending(true);
    try {
      const response = await api.post("/email/send-overdue-reminders");
      alert(
        `Sent ${response.data.sent} emails, ${response.data.failed || 0} failed`,
      );
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  const handleSendCustom = async (e) => {
    e.preventDefault();
    if (
      !selectedClient ||
      !emailForm.subject.trim() ||
      !emailForm.message.trim()
    ) {
      alert("Please select a client and fill in the subject and message");
      return;
    }

    setSending(true);
    try {
      await api.post("/email/send", {
        client_id: selectedClient.id,
        subject: emailForm.subject,
        message: emailForm.message,
        attach_statement: attachStatement,
      });
      alert("Email sent successfully!");
      setShowCustomModal(false);
      setSelectedClient(null);
      setEmailForm({ subject: "", message: "" });
      setAttachStatement(false);
      setClientSearch("");
      fetchData();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  const filteredClients = clients.filter((c) => {
    if (!clientSearch) return true;
    const search = clientSearch.toLowerCase();
    return (
      c.first_name?.toLowerCase().includes(search) ||
      c.last_name?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.client_code?.toLowerCase().includes(search)
    );
  });

  // Filter logs (search + type + status)
  const filteredLogs = logs.filter((log) => {
    if (searchQuery.trim()) {
      const search = searchQuery.toLowerCase();
      const matches =
        log.first_name?.toLowerCase().includes(search) ||
        log.last_name?.toLowerCase().includes(search) ||
        log.recipient_email?.toLowerCase().includes(search) ||
        log.subject?.toLowerCase().includes(search) ||
        log.client_code?.toLowerCase().includes(search);
      if (!matches) return false;
    }

    if (typeFilter !== "all" && log.message_type !== typeFilter) {
      return false;
    }

    if (statusFilter !== "all" && log.status !== statusFilter) {
      return false;
    }

    return true;
  });

  // Sort then paginate
  const {
    sortedData: sortedLogs,
    requestSort,
    getSortIndicator,
  } = useSortableTable(filteredLogs, "created_at", "desc");

  // Pagination
  const totalPages = Math.ceil(sortedLogs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedLogs = sortedLogs.slice(startIndex, endIndex);

  // Filter counts for dropdowns
  const typeCounts = {
    all: logs.length,
    payment_received: logs.filter((l) => l.message_type === "payment_received")
      .length,
    overdue_reminder: logs.filter((l) => l.message_type === "overdue_reminder")
      .length,
    statement: logs.filter((l) => l.message_type === "statement").length,
    loan_agreement: logs.filter((l) => l.message_type === "loan_agreement")
      .length,
    custom: logs.filter((l) => l.message_type === "custom").length,
  };

  const statusCounts = {
    all: logs.length,
    sent: logs.filter((l) => l.status === "sent").length,
    failed: logs.filter((l) => l.status === "failed").length,
  };

  const filtersActive =
    searchQuery || typeFilter !== "all" || statusFilter !== "all";

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading email data...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            Email Notifications
          </h1>
          <p className="text-gray-600 mt-2">
            Send emails with PDF attachments and track delivery
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => fetchData({ silent: true })}
            disabled={refreshing || loading}
            className="px-5 py-3 bg-white border-2 border-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => setShowCustomModal(true)}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-ocean-700 text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-2"
          >
            <Mail size={16} /> Compose Email
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-ocean-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-blue-100 text-sm uppercase">Total Sent</p>
          <p className="text-3xl font-bold mt-2">{stats?.total_sent || 0}</p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-green-100 text-sm uppercase">Delivered</p>
          <p className="text-3xl font-bold mt-2">{stats?.successful || 0}</p>
        </div>
        <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-6">
          <p className="text-ocean-100 text-sm uppercase">With Attachments</p>
          <p className="text-3xl font-bold mt-2">
            {stats?.with_attachments || 0}
          </p>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-6">
          <p className="text-orange-100 text-sm uppercase">Last 30 Days</p>
          <p className="text-3xl font-bold mt-2">{stats?.last_30_days || 0}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Zap size={20} /> Quick Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={handleSendOverdueReminders}
            disabled={sending}
            className="p-6 bg-gradient-to-br from-red-500 to-orange-600 text-white rounded-xl shadow-md hover:shadow-lg transition text-left disabled:opacity-50"
          >
            <div className="mb-2"><AlertTriangle size={32} /></div>
            <h3 className="text-lg font-bold mb-1">Send Overdue Reminders</h3>
            <p className="text-sm text-white/80">
              Email all clients with overdue payments
            </p>
          </button>
          <button
            onClick={() => setShowCustomModal(true)}
            className="p-6 bg-ocean-gradient text-white rounded-xl shadow-md hover:shadow-lg transition text-left"
          >
            <div className="mb-2"><Mail size={32} /></div>
            <h3 className="text-lg font-bold mb-1">Compose Email</h3>
            <p className="text-sm text-white/80">
              Send a personalized email, optionally with a statement
            </p>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[250px]">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or subject..."
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>

          {/* Type Filter */}
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Email Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
            >
              <option value="all">All ({typeCounts.all})</option>
              <option value="payment_received">
                Payment Received ({typeCounts.payment_received})
              </option>
              <option value="overdue_reminder">
                Overdue Reminder ({typeCounts.overdue_reminder})
              </option>
              <option value="statement">
                Statement ({typeCounts.statement})
              </option>
              <option value="loan_agreement">
                Loan Agreement ({typeCounts.loan_agreement})
              </option>
              <option value="custom">
                Custom ({typeCounts.custom})
              </option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="min-w-[150px]">
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
            >
              <option value="all">All ({statusCounts.all})</option>
              <option value="sent">Sent ({statusCounts.sent})</option>
              <option value="failed">
                Failed ({statusCounts.failed})
              </option>
            </select>
          </div>

          {/* Clear Button */}
          {filtersActive && (
            <button
              onClick={() => {
                setSearchQuery("");
                setTypeFilter("all");
                setStatusFilter("all");
              }}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition inline-flex items-center gap-1"
            >
              <X size={16} /> Clear
            </button>
          )}
        </div>

        {/* Active Filter Tags */}
        {filtersActive && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600">Filters:</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                  "{searchQuery}"
                  <button
                    onClick={() => setSearchQuery("")}
                    className="ml-1"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {typeFilter !== "all" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
                  {typeFilter}
                  <button
                    onClick={() => setTypeFilter("all")}
                    className="ml-1"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {statusFilter !== "all" && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                  {statusFilter}
                  <button
                    onClick={() => setStatusFilter("all")}
                    className="ml-1"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
            <span className="text-sm text-gray-600">
              Showing <strong>{filteredLogs.length}</strong> of{" "}
              <strong>{logs.length}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Email Logs */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><ClipboardList size={20} /> Email History</h2>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-500px)]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10 border-b-2 border-gray-200 shadow-sm">
              <tr>
                {[
                  ["Date", "created_at"],
                  ["Recipient", "recipient_email"],
                  ["Subject", "subject"],
                  ["Type", "email_type"],
                  ["Attachment", "has_attachment"],
                  ["Status", "status"],
                ].map(([label, key]) => (
                  <SortableHeader
                    key={key}
                    label={label}
                    sortKey={key}
                    requestSort={requestSort}
                    getSortIndicator={getSortIndicator}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan="6"
                    className="px-4 py-12 text-center text-gray-500"
                  >
                    {logs.length === 0
                      ? "No emails sent yet"
                      : "No emails match your filters"}
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800 text-sm">
                        {log.first_name} {log.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {log.recipient_email}
                      </p>
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate"
                      title={log.subject}
                    >
                      {log.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                          log.message_type === "overdue_reminder"
                            ? "bg-red-100 text-red-700"
                            : log.message_type === "payment_received"
                              ? "bg-green-100 text-green-700"
                              : log.message_type === "statement" ||
                                  log.message_type === "loan_agreement"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {log.message_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {log.has_attachment ? (
                        <span title={log.attachment_name} className="inline-flex items-center gap-1">
                          <Paperclip size={14} /> {log.attachment_name}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                          log.status === "sent"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {log.status === "sent" ? (
                          <span className="inline-flex items-center gap-1"><Check size={12} /> Sent</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><X size={12} /> Failed</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Showing{" "}
              <span className="font-semibold">{startIndex + 1}</span> to{" "}
              <span className="font-semibold">
                {Math.min(endIndex, filteredLogs.length)}
              </span>{" "}
              of{" "}
              <span className="font-semibold">{filteredLogs.length}</span>{" "}
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

      {/* Compose Email Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-800 mb-6">
              Compose Email
            </h3>

            <form onSubmit={handleSendCustom} className="space-y-4">
              {/* Client Search */}
              <div className="relative">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Recipient *
                </label>
                {selectedClient ? (
                  <div className="flex items-center justify-between p-3 bg-ocean-50 border-2 border-ocean-300 rounded-lg">
                    <div>
                      <p className="font-semibold text-ocean-900">
                        {selectedClient.first_name} {selectedClient.last_name}
                      </p>
                      <p className="text-sm text-ocean-700">
                        {selectedClient.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClient(null);
                        setClientSearch("");
                      }}
                      className="text-red-600 hover:text-red-800 font-bold"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setShowClientDropdown(true);
                      }}
                      onFocus={() => setShowClientDropdown(true)}
                      placeholder="Search by name or email..."
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                    {showClientDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredClients.length === 0 ? (
                          <div className="p-3 text-sm text-gray-500">
                            No clients with an email address
                          </div>
                        ) : (
                          filteredClients.slice(0, 20).map((client) => (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => {
                                setSelectedClient(client);
                                setClientSearch("");
                                setShowClientDropdown(false);
                              }}
                              className="w-full text-left p-3 hover:bg-ocean-50 border-b border-gray-100"
                            >
                              <p className="font-semibold">
                                {client.first_name} {client.last_name}
                              </p>
                              <p className="text-sm text-gray-500">
                                {client.email} • {client.client_code}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  value={emailForm.subject}
                  onChange={(e) =>
                    setEmailForm({ ...emailForm, subject: e.target.value })
                  }
                  placeholder="Email subject..."
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Message *
                </label>
                <textarea
                  value={emailForm.message}
                  onChange={(e) =>
                    setEmailForm({ ...emailForm, message: e.target.value })
                  }
                  rows="8"
                  placeholder="Type your message..."
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              {/* Attach statement */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={attachStatement}
                  onChange={(e) => setAttachStatement(e.target.checked)}
                  className="w-4 h-4"
                />
                <Paperclip size={14} /> Attach account statement (PDF)
              </label>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  disabled={sending}
                  className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !selectedClient ||
                    !emailForm.subject.trim() ||
                    !emailForm.message.trim()
                  }
                  className="px-6 py-2 bg-gradient-to-r from-blue-600 to-ocean-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {sending ? "Sending..." : <><Mail size={16} /> Send Email</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Email;
