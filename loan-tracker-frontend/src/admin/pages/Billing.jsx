import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { useSortableTable } from "../../hooks/useSortableTable";
import SortableHeader from "../../components/SortableHeader";

const K = (v) => `KES ${(parseFloat(v || 0) / 1_000).toFixed(1)}K`;
const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS_BADGE = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  overdue: "bg-red-100 text-red-700",
  partial: "bg-blue-100 text-blue-700",
  cancelled: "bg-gray-200 text-gray-600",
};

function BillingDashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        platformApi.get("/platform/billing/summary"),
        platformApi.get(
          `/platform/billing/invoices${filter !== "all" ? `?status=${filter}` : ""}`,
        ),
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
  }, [filter]);

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
        `✅ Period ${period}\n\n${success.length} generated\n${skipped.length} skipped\n${failed.length} failed`,
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
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PlatformLayout>
    );
  }

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
              💰 Billing
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
            {generating ? "Generating…" : "🔄 Generate Monthly Invoices"}
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
            <div className="bg-gradient-to-br from-blue-500 to-cyan-600 text-white rounded-xl shadow-lg p-4">
              <p className="text-blue-100 text-xs uppercase">
                This Month Collected
              </p>
              <p className="text-2xl font-bold mt-1">
                {K(summary.current_month.total_collected)}
              </p>
              <p className="text-xs text-blue-100 mt-1">
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

        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { v: "all", l: "All" },
            { v: "pending", l: "⏳ Pending" },
            { v: "paid", l: "✅ Paid" },
            { v: "overdue", l: "⚠️ Overdue" },
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
        </div>

        {invoices.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <p className="text-5xl mb-3">📋</p>
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
                          Due {new Date(i.due_date).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                            style={{
                              backgroundColor:
                                i.tenant_brand_color || "#4F46E5",
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
