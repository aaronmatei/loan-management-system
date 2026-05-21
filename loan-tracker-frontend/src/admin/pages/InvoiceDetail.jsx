import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [pay, setPay] = useState({
    amount: "",
    payment_method: "mpesa",
    payment_reference: "",
    payment_date: new Date().toISOString().split("T")[0],
  });

  const load = () => {
    setLoading(true);
    platformApi
      .get(`/platform/billing/invoices/${id}`)
      .then((r) => {
        setData(r.data.data);
        const inv = r.data.data.invoice;
        const balance =
          parseFloat(inv.total_amount) - parseFloat(inv.amount_paid || 0);
        setPay((p) => ({ ...p, amount: balance > 0 ? balance : "" }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const submitPayment = async (e) => {
    e.preventDefault();
    try {
      await platformApi.post(
        `/platform/billing/invoices/${id}/payments`,
        pay,
      );
      alert("✅ Payment recorded");
      setShowPay(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to record payment");
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PlatformLayout>
    );
  }
  if (!data) return <PlatformLayout><div /></PlatformLayout>;

  const { invoice, payments } = data;
  const balance =
    parseFloat(invoice.total_amount) - parseFloat(invoice.amount_paid || 0);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <button
          onClick={() => navigate("/admin/billing")}
          className="text-ocean-600 mb-4 font-semibold text-sm"
        >
          ← Back to Billing
        </button>

        <div className="bg-ocean-gradient text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <div className="flex justify-between items-start flex-wrap gap-3">
            <div>
              <p className="text-ocean-200 text-sm">Invoice</p>
              <h1 className="text-3xl font-bold font-mono">
                {invoice.invoice_number}
              </h1>
              <p className="text-ocean-100 mt-2">
                Period{" "}
                {String(invoice.billing_month).padStart(2, "0")}/
                {invoice.billing_year} · Due{" "}
                {new Date(invoice.due_date).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-sm font-bold ${
                invoice.status === "paid"
                  ? "bg-green-500"
                  : invoice.status === "overdue"
                    ? "bg-red-500"
                    : invoice.status === "partial"
                      ? "bg-blue-500"
                      : "bg-yellow-500"
              }`}
            >
              {String(invoice.status).toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <div>
              <p className="text-ocean-200 text-xs">Tenant</p>
              <p className="text-lg font-bold">{invoice.tenant_name}</p>
            </div>
            <div>
              <p className="text-ocean-200 text-xs">Interest Earned</p>
              <p className="text-lg font-bold">
                {KES(invoice.interest_earned)}
              </p>
            </div>
            <div>
              <p className="text-ocean-200 text-xs">Fee Rate</p>
              <p className="text-lg font-bold">{invoice.fee_percentage}%</p>
            </div>
            <div>
              <p className="text-ocean-200 text-xs">Total Amount</p>
              <p className="text-2xl font-bold">
                {KES(invoice.total_amount)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6 mb-6">
          <h2 className="font-bold mb-3">📊 Calculation Breakdown</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b">
              <span>Interest earned this period</span>
              <span className="font-bold">
                {KES(invoice.interest_earned)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span>Platform fee ({invoice.fee_percentage}%)</span>
              <span className="font-bold text-ocean-600">
                {KES(invoice.amount_due)}
              </span>
            </div>
            {parseFloat(invoice.base_fee) > 0 && (
              <div className="flex justify-between py-2 border-b">
                <span>Base fee</span>
                <span className="font-bold">{KES(invoice.base_fee)}</span>
              </div>
            )}
            <div className="flex justify-between py-3 text-lg">
              <span className="font-bold">Total</span>
              <span className="font-bold text-ocean-700">
                {KES(invoice.total_amount)}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span>Amount paid</span>
              <span className="font-bold text-green-600">
                {KES(invoice.amount_paid)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-t-2">
              <span className="font-bold">Balance</span>
              <span className="font-bold text-red-600 text-xl">
                {KES(balance)}
              </span>
            </div>
          </div>
          {balance > 0.01 && (
            <button
              onClick={() => setShowPay(true)}
              className="w-full mt-4 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg"
            >
              💰 Record Payment
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6">
          <h2 className="font-bold mb-3">
            💳 Payment History ({payments.length})
          </h2>
          {payments.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">
              No payments yet.
            </p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-bold">{KES(p.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(p.payment_date).toLocaleDateString()} ·{" "}
                      {p.payment_method}
                    </p>
                    {p.payment_reference && (
                      <p className="text-xs text-gray-500">
                        Ref: {p.payment_reference}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    Recorded by: {p.recorded_by_name || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showPay && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <h3 className="font-bold text-xl mb-4">Record Payment</h3>
              <form onSubmit={submitPayment} className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={pay.amount}
                    onChange={(e) =>
                      setPay({ ...pay, amount: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Method
                  </label>
                  <select
                    value={pay.payment_method}
                    onChange={(e) =>
                      setPay({ ...pay, payment_method: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg bg-white focus:border-ocean-500 focus:outline-none"
                  >
                    <option value="mpesa">M-Pesa</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Reference (optional)
                  </label>
                  <input
                    type="text"
                    value={pay.payment_reference}
                    onChange={(e) =>
                      setPay({ ...pay, payment_reference: e.target.value })
                    }
                    placeholder="Transaction ID / receipt number"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={pay.payment_date}
                    onChange={(e) =>
                      setPay({ ...pay, payment_date: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPay(false)}
                    className="flex-1 py-2 bg-gray-200 rounded-lg font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg font-semibold"
                  >
                    ✓ Record
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}

export default InvoiceDetail;
