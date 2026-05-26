import React, { useState, useEffect } from "react";
import { Receipt, AlertTriangle, CheckCircle, Smartphone } from "lucide-react";
import api from "../services/api";

const KES = (v) => `KES ${Number(v || 0).toLocaleString()}`;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const period = (inv) => `${MONTHS[(inv.billing_month || 1) - 1]} ${inv.billing_year}`;

const STATUS_BADGE = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  partial: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
};

function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);

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

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Receipt size={28} /> Billing
        </h1>
        <p className="text-gray-600 mt-1">
          Your platform invoices — a fee on the interest you earn each month.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading…
        </div>
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
            <div className="bg-white border border-gray-100 rounded-xl shadow-md p-6">
              <p className="text-gray-500 text-xs uppercase font-semibold">
                Paid Invoices
              </p>
              <p className="text-3xl font-bold mt-2 text-green-600">
                {summary?.paid_count || 0}
              </p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl shadow-md p-6">
              <p className="text-gray-500 text-xs uppercase font-semibold">
                Total Invoices
              </p>
              <p className="text-3xl font-bold mt-2 text-gray-800">
                {summary?.total_invoices || 0}
              </p>
            </div>
          </div>

          {/* Invoices table */}
          {invoices.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <CheckCircle size={48} className="mx-auto mb-3 text-green-400" />
              <p className="text-gray-600 font-semibold">No invoices yet</p>
              <p className="text-gray-500 text-sm">
                Invoices appear here at the start of each billing cycle.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b-2 border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Invoice</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Period</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Interest Earned</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Fee %</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Balance</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Due</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const bal = balanceOf(inv);
                      const payable = bal > 0 && inv.status !== "paid";
                      return (
                        <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-800">
                            {inv.invoice_number}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {period(inv)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700">
                            {KES(inv.interest_earned)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-700">
                            {parseFloat(inv.fee_percentage)}%
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-gray-800">
                            {KES(inv.total_amount)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold text-red-600">
                            {bal > 0 ? KES(bal) : "—"}
                          </td>
                          <td className="px-4 py-3 text-center text-sm text-gray-600">
                            {inv.due_date
                              ? new Date(inv.due_date).toLocaleDateString()
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
                            {payable ? (
                              <button
                                onClick={() => payInvoice(inv)}
                                disabled={paying === inv.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                              >
                                <Smartphone size={14} />
                                {paying === inv.id ? "Sending…" : "Pay (M-Pesa)"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500 flex items-start gap-1.5">
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
