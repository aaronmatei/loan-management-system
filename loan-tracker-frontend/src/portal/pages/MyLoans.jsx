import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import SortHeader from "../components/SortHeader";
import Pager from "../components/Pager";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const PAGE_SIZE = 15;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

const TABS = [
  { value: "all", label: "All", emoji: "📋" },
  { value: "active", label: "Active", emoji: "🟢" },
  { value: "completed", label: "Completed", emoji: "✅" },
  { value: "defaulted", label: "Defaulted", emoji: "⚠️" },
  { value: "pending", label: "Pending", emoji: "⏳" },
];

// Status ordering for the sortable Status column (active first → rejected).
const STATUS_RANK = {
  active: 0,
  pending: 1,
  under_review: 2,
  approved: 3,
  completed: 4,
  defaulted: 5,
  rejected: 6,
};
const balOf = (l) =>
  parseFloat(l.total_amount_due || 0) - parseFloat(l.total_paid || 0);
const CMP = {
  lender: (a, b) => (a.tenant_name || "").localeCompare(b.tenant_name || ""),
  loan: (a, b) => (a.loan_code || "").localeCompare(b.loan_code || ""),
  principal: (a, b) =>
    parseFloat(a.principal_amount || 0) - parseFloat(b.principal_amount || 0),
  balance: (a, b) => balOf(a) - balOf(b),
  status: (a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99),
  date: (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
};

// My Loans: every loan across all linked lenders, as a sortable + paginated
// table. Status tabs and the "Your Lenders" cards filter (server-side); the
// columns sort (client-side). Opening a row scopes the session to that loan's
// lender and goes to the loan detail page.
function MyLoans() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const tenantFilter = searchParams.get("tenant_id") || "all";

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (tenantFilter !== "all") p.append("tenant_id", tenantFilter);
    if (status !== "all") p.append("status", status);
    portalApi
      .get(`/portal/customer/all-loans?${p}`)
      .then((r) => setData(r.data.data))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load loans"),
      )
      .finally(() => setLoading(false));
  }, [status, tenantFilter]);

  // Scope the session to the loan's lender, then open its detail page.
  const openLoan = async (loan) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: loan.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({
          ...r.data.current_tenant,
          brand_color: loan.tenant_brand_color,
        }),
      );
      navigate(`/loanfix/portal/loans/${loan.id}`);
    } catch {
      alert("Failed to open loan");
    }
  };

  const setTenantFilter = (val) => {
    const next = new URLSearchParams(searchParams);
    if (val === "all") next.delete("tenant_id");
    else next.set("tenant_id", String(val));
    setSearchParams(next);
  };

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  useEffect(() => setPage(1), [status, tenantFilter, sort]);

  const lenders = data?.summary?.by_tenant || [];
  // client_code per lender isn't in the loans summary — pull it from the
  // lender list cached at login so each "Your Lenders" card can show it.
  const linkInfo = (() => {
    try {
      const map = {};
      JSON.parse(localStorage.getItem("portal_tenants") || "[]").forEach(
        (t) => (map[t.tenant_id] = t),
      );
      return map;
    } catch {
      return {};
    }
  })();

  const sorted = useMemo(() => {
    const base = CMP[sort.key] || CMP.date;
    return [...(data?.loans || [])].sort((a, b) =>
      sort.dir === "asc" ? base(a, b) : -base(a, b),
    );
  }, [data, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const paged = sorted.slice(start, start + PAGE_SIZE);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 mb-1">
          💰 My Loans
        </h1>
        <p className="text-slate-500 mb-5">
          Every loan across all your lenders, in one place
        </p>

        {/* Your Lenders — your account at each lender (tap to filter) */}
        {lenders.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-navy-900 uppercase tracking-wide">
                Your Lenders
              </h2>
              {tenantFilter !== "all" && (
                <button
                  onClick={() => setTenantFilter("all")}
                  className="text-xs font-semibold text-ocean-600 hover:text-ocean-700"
                >
                  Show all
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {lenders.map((t) => {
                const bc = t.brand_color || "#0086cc";
                const bal =
                  parseFloat(t.total_due || 0) - parseFloat(t.total_paid || 0);
                const info = linkInfo[t.tenant_id] || {};
                const active = tenantFilter === String(t.tenant_id);
                return (
                  <button
                    key={t.tenant_id}
                    onClick={() => setTenantFilter(active ? "all" : t.tenant_id)}
                    className={`text-left bg-white rounded-xl p-3 border-2 transition ${
                      active ? "" : "border-transparent shadow-sm hover:shadow"
                    }`}
                    style={active ? { borderColor: bc } : undefined}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: bc }}
                      >
                        {t.business_name?.charAt(0)}
                      </div>
                      <p className="font-semibold text-navy-900 text-sm truncate">
                        {t.business_name}
                      </p>
                    </div>
                    {info.client_code && (
                      <p className="text-[11px] text-slate-500 font-mono">
                        {info.client_code}
                      </p>
                    )}
                    <div className="flex justify-between mt-1 text-xs">
                      <span className="text-slate-500">
                        {t.active_loans} active
                      </span>
                      <span className="font-semibold text-red-600">
                        {KES(Math.max(0, bal))}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition ${
                status === t.value
                  ? "bg-ocean-gradient text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            <p className="text-5xl mb-3">📭</p>
            <p>No loans found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-500 mb-3">
              {sorted.length} loan{sorted.length !== 1 ? "s" : ""} · showing{" "}
              {start + 1}–{start + paged.length}
            </p>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    <SortHeader
                      label="Lender"
                      sortKey="lender"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Loan"
                      sortKey="loan"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Principal"
                      sortKey="principal"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Balance"
                      sortKey="balance"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Status"
                      sortKey="status"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Date"
                      sortKey="date"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((loan) => {
                    const bc = loan.tenant_brand_color || "#0086cc";
                    const balance = Math.max(0, balOf(loan));
                    return (
                      <tr
                        key={loan.id}
                        onClick={() => openLoan(loan)}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: bc }}
                            />
                            <span className="font-medium text-navy-900 truncate">
                              {loan.tenant_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-navy-900">
                            {loan.loan_code || `#${loan.id}`}
                          </p>
                          {loan.purpose && (
                            <p className="text-xs text-slate-500 truncate max-w-[14rem]">
                              {loan.purpose}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900">
                          {KES(loan.principal_amount)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-red-600">
                          {KES(balance)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-semibold capitalize ${
                              STATUS_BADGE[loan.status] ||
                              "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {String(loan.status || "").replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500">
                          {loan.created_at
                            ? new Date(loan.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white"
                            style={{ backgroundColor: bc }}
                            aria-label={`Open ${loan.loan_code}`}
                          >
                            <ChevronRight size={18} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pager page={current} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default MyLoans;
