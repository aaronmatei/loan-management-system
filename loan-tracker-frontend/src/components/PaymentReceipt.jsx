import React from "react";

// Modal receipt shown after POST /payments. Reads:
// - `payment` — the freshly-recorded `transactions` row (with
//   `transaction_code` used as the receipt #)
// - `receipt` — the helper block POST /payments now returns
//   (remaining_balance, next_payment_*, completion_percentage)
// - `tenant` — branding (business_name, logo_url, support_phone, etc.)
// Print uses scoped CSS that hides everything else while the modal
// content fills the page.
function PaymentReceipt({ payment, receipt, tenant, onClose, onPrint }) {
  if (!payment || !receipt) return null;

  const fmt = (v) =>
    `KES ${parseFloat(v || 0).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;
  const pct = parseFloat(receipt.completion_percentage || 0);

  const daysCopy = (() => {
    if (!receipt.next_payment_date) return null;
    const days = Math.ceil(
      (new Date(receipt.next_payment_date) - new Date()) /
        (1000 * 60 * 60 * 24),
    );
    if (days < 0) return `⚠️ ${Math.abs(days)} days overdue!`;
    if (days === 0) return "🔔 Due today!";
    if (days === 1) return "🔔 Due tomorrow";
    return `📅 Due in ${days} days`;
  })();

  const onWhatsApp = () => {
    const lines = [
      `Payment Receipt — ${tenant?.business_name || "Loan Payment"}`,
      `Loan: ${receipt.loan_code}`,
      `Amount Paid: ${fmt(payment.amount_paid)} via ${payment.payment_method}`,
      `Remaining: ${fmt(receipt.remaining_balance)}`,
    ];
    if (!receipt.is_fully_paid && receipt.next_payment_date) {
      lines.push(
        `Next: ${fmt(receipt.next_payment_amount)} on ${new Date(
          receipt.next_payment_date,
        ).toLocaleDateString()}`,
      );
    }
    const phone = (receipt.client_phone || "").replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 no-print">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div id="receipt-print-content" className="p-6">
          {/* Header */}
          <div className="text-center border-b-2 border-dashed border-gray-200 pb-4 mb-4">
            {tenant?.logo_url && (
              <img
                src={tenant.logo_url}
                alt="Logo"
                className="w-16 h-16 mx-auto mb-2 object-contain"
              />
            )}
            <h2 className="text-xl font-bold text-gray-800">
              {tenant?.business_name || "Loan Payment Receipt"}
            </h2>
            {tenant?.physical_address && (
              <p className="text-xs text-gray-500 mt-1">
                {tenant.physical_address}
              </p>
            )}
            {(tenant?.support_phone || tenant?.contact_phone) && (
              <p className="text-xs text-gray-500">
                📞 {tenant.support_phone || tenant.contact_phone}
              </p>
            )}
          </div>

          <div className="text-center mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Payment Receipt
            </p>
            <p className="text-xs text-gray-500 mt-1">
              #{payment.transaction_code || `TXN-${payment.id}`}
            </p>
            <p className="text-xs text-gray-500">
              {new Date(payment.payment_date).toLocaleString()}
            </p>
          </div>

          {/* Amount paid hero */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl p-4 text-center mb-4">
            <p className="text-xs uppercase opacity-90">Amount Received</p>
            <p className="text-4xl font-bold mt-1">
              {fmt(payment.amount_paid)}
            </p>
            <p className="text-xs opacity-90 mt-1">
              via {payment.payment_method || "—"}
            </p>
          </div>

          {/* Client */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Paid By</p>
            <p className="font-bold">{receipt.client_name}</p>
            <p className="text-sm text-gray-600">{receipt.client_phone}</p>
            <p className="text-xs text-gray-500">
              Client: {receipt.client_code}
            </p>
          </div>

          {/* Loan ref */}
          <div className="mb-4 pb-4 border-b border-dashed border-gray-200">
            <p className="text-xs text-gray-500 uppercase mb-1">
              Loan Reference
            </p>
            <p className="font-mono font-bold">{receipt.loan_code}</p>
          </div>

          {payment.payment_reference && (
            <div className="mb-4 pb-4 border-b border-dashed border-gray-200">
              <p className="text-xs text-gray-500 uppercase mb-1">
                Transaction Reference
              </p>
              <p className="font-mono text-sm">{payment.payment_reference}</p>
            </div>
          )}

          {/* Loan status block */}
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs text-gray-500 uppercase mb-3 font-bold">
              Loan Status
            </p>

            {/* Progress */}
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">
                  Paid: {fmt(receipt.total_paid)}
                </span>
                <span className="font-bold">{pct}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-500 to-emerald-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1 text-gray-500">
                <span>Total Loan: {fmt(receipt.total_amount_due)}</span>
              </div>
            </div>

            {/* Remaining balance */}
            <div className="bg-white rounded-lg p-3 mb-3 border-2 border-orange-200">
              <p className="text-xs text-gray-500 uppercase">
                Remaining Loan Balance
              </p>
              <p className="text-2xl font-bold text-orange-600">
                {fmt(receipt.remaining_balance)}
              </p>
              {receipt.is_fully_paid && (
                <p className="text-xs text-green-600 font-bold mt-1">
                  ✅ LOAN FULLY PAID! Thank you!
                </p>
              )}
            </div>

            {/* Next payment */}
            {!receipt.is_fully_paid && receipt.next_payment_date && (
              <div className="bg-white rounded-lg p-3 border-2 border-blue-200">
                <p className="text-xs text-gray-500 uppercase">
                  Next Payment Due
                </p>
                <div className="flex justify-between items-center mt-1">
                  <div>
                    <p className="text-xl font-bold text-blue-600">
                      {fmt(receipt.next_payment_amount)}
                    </p>
                    {receipt.next_payment_number && (
                      <p className="text-xs text-gray-500">
                        Payment #{receipt.next_payment_number}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Due Date</p>
                    <p className="text-sm font-bold text-blue-600">
                      {new Date(receipt.next_payment_date).toLocaleDateString(
                        "en-GB",
                        { day: "numeric", month: "short", year: "numeric" },
                      )}
                    </p>
                  </div>
                </div>
                {daysCopy && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    {daysCopy}
                  </p>
                )}
              </div>
            )}
          </div>

          {payment.notes && (
            <div className="mb-4 text-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
              <p className="text-gray-700">{payment.notes}</p>
            </div>
          )}

          <div className="text-center border-t-2 border-dashed border-gray-200 pt-4 mt-4">
            <p className="text-xs text-gray-500">Thank you for your payment!</p>
            <p className="text-xs text-gray-500 mt-1">
              Keep this receipt for your records
            </p>
            {!tenant?.hide_platform_branding && (
              <p className="text-xs text-gray-400 mt-2">Powered by LoanFix</p>
            )}
          </div>
        </div>

        {/* Action row (hidden when printing) */}
        <div className="border-t bg-gray-50 p-4 flex gap-2 no-print">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold"
          >
            Close
          </button>
          <button
            onClick={onPrint || (() => window.print())}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-semibold"
          >
            🖨️ Print
          </button>
          <button
            onClick={onWhatsApp}
            className="flex-1 py-2 bg-green-600 text-white rounded-lg font-semibold"
          >
            💬 WhatsApp
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-content, #receipt-print-content * { visibility: visible; }
          #receipt-print-content { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export default PaymentReceipt;
