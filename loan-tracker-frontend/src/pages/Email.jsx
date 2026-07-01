import React, { useState, useEffect } from "react";
import {
  Mail,
  Zap,
  AlertTriangle,
  ClipboardList,
  Paperclip,
  Check,
  X,
  Send,
  CheckCircle,
  Clock,
  Sparkles,
  Bell,
  ArrowUpRight,
  RefreshCcw,
} from "lucide-react";
import api from "../services/api";
import { useSortableTable } from "../hooks/useSortableTable";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton, { SkeletonText } from "../components/Skeleton";
import DataTable from "../components/DataTable";
import SegmentBar from "../components/SegmentBar";
import {
  useColumnPreset,
  useFilterSegments,
} from "../hooks/useTablePrefs";
import { MailX } from "lucide-react";

// ── Email log table column model ─────────────────────────────────────
// Column-driven so the desktop log table can offer client-side presets
// (which columns show in the row) and demote the rest into an expandable
// detail row. Recipient is pinned (sticky). Each cell() carries the EXACT
// rendering — including dark variants — from the prior table.
const EMAIL_COLUMNS = [
  {
    key: "created_at",
    label: "Date",
    align: "left",
    cell: (log) => (
      <span className="text-sm text-gray-600 dark:text-slate-400">
        {new Date(log.created_at).toLocaleString("en-GB")}
      </span>
    ),
  },
  {
    key: "subject",
    label: "Subject",
    align: "left",
    fullSpan: true,
    cell: (log) => (
      <p
        className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap break-words"
        title={log.subject}
      >
        {log.subject}
      </p>
    ),
  },
  {
    key: "message_type",
    label: "Type",
    align: "left",
    cell: (log) => (
      <span
        className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
          log.message_type === "overdue_reminder"
            ? "bg-red-100 text-red-700"
            : log.message_type === "payment_received"
              ? "bg-green-100 text-green-700"
              : log.message_type === "statement" ||
                  log.message_type === "loan_agreement"
                ? "bg-amber-100 text-amber-700"
                : "bg-ocean-100 text-ocean-700"
        }`}
      >
        {log.message_type}
      </span>
    ),
  },
  {
    key: "has_attachment",
    label: "Attachment",
    align: "left",
    cell: (log) => (
      <span className="text-sm text-gray-700 dark:text-slate-200">
        {log.has_attachment ? (
          <span title={log.attachment_name} className="inline-flex items-center gap-1">
            <Paperclip size={14} /> {log.attachment_name}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-slate-400">—</span>
        )}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    align: "left",
    cell: (log) => (
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
    ),
  },
];

// Column presets — which keys render in the row. The pinned Recipient
// column is always shown outside this set; anything not listed drops into
// the expandable detail row, so no data is ever hidden — just demoted.
const COLUMN_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["created_at", "message_type", "status"],
  },
  detailed: {
    label: "Detailed",
    keys: ["created_at", "subject", "message_type", "has_attachment", "status"],
  },
  full: {
    label: "Everything",
    keys: EMAIL_COLUMNS.map((c) => c.key),
  },
};

const PRESET_STORAGE_KEY = "email.columnPreset";
const SEGMENTS_STORAGE_KEY = "email.segments";

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
    "detailed",
  );
  const { segments, saveSegment, deleteSegment } =
    useFilterSegments(SEGMENTS_STORAGE_KEY);

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

  // Filter counts for dropdowns. Covers every message_type the
  // notificationDispatcher writes plus the manual "statement" /
  // "loan_agreement" / "custom" buckets used elsewhere.
  const countByType = (t) =>
    logs.filter((l) => l.message_type === t).length;
  const typeCounts = {
    all: logs.length,
    application_submitted: countByType("application_submitted"),
    application_under_review: countByType("application_under_review"),
    application_approved: countByType("application_approved"),
    application_rejected: countByType("application_rejected"),
    counter_offered: countByType("counter_offered"),
    loan_disbursed: countByType("loan_disbursed"),
    payment_received: countByType("payment_received"),
    reminder: countByType("reminder"),
    overdue_reminder: countByType("overdue_reminder"),
    loan_completed: countByType("loan_completed"),
    statement: countByType("statement"),
    loan_agreement: countByType("loan_agreement"),
    custom: countByType("custom"),
  };

  const statusCounts = {
    all: logs.length,
    sent: logs.filter((l) => l.status === "sent").length,
    failed: logs.filter((l) => l.status === "failed").length,
  };

  const filtersActive =
    searchQuery || typeFilter !== "all" || statusFilter !== "all";

  // ── Saved filter segments (localStorage only, via shared hook) ─
  const handleSaveSegment = () => {
    const name = window.prompt("Name this segment (e.g. Statements sent)");
    if (!name) return;
    saveSegment(name, { searchQuery, typeFilter, statusFilter });
  };
  const applySegment = (segment) => {
    const snap = segment.snapshot || {};
    setSearchQuery(snap.searchQuery || "");
    setTypeFilter(snap.typeFilter || "all");
    setStatusFilter(snap.statusFilter || "all");
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div className="space-y-3">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-11 w-44" rounded="rounded-xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" rounded="rounded-2xl" />
          ))}
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────── */}
      <PageHeader
        icon={Mail}
        title="Email Notifications"
        subtitle="The inbox-side of every conversation. Send statements, receipts and reminders — with PDFs attached when it counts — and watch each message clear the queue."
        className="mb-10"
        actions={
          <>
            <button
              onClick={() => fetchData({ silent: true })}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-surface border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCcw
                size={16}
                className={refreshing ? "animate-spin" : ""}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={() => setShowCustomModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-gradient text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition"
            >
              <Mail size={16} /> Compose Email
              <ArrowUpRight size={14} className="opacity-70" />
            </button>
          </>
        }
      />

      {/* ── Stat cards — frosted-glass pastel with corner icon ──── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-ocean-100/70 via-white/55 to-ocean-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-ocean-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-ocean-700">
              Total Sent
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Send size={16} className="text-ocean-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {(stats?.total_sent || 0).toLocaleString("en-GB")}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            across all email types
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-emerald-100/70 via-white/55 to-green-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-emerald-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-emerald-700">
              Delivered
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <CheckCircle size={16} className="text-emerald-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {(stats?.successful || 0).toLocaleString("en-GB")}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            {stats?.total_sent
              ? `${((stats.successful / stats.total_sent) * 100).toFixed(1)}% delivery rate`
              : "no emails yet"}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-ocean-100/70 via-white/55 to-violet-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-ocean-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-ocean-700">
              With Attachments
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Paperclip size={16} className="text-ocean-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {(stats?.with_attachments || 0).toLocaleString("en-GB")}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            statements, receipts, agreements
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-ocean-100/70 via-white/55 to-ocean-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-ocean-300/25 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-ocean-700">
              Last 30 Days
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Clock size={16} className="text-ocean-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-navy-900 mt-3">
            {(stats?.last_30_days || 0).toLocaleString("en-GB")}
          </p>
          <p className="relative text-xs text-slate-500 mt-1">
            rolling 30-day window
          </p>
        </div>
      </div>

      {/* ── Quick actions — parent card with two action tiles ───── */}
      <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 mb-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-ocean-50 flex items-center justify-center">
            <Sparkles size={18} className="text-ocean-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-navy-900 dark:text-slate-100">Quick actions</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Compose, attach, send — without leaving the room.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={handleSendOverdueReminders}
            disabled={sending}
            className="group relative text-left p-5 rounded-xl border border-rose-100 bg-rose-50/40 hover:bg-rose-50 hover:border-rose-200 transition disabled:opacity-50"
          >
            <div className="absolute top-4 right-4 text-rose-400 group-hover:text-rose-600 transition">
              <ArrowUpRight size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center mb-4">
              <AlertTriangle size={20} className="text-rose-600" />
            </div>
            <h3 className="font-semibold text-navy-900 mb-1">
              Send overdue reminders
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Email every client with an outstanding balance in a single,
              considered push.
            </p>
            <p className="text-xs mt-3 text-rose-600 font-medium inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Bulk email to overdue clients
            </p>
          </button>

          <button
            onClick={() => setShowCustomModal(true)}
            className="group relative text-left p-5 rounded-xl border border-ocean-100 bg-ocean-50/40 hover:bg-ocean-50 hover:border-ocean-200 transition"
          >
            <div className="absolute top-4 right-4 text-ocean-400 group-hover:text-ocean-600 transition">
              <ArrowUpRight size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-ocean-100 flex items-center justify-center mb-4">
              <Bell size={20} className="text-ocean-600" />
            </div>
            <h3 className="font-semibold text-navy-900 mb-1">
              Compose email
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Write a personal note. Attach a statement, receipt or agreement
              if it helps the conversation.
            </p>
            <p className="text-xs mt-3 text-ocean-600 font-medium inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ocean-500" />
              One-to-one email with attachment
            </p>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-xl shadow-md p-6 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[250px]">
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase mb-1">
              Search
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or subject..."
              className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
          </div>

          {/* Type Filter */}
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase mb-1">
              Email Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
            >
              <option value="all">All ({typeCounts.all})</option>
              <option value="application_submitted">
                Application Submitted ({typeCounts.application_submitted})
              </option>
              <option value="application_under_review">
                Under Review ({typeCounts.application_under_review})
              </option>
              <option value="application_approved">
                Approved ({typeCounts.application_approved})
              </option>
              <option value="application_rejected">
                Rejected ({typeCounts.application_rejected})
              </option>
              <option value="counter_offered">
                Counter Offered ({typeCounts.counter_offered})
              </option>
              <option value="loan_disbursed">
                Disbursed ({typeCounts.loan_disbursed})
              </option>
              <option value="payment_received">
                Payment Received ({typeCounts.payment_received})
              </option>
              <option value="reminder">
                Payment Reminder ({typeCounts.reminder})
              </option>
              <option value="overdue_reminder">
                Overdue Reminder ({typeCounts.overdue_reminder})
              </option>
              <option value="loan_completed">
                Loan Completed ({typeCounts.loan_completed})
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
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
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
              className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold rounded-lg transition inline-flex items-center gap-1"
            >
              <X size={16} /> Clear
            </button>
          )}
        </div>

        {/* Saved segments — named search + filter snapshots (shared
            SegmentBar; localStorage only, never server-side). */}
        <SegmentBar
          className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700"
          segments={segments}
          onApply={applySegment}
          onDelete={deleteSegment}
          onSave={handleSaveSegment}
          canSave={filtersActive}
        />

        {/* Active Filter Tags */}
        {filtersActive && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600 dark:text-slate-400">Filters:</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-100 text-ocean-700 rounded-full text-xs font-semibold">
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
            <span className="text-sm text-gray-600 dark:text-slate-400">
              Showing <strong>{filteredLogs.length}</strong> of{" "}
              <strong>{logs.length}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Email Logs */}
      <div className="bg-surface rounded-xl shadow-md overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2"><ClipboardList size={20} /> Email History</h2>
        </div>
        {/* Desktop — shared DataTable (column presets, expandable rows,
            sticky pinned Recipient, skeleton, scroll affordance). */}
        <DataTable
          columns={EMAIL_COLUMNS}
          rows={paginatedLogs}
          rowKey={(log) => log.id}
          pinned={{
            label: "Recipient",
            sortKey: "recipient_email",
            cell: (log) => (
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100 text-sm">
                  {log.first_name} {log.last_name}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {log.recipient_email}
                </p>
              </div>
            ),
          }}
          presets={COLUMN_PRESETS}
          preset={columnPreset}
          onPresetChange={setColumnPreset}
          expandedRows={expandedRows}
          onToggleRow={toggleRow}
          sort={{ requestSort, getSortIndicator }}
          loading={loading}
          skeletonRows={8}
          skeletonCols={6}
          empty={
            logs.length === 0 ? (
              <EmptyState
                icon={MailX}
                title="No emails sent yet"
                description="Send overdue reminders or compose an email — every message you send will appear here."
                action={
                  <button
                    onClick={() => setShowCustomModal(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-gradient text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition"
                  >
                    <Mail size={16} /> Compose Email
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={MailX}
                title="No emails match your filters"
                description="Try adjusting your search or clearing the filters above."
                tone="muted"
              />
            )
          }
        />

        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-gray-50 dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700">
            <div className="text-sm text-gray-600 dark:text-slate-400">
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

      {/* Compose Email Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-800 dark:text-slate-100 mb-6">
              Compose Email
            </h3>

            <form onSubmit={handleSendCustom} className="space-y-4">
              {/* Client Search */}
              <div className="relative">
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
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
                      className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                    {showClientDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-surface border-2 border-gray-200 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredClients.length === 0 ? (
                          <div className="p-3 text-sm text-gray-500 dark:text-slate-400">
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
                              className="w-full text-left p-3 hover:bg-ocean-50 dark:hover:bg-slate-700 border-b border-gray-100 dark:border-slate-700"
                            >
                              <p className="font-semibold">
                                {client.first_name} {client.last_name}
                              </p>
                              <p className="text-sm text-gray-500 dark:text-slate-400">
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
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
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
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              {/* Message */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
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
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>

              {/* Attach statement */}
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
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
                  className="px-6 py-2 bg-gradient-to-r from-ocean-600 to-ocean-700 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
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
