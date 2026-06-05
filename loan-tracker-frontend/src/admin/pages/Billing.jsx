import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import MonthNavigator from "../components/MonthNavigator";
import { useSortableTable } from "../../hooks/useSortableTable";
import SortableHeader from "../../components/SortableHeader";
import { Coins, RotateCcw, ClipboardList, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import Spinner from "../../components/Spinner";

// Full KES figures (no K abbreviation) — e.g. KES 2,000,000, not 2.0K.
const K = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
        <Spinner centered className="py-20" label="Loading…" />
      </PlatformLayout>
    );
  }

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
              <Coins size={28} className="text-gray-700" /> Billing
            </h1>
            <p className="text-gray-600 mt-1">
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
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-4">
              <p className="text-green-100 text-xs uppercase">
                This Month Billed
              </p>
              <p className="text-2xl font-bold mt-1">
                {K(summary.current_month.total_billed)}
              </p>
              <p className="text-xs text-green-100 mt-1">
                {summary.current_month.total_invoices} invoices
              </p>
            </div>
            <div className="bg-gradient-to-br from-ocean-500 to-ocean-600 text-white rounded-xl shadow-lg p-4">
              <p className="text-ocean-100 text-xs uppercase">
                This Month Collected
              </p>
              <p className="text-2xl font-bold mt-1">
                {K(summary.current_month.total_collected)}
              </p>
              <p className="text-xs text-ocean-100 mt-1">
                {summary.current_month.paid_count} paid
              </p>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-4">
              <p className="text-orange-100 text-xs uppercase">Outstanding</p>
              <p className="text-2xl font-bold mt-1">
                {K(summary.current_month.outstanding)}
              </p>
              <p className="text-xs text-orange-100 mt-1">
                {summary.current_month.pending_count +
                  summary.current_month.overdue_count}{" "}
                unpaid
              </p>
            </div>
            <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-4">
              <p className="text-ocean-100 text-xs uppercase">
                All-Time Revenue
              </p>
              <p className="text-2xl font-bold mt-1">
                {K(summary.all_time.total_collected)}
              </p>
              <p className="text-xs text-ocean-100 mt-1">
                {summary.all_time.total_invoices} total invoices
              </p>
            </div>
          </div>
        )}

        {/* Per-tenant monthly statement — what a tenant is supposed to pay
            each month (platform fee on interest collected) vs what's been
            paid. Surfaces every month with activity, including months that
            were never invoiced. */}
        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              <ClipboardList size={18} /> Tenant Monthly Statement
            </h2>
            <select
              value={stmtTenant}
              onChange={(e) => setStmtTenant(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-ocean-500/40"
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
            <p className="text-sm text-gray-400 py-6 text-center">
              Pick a tenant to see what they owe each month, based on the
              interest they collected.
            </p>
          ) : stmtLoading ? (
            <Spinner centered className="py-8" label="Loading…" />
          ) : !statement || statement.months.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">
              No billable activity for this tenant yet.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">
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
                  <thead className="bg-gray-50">
                    <tr className="text-gray-500">
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
                        className="border-b last:border-0 hover:bg-gray-50"
                      >
                        <td className="p-2 font-medium text-gray-800 whitespace-nowrap">
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
                            m.outstanding > 0 ? "text-red-600" : "text-gray-400"
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
                            <span className="text-xs text-gray-400">—</span>
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
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-gray-800">
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
                  : "bg-white text-gray-700 hover:bg-gray-100"
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
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <ClipboardList size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">No invoices yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
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
                    <tr key={i.id} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <p className="font-mono font-semibold">
                          {i.invoice_number}
                        </p>
                        <p className="text-xs text-gray-500">
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
