import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { useSortableTable } from "../../hooks/useSortableTable";
import SortableHeader from "../../components/SortableHeader";
import { Building2, Search } from "lucide-react";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { formatKES } from "../../utils/money";

const K = (v) => formatKES(v);

const STATUS = {
  active: { c: "#16a34a", b: "#e4f5ec" },
  trial: { c: "#0e8a6e", b: "#e0f4ee" },
  suspended: { c: "#e5484d", b: "#fbe6e4" },
  cancelled: { c: "#8b8aa0", b: "#f0f0f7" },
};
function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.cancelled;
  return (
    <span
      className="inline-flex items-center text-[11.5px] font-bold px-2.5 py-1 rounded-lg capitalize"
      style={{ background: s.b, color: s.c }}
    >
      {status}
    </span>
  );
}

function PlatformTenants() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all"); // all | active | trial | suspended
  // Seed from the header search (?q=), then edit locally.
  const [search, setSearch] = useState(() => searchParams.get("q") || "");

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams();
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
  }, [search]);

  // Status tab counts from the loaded (search-filtered) set.
  const counts = useMemo(() => {
    const c = { all: tenants.length, active: 0, trial: 0, suspended: 0 };
    for (const t of tenants) if (c[t.status] != null) c[t.status] += 1;
    return c;
  }, [tenants]);
  const shown = useMemo(
    () => (tab === "all" ? tenants : tenants.filter((t) => t.status === tab)),
    [tenants, tab],
  );

  const {
    sortedData: sortedTenants,
    requestSort,
    getSortIndicator,
  } = useSortableTable(shown, "created_at", "desc");

  const updateStatus = async (tenant, newStatus) => {
    let reason = null;
    if (newStatus === "suspended") {
      reason = window.prompt("Reason for suspension?");
      if (!reason) return;
    }
    if (!window.confirm(`Change ${tenant.business_name} status to ${newStatus}?`)) return;
    try {
      await platformApi.put(`/platform/admin/tenants/${tenant.id}/status`, {
        status: newStatus,
        reason,
      });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update status");
    }
  };

  const TABS = [
    ["all", "All"],
    ["active", "Active"],
    ["trial", "Trial"],
    ["suspended", "Suspended"],
  ];

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto">
        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map(([v, label]) => {
              const on = tab === v;
              return (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] text-[13px] font-bold border transition"
                  style={{
                    borderColor: on ? "#0e8a6e" : "#e3e7e0",
                    background: on ? "#e0f4ee" : "#fff",
                    color: on ? "#0a5c4c" : "#5b5b70",
                  }}
                >
                  {label}
                  <span
                    className="text-[11px] font-extrabold px-1.5 rounded-full"
                    style={{ background: on ? "#0e8a6e" : "#f0f2ed", color: on ? "#fff" : "#8b8aa0" }}
                  >
                    {counts[v] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, subdomain, code…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
            />
          </div>
        </div>

        {loading ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-10 h-10" rounded="rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Building2} title="No tenants found" description="No lenders match your current filter." />
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/60 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700">
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                    <SortableHeader label="Tenant" sortKey="business_name" requestSort={requestSort} getSortIndicator={getSortIndicator} className="text-left p-3" />
                    <SortableHeader label="Clients" sortKey="client_count" requestSort={requestSort} getSortIndicator={getSortIndicator} align="right" className="text-right p-3" />
                    <SortableHeader label="Loans" sortKey="loan_count" requestSort={requestSort} getSortIndicator={getSortIndicator} align="right" className="text-right p-3 hidden lg:table-cell" />
                    <SortableHeader label="Portfolio" sortKey="total_disbursed" requestSort={requestSort} getSortIndicator={getSortIndicator} align="right" className="text-right p-3 hidden lg:table-cell" />
                    <SortableHeader label="Interest collected" sortKey="interest_collected" requestSort={requestSort} getSortIndicator={getSortIndicator} align="right" className="text-right p-3 hidden xl:table-cell" />
                    <SortableHeader label="Status" sortKey="status" requestSort={requestSort} getSortIndicator={getSortIndicator} align="center" className="text-center p-3" />
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTenants.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => navigate(`/admin/tenants/${t.id}`)}
                      className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/40 cursor-pointer"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-10 h-10 rounded-[11px] flex items-center justify-center text-white font-bold shrink-0"
                            style={{ backgroundColor: t.brand_color || "#0e8a6e" }}
                          >
                            {t.business_name?.charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-navy-900 dark:text-slate-100 flex items-center gap-1.5 truncate">
                              {t.business_name}
                              {t.kind === "welfare" && (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                                  Welfare
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">{t.tenant_code} · {t.subdomain}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-right p-3 font-semibold text-slate-600 dark:text-slate-300 tabular-nums">{t.client_count}</td>
                      <td className="text-right p-3 hidden lg:table-cell text-slate-600 dark:text-slate-300 tabular-nums">{t.loan_count}</td>
                      <td className="text-right p-3 hidden lg:table-cell font-extrabold text-navy-900 dark:text-slate-100 tabular-nums">{K(t.total_disbursed)}</td>
                      <td className="text-right p-3 hidden xl:table-cell text-green-700 tabular-nums">{K(t.interest_collected)}</td>
                      <td className="text-center p-3"><StatusPill status={t.status} /></td>
                      <td className="text-right p-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/admin/tenants/${t.id}`)}
                          className="px-3 py-1 bg-ocean-50 text-ocean-700 rounded-lg text-xs font-bold hover:bg-ocean-100"
                        >
                          View
                        </button>
                        {t.id !== 1 && t.status === "active" && (
                          <button onClick={() => updateStatus(t, "suspended")} className="ml-1 px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100">
                            Suspend
                          </button>
                        )}
                        {t.id !== 1 && t.status === "suspended" && (
                          <button onClick={() => updateStatus(t, "active")} className="ml-1 px-3 py-1 bg-green-50 text-green-600 rounded-lg text-xs font-bold hover:bg-green-100">
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
