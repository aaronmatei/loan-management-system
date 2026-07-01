import React, { useState, useEffect } from "react";
import { Receipt, AlertTriangle, CheckCircle, Smartphone, Download } from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import { formatKES } from "../utils/money";

const KES = (v) => formatKES(v);
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const period = (inv) => `${MONTHS[(inv.billing_month || 1) - 1]} ${inv.billing_year}`;

const STATUS_BADGE = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  partial: "bg-ocean-100 text-ocean-700",
  overdue: "bg-red-100 text-red-700",
};

function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError("");
      const [inv, sum] = await Promise.all([
        api.get("/billing/invoices"),
        api.get("/billing/summary"),
      ]);
      setInvoices(inv.data.data || []);
      setSummary(sum.data.data || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load billing");
    } finally {
      setLoading(false);
    }
  };

  const balanceOf = (inv) =>
    parseFloat(inv.total_amount) - parseFloat(inv.amount_paid || 0);

  const payInvoice = async (inv) => {
    const phone = window.prompt(
      `Enter the M-Pesa number to pay ${KES(balanceOf(inv))} for ${inv.invoice_number}:`,
      "",
    );
    if (!phone) return;
    setPaying(inv.id);
    try {
      await api.post("/mpesa/stk/invoice", {
        invoice_id: inv.id,
        phone: phone.trim(),
      });
      alert(
        "STK push sent. Approve the prompt on your phone to complete payment.",
      );
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setPaying(null);
    }
  };

  // Download the invoice as a branded PDF (authenticated blob fetch).
  const downloadInvoice = async (inv) => {
    setDownloading(inv.id);
    try {
      const res = await api.get(`/billing/invoices/${inv.id}/pdf`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_${inv.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download invoice");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Receipt}
        title="Billing"
        subtitle="Your platform invoices — a fee on the interest you earn each month."
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" rounded="rounded-xl" />
            ))}
          </div>
          <div className="bg-surface rounded-xl shadow-md p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" rounded="rounded-lg" />
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-orange-100 text-xs uppercase font-semibold">
                Outstanding
              </p>
              <p className="text-3xl font-bold mt-2">
                {KES(summary?.outstanding)}
              </p>
              <p className="text-orange-100 text-xs mt-1">
                {summary?.due_count || 0} due · {summary?.overdue_count || 0} overdue
              </p>
            </div>
            <div className="bg-surface border border-gray-100 dark:border-slate-700 rounded-xl shadow-md p-6">
              <p className="text-gray-500 dark:text-slate-400 text-xs uppercase font-semibold">
                Paid Invoices
              </p>
              <p className="text-3xl font-bold mt-2 text-green-600">
                {summary?.paid_count || 0}
              </p>
            </div>
            <div className="bg-surface border border-gray-100 dark:border-slate-700 rounded-xl shadow-md p-6">
              <p className="text-gray-500 dark:text-slate-400 text-xs uppercase font-semibold">
                Total Invoices
              </p>
              <p className="text-3xl font-bold mt-2 text-gray-800 dark:text-slate-100">
                {summary?.total_invoices || 0}
              </p>
            </div>
          </div>

          {/* Invoices table */}
          {invoices.length === 0 ? (
            <EmptyState
              icon={CheckCircle}
              title="No invoices yet"
              description="Invoices appear here at the start of each billing cycle."
            />
          ) : (
            <div className="bg-surface rounded-xl shadow-md overflow-hidden">
              <div className="overflow-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-slate-900 border-b-2 border-gray-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Invoice</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Period</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Interest Earned</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Fee %</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Total</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Balance</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Due</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const bal = balanceOf(inv);
                      const payable = bal > 0 && inv.status !== "paid";
                      return (
                        <tr key={inv.id} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700">
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800 dark:text-slate-100">
                            {inv.invoice_number}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">
                            {period(inv)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-200">
                            {KES(inv.interest_earned)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-700 dark:text-slate-200">
                            {parseFloat(inv.fee_percentage)}%
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-800 dark:text-slate-100">
                            {KES(inv.total_amount)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold text-red-600">
                            {bal > 0 ? KES(bal) : "—"}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-slate-400">
                            {inv.due_date
                              ? new Date(inv.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold capitalize ${
                                STATUS_BADGE[inv.status] || "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2 justify-end">
                              <button
                                onClick={() => downloadInvoice(inv)}
                                disabled={downloading === inv.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs font-semibold rounded-lg disabled:opacity-50"
                              >
                                <Download size={14} />
                                {downloading === inv.id ? "…" : "Download"}
                              </button>
                              {payable && (
                                <button
                                  onClick={() => payInvoice(inv)}
                                  disabled={paying === inv.id}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                                >
                                  <Smartphone size={14} />
                                  {paying === inv.id ? "Sending…" : "Pay (M-Pesa)"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500 dark:text-slate-400 flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Unpaid invoices past their due date may lead to your account being
              suspended. Pay promptly to avoid interruption.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default Billing;
