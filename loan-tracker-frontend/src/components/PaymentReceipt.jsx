import React from "react";
import { Printer, MessageSquare } from "lucide-react";
import { LENDER_TYPES } from "../portal/lenderType";

// Shared, premium payment receipt — used by the tenant admin
// (post-payment modal in pages/Payments.jsx) AND the customer portal
// (payment-history view in portal/pages/LoanDetails.jsx). One component,
// two call sites — do not fork.
//
// Props (unchanged from the previous version so call sites keep working):
//   payment — the freshly-recorded `transactions` row (transaction_code,
//             amount_paid, payment_method, payment_reference, payment_date,
//             created_at, notes, id)
//   receipt — buildReceiptBlock output (client_name, client_phone,
//             client_code, loan_code, principal, total_amount_due,
//             total_paid, remaining_balance, is_fully_paid,
//             next_payment_number, next_payment_amount, next_payment_date,
//             completion_percentage)
//   tenant  — branding (business_name, brand_color, support_phone, ...)
//
// The header gradient + accents are derived from the lender's TYPE colour
// (tenant.business_type), falling back to tenant.brand_color, then a default.

// Derive a header gradient + accents from a hex brand color. Emerald
// fallback is used ONLY when brand_color is absent or not a 6-digit hex.
function buildReceiptTheme(brandColor) {
  const base =
    brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#0f3d2e";
  const shift = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, v));
    const r = c((n >> 16) + amt);
    const g = c(((n >> 8) & 0xff) + amt);
    const b = c((n & 0xff) + amt);
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    headerGradient: `linear-gradient(135deg, ${shift(base, -20)} 0%, ${shift(base, -70)} 100%)`,
    accent: base, // "This payment", fully-paid, glow dot
    accentLight: shift(base, 90), // italic first name + light header labels
    badgeBg: "rgba(255,255,255,0.08)",
    badgeBorder: "rgba(255,255,255,0.25)",
  };
}

// Whole-shilling figure bold/white, decimals dimmed so the eye lands on
// the integer part. `KES` prefix small + muted.
function SplitAmount({ value, currency = "KES" }) {
  const [whole, dec = "00"] = Number(value || 0)
    .toFixed(2)
    .split(".");
  const wholeFmt = Number(whole).toLocaleString();
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-base font-normal opacity-60">{currency}</span>
      <span className="text-5xl lg:text-6xl font-bold tracking-tight text-white">
        {wholeFmt}
      </span>
      <span className="text-3xl lg:text-4xl font-bold text-white/30">
        .{dec}
      </span>
    </span>
  );
}

