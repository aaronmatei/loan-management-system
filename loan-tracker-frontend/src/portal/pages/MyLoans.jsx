import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Coins, FileText, X, Plus } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import SortHeader from "../components/SortHeader";
import Pager from "../components/Pager";
import { lenderColor } from "../lenderColor";
import Skeleton from "../../components/Skeleton";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const PAGE_SIZE = 15;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-ocean-100 text-ocean-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-ocean-100 text-ocean-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

// My Loans only shows disbursed loans, so no pending/approved tabs here —
// those live in My Applications until the lender disburses.
const TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "defaulted", label: "Defaulted" },
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
  // Sort by application_date (when the borrower applied) — falls back
  // to created_at for legacy rows without an application_date.
  date: (a, b) =>
    new Date(a.application_date || a.created_at || 0) -
    new Date(b.application_date || b.created_at || 0),
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
      navigate(`/portal/loans/${loan.id}`);
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

  // by_tenant lists every linked lender (used to label the active filter).
  const lenders = data?.summary?.by_tenant || [];
  const activeLender =
    tenantFilter !== "all"
      ? lenders.find((t) => String(t.tenant_id) === tenantFilter)
      : null;

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

  // Borrower-facing totals across the filtered set (every loan matching the
  // current status/lender filter): total borrowed, repaid, and outstanding.
  const loanTotals = (data?.loans || []).reduce(
    (acc, l) => {
      acc.principal += parseFloat(l.principal_amount || 0);
      acc.paid += parseFloat(l.total_paid || 0);
      acc.balance += Math.max(0, balOf(l));
      return acc;
    },
    { principal: 0, paid: 0, balance: 0 },
  );

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 dark:text-slate-100 flex items-center gap-2">
              <Coins size={28} className="text-navy-900 dark:text-slate-100" /> My Loans
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Every loan across all your lenders, in one place
            </p>
          </div>
          {/* Funnel customer back to the lenders directory to pick
              which lender they want to borrow from — products are
              per-lender, so a generic "Apply" button here can't
              skip the lender choice. */}
          <button
            onClick={() => navigate("/lenders")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-white bg-gradient-to-r from-ocean-600 to-purple-700 shadow-sm hover:shadow-md transition shrink-0"
          >
            <Plus size={16} /> Apply for a loan
          </button>
        </div>
        <div className="mb-5" />

        {/* Active lender filter (set from a lender's "View my loans") */}
        {activeLender && (
          <div className="mb-4">
            <span
              className="inline-flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1 text-sm font-semibold text-white"
              style={{
                backgroundColor: lenderColor(
                  activeLender.brand_color,
                  activeLender.tenant_id,
                ),
              }}
            >
              {activeLender.business_name}
              <button
                onClick={() => setTenantFilter("all")}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/25"
                aria-label="Clear lender filter"
              >
                <X size={12} />
              </button>
            </span>
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
                  : "bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-[#faf6ec] dark:hover:bg-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-12 text-center text-gray-500 dark:text-slate-400">
            <div className="flex justify-center mb-3">
              <FileText size={48} className="text-slate-300 dark:text-slate-600" />
            </div>
            <p>No loans found.</p>
          </div>
        ) : (
          <>
            {/* Totals across the filtered set — the borrower's at-a-glance
                position: what they've borrowed, repaid, and still owe. */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-[#ece6da] dark:border-slate-700 shadow-sm p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Total borrowed
                </p>
                <p className="text-base lg:text-lg font-bold text-navy-900 dark:text-slate-100 mt-0.5">
                  {KES(loanTotals.principal)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-[#ece6da] dark:border-slate-700 shadow-sm p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Total repaid
                </p>
                <p className="text-base lg:text-lg font-bold text-green-700 mt-0.5">
                  {KES(loanTotals.paid)}
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-[#ece6da] dark:border-slate-700 shadow-sm p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Outstanding
                </p>
                <p className="text-base lg:text-lg font-bold text-red-600 mt-0.5">
                  {KES(loanTotals.balance)}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              {sorted.length} loan{sorted.length !== 1 ? "s" : ""} · showing{" "}
              {start + 1}–{start + paged.length}
            </p>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-[#ece6da] dark:border-slate-700">
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
                    const bc = lenderColor(
                      loan.tenant_brand_color,
                      loan.tenant_id,
                    );
                    const balance = Math.max(0, balOf(loan));
                    return (
                      <tr
                        key={loan.id}
                        onClick={() => openLoan(loan)}
                        className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: bc }}
                            >
                              {loan.tenant_name?.charAt(0)}
                            </div>
                            <span className="font-medium text-navy-900 dark:text-slate-100 truncate">
                              {loan.tenant_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-navy-900 dark:text-slate-100">
                            {loan.loan_code || `#${loan.id}`}
                          </p>
                          {loan.purpose && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[14rem]">
                              {loan.purpose}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900 dark:text-slate-100">
                          {KES(loan.principal_amount)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-red-600">
                          {KES(balance)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-semibold capitalize ${
                              STATUS_BADGE[loan.status] ||
                              "bg-[#faf6ec] text-gray-600"
                            }`}
                          >
                            {String(loan.status || "").replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500 dark:text-slate-400">
                          {/* Same swap as staff LoanDetails — render the
                              application_date (when the borrower applied),
                              not the row's created_at (when staff entered it).
                              For the customer this is the date THEY know
                              the loan by. */}
                          {(loan.application_date || loan.created_at)
                            ? new Date(loan.application_date || loan.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
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
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 text-navy-900 dark:text-slate-100">
                    <td className="px-4 py-3 font-semibold" colSpan={2}>
                      Total · {sorted.length} loan
                      {sorted.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                      {KES(loanTotals.principal)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-600 whitespace-nowrap">
                      {KES(loanTotals.balance)}
                    </td>
                    <td className="px-4 py-3" colSpan={3} />
                  </tr>
                </tfoot>
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
