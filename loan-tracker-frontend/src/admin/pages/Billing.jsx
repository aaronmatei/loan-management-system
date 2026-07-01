import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import MonthNavigator from "../components/MonthNavigator";
import { useSortableTable } from "../../hooks/useSortableTable";
import SortableHeader from "../../components/SortableHeader";
import { Coins, RotateCcw, ClipboardList, Clock, CheckCircle, AlertTriangle, Check } from "lucide-react";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { formatKES } from "../../utils/money";
import StatCard from "../components/StatCard";

// Full KES figures (no K abbreviation) — delegate to the shared money helper.
const K = (v) => formatKES(v);
const KES = (v) => formatKES(v);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PLAN_COLOR = { Trial: "#8b8aa0", Starter: "#d9892a", Growth: "#16a34a", Enterprise: "#5b6ef0" };

const STATUS_BADGE = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  overdue: "bg-red-100 text-red-700",
  partial: "bg-ocean-100 text-ocean-700",
  cancelled: "bg-gray-200 text-gray-600",
};

function BillingDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState("all");
  // Billing-period filter — empty = show all months. Format: "YYYY-MM".
  const [monthFilter, setMonthFilter] = useState("");
  // Per-tenant monthly statement (what a tenant owes each month vs paid).
  const [tenants, setTenants] = useState([]);
  const [stmtTenant, setStmtTenant] = useState("");
  const [statement, setStatement] = useState(null);
  const [stmtLoading, setStmtLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filter !== "all") qs.set("status", filter);
      if (monthFilter) {
        const [y, m] = monthFilter.split("-").map((s) => parseInt(s, 10));
        if (y && m) {
          qs.set("year", y);
          qs.set("month", m);
        }
      }
      const url = `/platform/billing/invoices${
        qs.toString() ? `?${qs}` : ""
      }`;
      const [s, i] = await Promise.all([
        platformApi.get("/platform/billing/summary"),
        platformApi.get(url),
      ]);
      setSummary(s.data.data);
      setInvoices(i.data.data || []);
    } catch {
      /* handled by interceptor */
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [filter, monthFilter]);

  // Tenant list for the statement dropdown.
  useEffect(() => {
    platformApi
      .get("/platform/admin/tenants")
      .then((r) => setTenants(r.data.data || []))
      .catch(() => {});
  }, []);

  // Plan catalog (tiers). Editable price; assignment lives on the tenant page.
  const [plans, setPlans] = useState([]);
  const loadPlans = () =>
    platformApi.get("/platform/admin/plans").then((r) => setPlans(r.data.data || [])).catch(() => {});
  useEffect(() => {
    loadPlans();
  }, []);
  const plansMrr = plans.reduce((s, p) => s + parseFloat(p.mrr || 0), 0);
  const editPrice = async (p) => {
    const v = window.prompt(`Monthly price for "${p.name}" (KES)`, p.monthly_price);
    if (v == null) return;
    const price = parseFloat(v);
    if (Number.isNaN(price) || price < 0) return alert("Enter a valid price");
    try {
      await platformApi.put(`/platform/admin/plans/${p.id}`, { monthly_price: price });
      loadPlans();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update plan");
    }
  };

  // Load the selected tenant's monthly statement.
  const loadStatement = (tenantId) => {
    if (!tenantId) {
      setStatement(null);
      return;
    }
    setStmtLoading(true);
    platformApi
      .get(`/platform/billing/tenant/${tenantId}/monthly`)
      .then((r) => setStatement(r.data.data))
      .catch(() => setStatement(null))
      .finally(() => setStmtLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => loadStatement(stmtTenant), [stmtTenant]);

  // Generate + send the invoice for an un-invoiced month, then refresh the
  // statement (row flips to "pending") and the invoice list / summary.
  const [genMonth, setGenMonth] = useState(null);
  const sendInvoice = async (m) => {
    const key = `${m.year}-${m.month}`;
    setGenMonth(key);
    try {
      await platformApi.post("/platform/billing/invoices/generate", {
        tenant_id: parseInt(stmtTenant, 10),
        year: m.year,
        month: m.month,
      });
      await Promise.all([loadStatement(stmtTenant), load()]);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to generate invoice");
    } finally {
      setGenMonth(null);
    }
  };

  // Human-readable label for the currently-selected period — used in
  // the active-filter pill so the staff can see at a glance what
  // they're looking at.
  const periodLabel = monthFilter
    ? (() => {
        const [y, m] = monthFilter.split("-").map((s) => parseInt(s, 10));
        return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
          month: "long",
          year: "numeric",
        });
      })()
    : null;

  // Client-side sort over the current (server-filtered) result set.
  const {
    sortedData: sortedInvoices,
    requestSort,
    getSortIndicator,
  } = useSortableTable(invoices, "billing_year", "desc");

  const generateMonthly = async () => {
    if (
      !window.confirm(
        "Generate invoices for ALL billable tenants for the previous month?",
      )
    )
      return;
    setGenerating(true);
    try {
      const r = await platformApi.post(
        "/platform/billing/invoices/generate-monthly",
      );
      const { success, failed, skipped, period } = r.data.data;
      alert(
        `Period ${period}\n\n${success.length} generated\n${skipped.length} skipped\n${failed.length} failed`,
      );
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to generate invoices");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-56 mb-6" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-40 w-full rounded-xl mb-6" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </PlatformLayout>
    );
  }

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
              <Coins size={28} className="text-gray-700 dark:text-slate-200" /> Billing
            </h1>
            <p className="text-gray-600 dark:text-slate-400 mt-1">
              Invoices, payments, and revenue
            </p>
          </div>
          <button
            onClick={generateMonthly}
            disabled={generating}
            className="px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {generating ? "Generating…" : <span className="inline-flex items-center gap-1.5"><RotateCcw size={15} /> Generate Monthly Invoices</span>}
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              accent="green"
              icon={ClipboardList}
              label="This Month Billed"
              value={K(summary.current_month.total_billed)}
              sub={`${summary.current_month.total_invoices} invoices`}
            />
            <StatCard
              accent="ocean"
              icon={CheckCircle}
              label="This Month Collected"
              value={K(summary.current_month.total_collected)}
              sub={`${summary.current_month.paid_count} paid`}
            />
            <StatCard
              accent="amber"
              icon={Clock}
              label="Outstanding"
              value={K(summary.current_month.outstanding)}
              sub={`${
                summary.current_month.pending_count +
                summary.current_month.overdue_count
              } unpaid`}
            />
            <StatCard
              accent="violet"
              icon={Coins}
              label="All-Time Revenue"
              value={K(summary.all_time.total_collected)}
              sub={`${summary.all_time.total_invoices} total invoices`}
            />
          </div>
        )}

        {/* Plan tiers — the subscription catalog (assign on a tenant's page).
            Coexists with the per-tenant interest-fee model; MRR counts only
            tenants actually on a plan. */}
        {plans.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-slate-400">Plan tiers</div>
              <div className="text-[12px] font-bold text-slate-500 dark:text-slate-400">
                Subscription MRR: <span className="text-navy-900 dark:text-slate-100">{K(plansMrr)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
              {plans.map((p) => (
                <div key={p.id} className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-extrabold" style={{ color: PLAN_COLOR[p.name] || "#0e8a6e" }}>{p.name}</span>
                    <button onClick={() => editPrice(p)} className="text-[11px] font-bold text-ocean-600">Edit</button>
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-[24px] font-extrabold text-navy-900 dark:text-slate-100 tracking-tight">{K(p.monthly_price)}</span>
                    <span className="text-[12px] text-slate-400 font-semibold">/mo</span>
                  </div>
                  <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                    {p.tenant_count} tenant{Number(p.tenant_count) === 1 ? "" : "s"}
                  </div>
                  <div className="h-px bg-slate-100 dark:bg-slate-700 my-4" />
                  <div className="flex flex-col gap-2">
                    {(p.features || []).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-300 font-medium">
                        <Check size={13} style={{ color: PLAN_COLOR[p.name] || "#0e8a6e" }} className="shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Per-tenant monthly statement — what a tenant is supposed to pay
            each month (platform fee on interest collected) vs what's been
            paid. Surfaces every month with activity, including months that
            were never invoiced. */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
              <ClipboardList size={18} /> Tenant Monthly Statement
            </h2>
            <select
              value={stmtTenant}
              onChange={(e) => setStmtTenant(e.target.value)}
              className="border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean-500/40 dark:bg-slate-900 dark:border-slate-600"
            >
              <option value="">Select a tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.business_name}
                </option>
              ))}
            </select>
          </div>

          {!stmtTenant ? (
            <EmptyState
              tone="muted"
              icon={ClipboardList}
              title="Pick a tenant"
              description="Select a tenant to see what they owe each month, based on the interest they collected."
            />
          ) : stmtLoading ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : !statement || statement.months.length === 0 ? (
            <EmptyState
              tone="muted"
              icon={ClipboardList}
              title="No billable activity"
              description="This tenant has no billable activity yet."
            />
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                Fee: {statement.tenant.billing_fee_percentage}% of interest
                collected
                {statement.tenant.billing_base_fee > 0
                  ? ` + ${K(statement.tenant.billing_base_fee)} base`
                  : ""}{" "}
                ·{" "}
                {statement.tenant.billing_enabled
                  ? "billing enabled"
                  : "billing disabled"}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-900">
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="text-left p-2">Month</th>
                      <th className="text-right p-2">Interest Collected</th>
                      <th className="text-right p-2">Supposed to Pay</th>
                      <th className="text-right p-2">Paid</th>
                      <th className="text-right p-2">Outstanding</th>
                      <th className="text-center p-2">Status</th>
                      <th className="text-right p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.months.map((m) => (
                      <tr
                        key={`${m.year}-${m.month}`}
                        className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-slate-700"
                      >
                        <td className="p-2 font-medium text-gray-800 dark:text-slate-100 whitespace-nowrap">
                          {MONTHS[m.month - 1]} {m.year}
                        </td>
                        <td className="text-right p-2">
                          {K(m.interest_earned)}
                        </td>
                        <td className="text-right p-2 font-semibold">
                          {K(m.supposed_to_pay)}
                        </td>
                        <td className="text-right p-2 text-green-700">
                          {K(m.amount_paid)}
                        </td>
                        <td
                          className={`text-right p-2 font-semibold ${
                            m.outstanding > 0 ? "text-red-600" : "text-gray-400 dark:text-slate-400"
                          }`}
                        >
                          {K(m.outstanding)}
                        </td>
                        <td className="text-center p-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              m.invoiced
                                ? STATUS_BADGE[m.invoice_status] ||
                                  "bg-gray-100 text-gray-600"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {m.invoiced ? m.invoice_status : "not invoiced"}
                          </span>
                        </td>
                        <td className="text-right p-2 whitespace-nowrap">
                          {m.invoiced ? (
                            <span className="text-xs text-gray-400 dark:text-slate-400">—</span>
                          ) : (
                            <button
                              onClick={() => sendInvoice(m)}
                              disabled={genMonth === `${m.year}-${m.month}`}
                              className="px-2.5 py-1 bg-ocean-600 text-white rounded text-xs font-semibold hover:bg-ocean-700 disabled:opacity-50"
                            >
                              {genMonth === `${m.year}-${m.month}`
                                ? "Sending…"
                                : "Send invoice"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 font-bold text-gray-800 dark:text-slate-100">
                      <td className="p-2">Total</td>
                      <td className="text-right p-2">
                        {K(statement.totals.interest_earned)}
                      </td>
                      <td className="text-right p-2">
                        {K(statement.totals.supposed_to_pay)}
                      </td>
                      <td className="text-right p-2 text-green-700">
                        {K(statement.totals.amount_paid)}
                      </td>
                      <td className="text-right p-2 text-red-600">
                        {K(statement.totals.outstanding)}
                      </td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {[
            { v: "all", l: "All" },
            { v: "pending", l: <span className="inline-flex items-center gap-1"><Clock size={13} /> Pending</span> },
            { v: "paid", l: <span className="inline-flex items-center gap-1"><CheckCircle size={13} /> Paid</span> },
            { v: "overdue", l: <span className="inline-flex items-center gap-1"><AlertTriangle size={13} /> Overdue</span> },
            { v: "partial", l: "Partial" },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setFilter(t.v)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition ${
                filter === t.v
                  ? "bg-ocean-600 text-white"
                  : "bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700"
              }`}
            >
              {t.l}
            </button>
          ))}

          {/* Month picker with prev/next arrows — pulls invoices for
              the chosen billing period. */}
          <MonthNavigator
            value={monthFilter}
            onChange={setMonthFilter}
            className="ml-auto"
          />
        </div>

        {periodLabel && (
          <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-ocean-50 text-ocean-700 text-xs font-semibold">
            Viewing <strong>{periodLabel}</strong> · {invoices.length} invoice
            {invoices.length !== 1 ? "s" : ""}
          </div>
        )}

        {invoices.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No invoices yet"
            description="Invoices appear here once you generate them for billable tenants."
          />
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-900 border-b">
                  <tr>
                    <SortableHeader
                      label="Invoice"
                      sortKey="invoice_number"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      className="text-left p-3"
                    />
                    <SortableHeader
                      label="Tenant"
                      sortKey="business_name"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      className="text-left p-3"
                    />
                    <SortableHeader
                      label="Period"
                      sortKey="billing_year"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      className="text-left p-3 hidden lg:table-cell"
                    />
                    <SortableHeader
                      label="Interest"
                      sortKey="interest_amount"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="right"
                      className="text-right p-3"
                    />
                    <SortableHeader
                      label="Total"
                      sortKey="total_amount"
                      requestSort={requestSort}
                      getSortIndicator={getSortIndicator}
                      align="right"
                      className="text-right p-3"
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
                  {sortedInvoices.map((i) => (
                    <tr key={i.id} className="border-b hover:bg-gray-50 dark:hover:bg-slate-700">
                      <td className="p-3">
                        <p className="font-mono font-semibold">
                          {i.invoice_number}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          Due {new Date(i.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </p>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                            style={{
                              backgroundColor:
                                i.tenant_brand_color || "#0e8a6e",
                            }}
                          >
                            {i.tenant_name?.charAt(0)}
                          </div>
                          <span className="font-semibold">
                            {i.tenant_name}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        {String(i.billing_month).padStart(2, "0")}/
                        {i.billing_year}
                      </td>
                      <td className="text-right p-3">
                        {KES(i.interest_earned)}
                      </td>
                      <td className="text-right p-3 font-bold">
                        {KES(i.total_amount)}
                      </td>
                      <td className="text-center p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            STATUS_BADGE[i.status] ||
                            "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {i.status}
                        </span>
                      </td>
                      <td className="text-right p-3">
                        <button
                          onClick={() => navigate(`/admin/billing/${i.id}`)}
                          className="px-3 py-1 bg-ocean-50 text-ocean-600 rounded text-xs font-semibold hover:bg-ocean-100"
                        >
                          View
                        </button>
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

export default BillingDashboard;