const money = (v) =>
  `KES ${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function PaymentReceipt({ payment, receipt, tenant, onClose, onPrint }) {
  if (!payment || !receipt) return null;

  // Colour the receipt by the lender's TYPE (microfinance / sacco / chama /
  // individual). Falls back to the tenant's brand_color, then the default.
  const typeColor =
    LENDER_TYPES[String(tenant?.business_type || "").trim().toLowerCase()]
      ?.color || null;
  const theme = buildReceiptTheme(typeColor || tenant?.brand_color);
  const businessName = tenant?.business_name || "Loan Payment Receipt";

  const txnCode = payment.transaction_code || `TXN-${payment.id || ""}`;
  const firstName = (receipt.client_name || "").trim().split(/\s+/)[0] || "";
  const isFullyPaid = !!receipt.is_fully_paid;

  // Date + time meta line: date from payment_date, time from created_at
  // when present (payment_date is a DATE with no time component).
  const dateObj = payment.payment_date ? new Date(payment.payment_date) : null;
  const timeObj = payment.created_at ? new Date(payment.created_at) : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
  const timeStr = timeObj
    ? timeObj.toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
  const meta = [dateStr, timeStr, payment.payment_method && `via ${payment.payment_method}`]
    .filter(Boolean)
    .join(" · ");

  const nextDateStr = receipt.next_payment_date
    ? new Date(receipt.next_payment_date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  const onWhatsApp = () => {
    const lines = [
      `Payment Receipt — ${businessName}`,
      `Loan: ${receipt.loan_code}`,
      `Amount Paid: ${money(payment.amount_paid)} via ${payment.payment_method}`,
      `Remaining: ${money(receipt.remaining_balance)}`,
    ];
    if (!isFullyPaid && receipt.next_payment_date) {
      lines.push(
        `Next: ${money(receipt.next_payment_amount)} on ${new Date(
          receipt.next_payment_date,
        ).toLocaleDateString()}`,
      );
    }
    const phone = (receipt.client_phone || "").replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank");
  };

  // Tiny uppercase muted label used throughout the body.
  const Label = ({ children }) => (
    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
      {children}
    </p>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 no-print">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl shadow-2xl">
        <div id="receipt-print-content" className="receipt-card relative bg-[#f7f6f3]">
          {/* ── Dark gradient header ───────────────────────────── */}
          <div
            className="receipt-header relative overflow-hidden px-7 pt-7 pb-9 text-white"
            style={{ backgroundImage: theme.headerGradient }}
          >
            {/* subtle dotted texture */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  "radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)",
                backgroundSize: "14px 14px",
                opacity: 0.15,
              }}
            />

            <div className="relative">
              {/* top row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: theme.accentLight,
                      boxShadow: `0 0 8px 1px ${theme.accentLight}`,
                    }}
                  />
                  <span
                    className="text-[10px] uppercase tracking-[0.2em] font-semibold"
                    style={{ color: theme.accentLight }}
                  >
                    Payment Received
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-white/50">
                    Transaction
                  </p>
                  <p className="font-mono text-sm text-white/90">{txnCode}</p>
                  <span
                    className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{
                      backgroundColor: theme.badgeBg,
                      border: `1px solid ${theme.badgeBorder}`,
                    }}
                  >
                    ✓ Paid
                  </span>
                </div>
              </div>

              {/* headline */}
              <div className="mt-6">
                <p className="text-2xl font-light text-white/90">Thank you,</p>
                <p
                  className="text-4xl font-serif italic leading-tight"
                  style={{ color: theme.accentLight }}
                >
                  {firstName || businessName}.
                </p>
              </div>

              {/* amount */}
              <div className="mt-6">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 mb-1">
                  Amount Paid
                </p>
                <SplitAmount value={payment.amount_paid} />
                {meta && <p className="text-xs text-white/55 mt-2">{meta}</p>}
              </div>
            </div>
          </div>

          {/* ── Ticket perforation seam ────────────────────────── */}
          <div className="relative h-0">
            <div
              className="absolute -left-3 -top-3 w-6 h-6 rounded-full bg-[#f7f6f3]"
              aria-hidden="true"
            />
            <div
              className="absolute -right-3 -top-3 w-6 h-6 rounded-full bg-[#f7f6f3]"
              aria-hidden="true"
            />
            <div className="absolute left-5 right-5 top-0 border-t border-dashed border-gray-300" />
          </div>

          {/* ── Light body ─────────────────────────────────────── */}
          <div className="px-7 pt-7 pb-6">
            {/* detail grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <Label>Client</Label>
                <p className="font-semibold text-gray-800">
                  {receipt.client_name || "—"}
                </p>
                {receipt.client_phone && (
                  <p className="text-sm text-gray-500">{receipt.client_phone}</p>
                )}
              </div>
              {receipt.client_code && (
                <div>
                  <Label>Client Code</Label>
                  <p className="font-mono text-sm text-gray-800">
                    {receipt.client_code}
                  </p>
                </div>
              )}
              {receipt.loan_code && (
                <div>
                  <Label>Loan Code</Label>
                  <p className="font-mono text-sm text-gray-800">
                    {receipt.loan_code}
                  </p>
                </div>
              )}
              <div>
                <Label>Method</Label>
                <p className="font-semibold text-gray-800">
                  {payment.payment_method || "—"}
                </p>
                {payment.payment_reference && (
                  <p className="text-sm text-gray-500 font-mono">
                    Ref · {payment.payment_reference}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 my-6" />

            {/* loan summary */}
            <div className="rounded-2xl bg-gray-100/70 p-5">
              <Label>Loan Summary</Label>
              <div className="mt-3 space-y-2 text-sm">
                {receipt.principal != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Principal</span>
                    <span className="text-gray-800">{money(receipt.principal)}</span>
                  </div>
                )}
                {receipt.total_amount_due != null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total due</span>
                    <span className="text-gray-800">
                      {money(receipt.total_amount_due)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">This payment</span>
                  <span className="font-semibold" style={{ color: theme.accent }}>
                    − {money(payment.amount_paid)}
                  </span>
                </div>
                {parseFloat(receipt.overpayment || 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Overpaid</span>
                    <span className="font-semibold text-amber-700">
                      + {money(receipt.overpayment)}
                    </span>
                  </div>
                )}
                <div className="border-t border-gray-200 my-2" />
                <div className="flex justify-between items-baseline">
                  <span className="text-gray-600 font-medium">
                    Remaining balance
                  </span>
                  <span className="font-serif text-2xl text-gray-900">
                    {money(receipt.remaining_balance)}
                  </span>
                </div>
              </div>
            </div>

            {/* next payment / fully paid */}
            <div className="mt-4">
              {isFullyPaid ? (
                <div
                  className="rounded-2xl border p-5 text-center"
                  style={{
                    borderColor: theme.accent,
                    backgroundColor: "rgba(0,0,0,0.02)",
                  }}
                >
                  <p
                    className="text-lg font-serif italic"
                    style={{ color: theme.accent }}
                  >
                    ✓ Loan fully paid
                  </p>
                </div>
              ) : (
                nextDateStr && (
                  <div className="rounded-2xl border border-gray-200 p-5 flex items-center justify-between">
                    <div>
                      <Label>Next Payment</Label>
                      <p className="font-serif text-xl text-gray-900 mt-0.5">
                        {money(receipt.next_payment_amount)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Label>Due</Label>
                      <p className="text-sm font-semibold text-gray-700 mt-0.5">
                        {nextDateStr}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>

            {/* footer */}
            <div className="mt-7 text-center">
              <p className="font-serif italic text-gray-500">
                A receipt for your records.
              </p>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
                System Generated · No Signature Required
              </p>
              {!tenant?.hide_platform_branding && (
                <p className="text-[10px] text-gray-300 mt-2">Powered by LoanFix</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Actions (hidden when printing) ───────────────────── */}
        <div className="mt-3 flex gap-2 no-print">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-white/90 text-gray-700 rounded-xl font-semibold shadow-sm hover:bg-white"
          >
            Close
          </button>
          <button
            onClick={onPrint || (() => window.print())}
            className="inline-flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl font-semibold text-white shadow-sm"
            style={{ backgroundColor: theme.accent }}
          >
            <Printer size={16} /> Print
          </button>
          <button
            onClick={onWhatsApp}
            className="inline-flex items-center justify-center gap-2 flex-1 py-2.5 bg-[#25D366] text-white rounded-xl font-semibold shadow-sm hover:brightness-95"
          >
            <MessageSquare size={16} /> WhatsApp
          </button>
        </div>
      </div>

      <style>{`
        .receipt-card { border-radius: 1.5rem; overflow: hidden; }
        /* Keep the header rounded at the top inside the clipped card */
        .receipt-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          body * { visibility: hidden; }
          #receipt-print-content, #receipt-print-content * { visibility: visible; }
          #receipt-print-content {
            position: absolute; left: 0; top: 0; width: 100%;
            box-shadow: none;
          }
          .no-print { display: none !important; }
          /* Force the gradient/colors to render on paper */
          .receipt-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

export default PaymentReceipt;
