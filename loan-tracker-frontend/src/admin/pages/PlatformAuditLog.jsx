import React, { useEffect, useState } from "react";
import PlatformLayout from "../components/PlatformLayout";
import platformApi from "../services/platformApi";

// Cross-tenant audit log for platform admins. Backed by
// /api/platform/audit (different from the tenant-scoped /api/audit
// used by staff pages/AuditLog.jsx).

const CATEGORY_ICONS = {
  auth: "🔐",
  client: "👤",
  loan: "💰",
  payment: "💳",
  application: "📝",
  tenant: "🏢",
  user: "👨‍💼",
  billing: "📄",
  settings: "⚙️",
  messaging: "✉️",
  capital: "🏦",
  backup: "💾",
  system: "🤖",
};

const SEVERITY_BADGE = {
  info: "bg-blue-100 text-blue-700",
  warning: "bg-yellow-100 text-yellow-700",
  critical: "bg-red-100 text-red-700",
};

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}

function PlatformAuditLog() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    tenant_id: "",
    category: "",
    severity: "",
    search: "",
  });
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

  // Tenants for the dropdown — loaded once
  useEffect(() => {
    platformApi
      .get("/platform/audit/tenants")
      .then((r) => setTenants(r.data.data || []))
      .catch(() => {});
  }, []);

  // Logs + summary — refetched when filters/page change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: pagination.page,
          limit: 50,
          ...(filters.tenant_id && { tenant_id: filters.tenant_id }),
          ...(filters.category && { category: filters.category }),
          ...(filters.severity && { severity: filters.severity }),
          ...(filters.search && { search: filters.search }),
        });
        const [l, s] = await Promise.all([
          platformApi.get(`/platform/audit?${params}`),
          platformApi.get(`/platform/audit/summary`),
        ]);
        if (cancelled) return;
        setLogs(l.data.data);
        setPagination(l.data.pagination);
        setSummary(s.data.data.summary);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pagination.page]);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
          📊 Audit Log
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          Every action across every tenant — staff, platform, system.
        </p>

        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <Card label="Today" value={summary.today_events} color="indigo" />
            <Card label="Total" value={summary.total_events} />
            <Card label="Critical" value={summary.critical_events} color="red" />
            <Card label="Warnings" value={summary.warning_events} color="yellow" />
            <Card label="Failed Logins" value={summary.failed_logins} color="red" />
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="🔍 Search descriptions / users / entities"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500"
            />
            <select
              value={filters.tenant_id}
              onChange={(e) =>
                setFilters({ ...filters, tenant_id: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white"
            >
              <option value="">All Tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  🏢 {t.business_name}
                </option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters({ ...filters, category: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white"
            >
              <option value="">All Categories</option>
              {Object.entries(CATEGORY_ICONS).map(([k, ic]) => (
                <option key={k} value={k}>
                  {ic} {k}
                </option>
              ))}
            </select>
            <select
              value={filters.severity}
              onChange={(e) =>
                setFilters({ ...filters, severity: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 rounded-lg bg-white"
            >
              <option value="">All Severities</option>
              <option value="info">ℹ️ Info</option>
              <option value="warning">⚠️ Warning</option>
              <option value="critical">🔴 Critical</option>
            </select>
          </div>
        </div>

        {/* Log list */}
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <p className="text-5xl mb-3">📋</p>
            <p className="text-gray-500">No matching log entries.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="divide-y">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">
                      {CATEGORY_ICONS[log.action_category] || "📋"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-gray-800 break-words">
                          {log.description || log.action}
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${SEVERITY_BADGE[log.severity] || SEVERITY_BADGE.info}`}
                        >
                          {log.severity || "info"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                        <span>👤 {log.user_name || "System"}</span>
                        {log.user_role && <span>• {log.user_role}</span>}
                        {log.is_platform_admin && (
                          <span className="text-purple-600 font-semibold">
                            • 🛡️ platform
                          </span>
                        )}
                        {log.tenant_name && (
                          <span>• 🏢 {log.tenant_name}</span>
                        )}
                        <span>• {timeAgo(log.created_at)}</span>
                        {log.ip_address && log.ip_address !== "unknown" && (
                          <span>• 📍 {log.ip_address}</span>
                        )}
                      </div>
                      {(log.old_values || log.new_values || log.metadata) && (
                        <details className="mt-2">
                          <summary className="text-xs text-indigo-600 cursor-pointer">
                            details
                          </summary>
                          <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto">
                            {JSON.stringify(
                              {
                                ...(log.old_values && { before: log.old_values }),
                                ...(log.new_values && { after: log.new_values }),
                                ...(log.metadata && { metadata: log.metadata }),
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pagination.pages > 1 && (
              <div className="p-4 border-t flex justify-between items-center">
                <p className="text-sm text-gray-500">
                  Page {pagination.page} of {pagination.pages} ·{" "}
                  {pagination.total} total
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page - 1 }))
                    }
                    disabled={pagination.page === 1}
                    className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page + 1 }))
                    }
                    disabled={pagination.page === pagination.pages}
                    className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}

function Card({ label, value, color = "gray" }) {
  const text = {
    indigo: "text-indigo-600",
    red: "text-red-600",
    yellow: "text-yellow-600",
    gray: "text-gray-800",
  }[color];
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className={`text-2xl font-bold ${text}`}>{value ?? 0}</p>
    </div>
  );
}

export default PlatformAuditLog;
