import React, { useEffect, useState } from "react";
import PlatformLayout from "../components/PlatformLayout";
import platformApi from "../services/platformApi";
import {
  BarChart3,
  User,
  Coins,
  CreditCard,
  FileText,
  Building2,
  Users,
  Mail,
  Settings,
  Landmark,
  HardDrive,
  Bot,
  Search,
  ClipboardList,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";

// Cross-tenant audit log for platform admins. Backed by
// /api/platform/audit (different from the tenant-scoped /api/audit
// used by staff pages/AuditLog.jsx).

const CATEGORY_ICON_MAP = {
  auth: ShieldCheck,
  client: User,
  loan: Coins,
  payment: CreditCard,
  application: FileText,
  tenant: Building2,
  user: Users,
  billing: FileText,
  settings: Settings,
  messaging: Mail,
  capital: Landmark,
  backup: HardDrive,
  system: Bot,
};

const SEVERITY_BADGE = {
  info: "bg-ocean-100 text-ocean-700",
  warning: "bg-yellow-100 text-yellow-700",
  critical: "bg-red-100 text-red-700",
};

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
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
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
          <BarChart3 size={28} className="text-gray-700 dark:text-slate-200" /> Audit Log
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1 mb-6">
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
        <div className="bg-surface rounded-xl shadow p-4 mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400 pointer-events-none" />
              <input
              type="text"
              placeholder="Search descriptions / users / entities"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg focus:border-ocean-500 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
            </div>
            <select
              value={filters.tenant_id}
              onChange={(e) =>
                setFilters({ ...filters, tenant_id: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            >
              <option value="">All Tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.business_name}
                </option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters({ ...filters, category: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            >
              <option value="">All Categories</option>
              {Object.keys(CATEGORY_ICON_MAP).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={filters.severity}
              onChange={(e) =>
                setFilters({ ...filters, severity: e.target.value })
              }
              className="px-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            >
              <option value="">All Severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        {/* Log list */}
        {loading ? (
          <div className="bg-surface rounded-xl shadow overflow-hidden divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="p-4 flex items-start gap-3">
                <Skeleton className="h-5 w-5 rounded shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-64" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-48 mt-2" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title="No matching log entries"
            description="Try clearing a filter or widening your search to see activity."
          />
        ) : (
          <div className="bg-surface rounded-xl shadow overflow-hidden">
            <div className="divide-y">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-4 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
                >
                  <div className="flex items-start gap-3">
                    {(() => {
                      const IconComp = CATEGORY_ICON_MAP[log.action_category] || ClipboardList;
                      return <IconComp size={20} className="text-gray-400 dark:text-slate-400 mt-0.5 shrink-0" />;
                    })()}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-gray-800 dark:text-slate-100 break-words">
                          {log.description || log.action}
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${SEVERITY_BADGE[log.severity] || SEVERITY_BADGE.info}`}
                        >
                          {log.severity || "info"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1"><User size={12} /> {log.user_name || "System"}</span>
                        {log.user_role && <span>• {log.user_role}</span>}
                        {log.is_platform_admin && (
                          <span className="text-ocean-600 font-semibold inline-flex items-center gap-1">
                            • <ShieldCheck size={12} /> platform
                          </span>
                        )}
                        {log.tenant_name && (
                          <span className="inline-flex items-center gap-1">• <Building2 size={12} /> {log.tenant_name}</span>
                        )}
                        <span>• {timeAgo(log.created_at)}</span>
                        {log.ip_address && log.ip_address !== "unknown" && (
                          <span className="inline-flex items-center gap-1">• <MapPin size={12} /> {log.ip_address}</span>
                        )}
                      </div>
                      {(log.old_values || log.new_values || log.metadata) && (
                        <details className="mt-2">
                          <summary className="text-xs text-ocean-600 cursor-pointer">
                            details
                          </summary>
                          <pre className="text-xs bg-gray-50 dark:bg-slate-900 p-2 rounded mt-1 overflow-x-auto">
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
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  Page {pagination.page} of {pagination.pages} ·{" "}
                  {pagination.total} total
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page - 1 }))
                    }
                    disabled={pagination.page === 1}
                    className="px-3 py-1 bg-gray-100 dark:bg-slate-700 rounded disabled:opacity-50"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() =>
                      setPagination((p) => ({ ...p, page: p.page + 1 }))
                    }
                    disabled={pagination.page === pagination.pages}
                    className="px-3 py-1 bg-gray-100 dark:bg-slate-700 rounded disabled:opacity-50"
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
    indigo: "text-ocean-600",
    red: "text-red-600",
    yellow: "text-yellow-600",
    gray: "text-gray-800 dark:text-slate-100",
  }[color];
  return (
    <div className="bg-surface rounded-xl shadow p-4">
      <p className="text-xs text-gray-500 dark:text-slate-400 uppercase">{label}</p>
      <p className={`text-2xl font-bold ${text}`}>{value ?? 0}</p>
    </div>
  );
}

export default PlatformAuditLog;
