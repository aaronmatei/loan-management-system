import React from "react";
import {
  Printer,
  MessageSquare,
  User,
  Phone,
  Hash,
  CreditCard,
  DollarSign,
  Check,
  CheckCircle,
} from "lucide-react";
import { LENDER_TYPES } from "../portal/lenderType";
import Stamp from "./Stamp";

// Shared, premium payment receipt — used by the tenant admin
// (post-payment modal in pages/Payments.jsx) AND the customer portal
// (payment-history view in portal/pages/LoanDetails.jsx). One component,
// two call sites — do not fork.
//
// Props (unchanged so call sites keep working):
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
// Theme: parchment-paper card with a navy/brand header band, gold
// paperclip clipped to the top edge, and a rotated "LOAN FULLY PAID"
// rubber stamp when the loan is cleared.

// Derive a dark header colour + accent from a hex brand color. Falls
// back to a deep navy when brand_color is absent or not 6-digit hex.
function buildReceiptTheme(brandColor) {
  const base =
    brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor)
      ? brandColor
      : "#1a2438"; // deep navy default
  const shift = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, v));
    const r = c((n >> 16) + amt);
    const g = c(((n >> 8) & 0xff) + amt);
    const b = c((n & 0xff) + amt);
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    headerBg: shift(base, -40),
    headerEdge: shift(base, -80),
    accent: base,
    accentLight: shift(base, 110),
  };
}

const money = (v) =>
  `KES ${Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Big amount: "KES 10,600" + tiny superscript ".00"
function AmountDisplay({ value }) {
  const [whole, dec = "00"] = Number(value || 0)
    .toFixed(2)
    .split(".");
  const wholeFmt = Number(whole).toLocaleString();
  return (
    <span className="inline-flex items-start">
      <span className="text-3xl lg:text-4xl font-extrabold text-stone-800 tracking-tight">
        KES&nbsp;{wholeFmt}
      </span>
      <span className="text-base font-bold text-stone-700 mt-1 ml-0.5">
        .{dec}
      </span>
    </span>
  );
}

function PaymentReceipt({ payment, receipt, tenant, onClose, onPrint }) {
  if (!payment || !receipt) return null;

  const typeColor =
    LENDER_TYPES[String(tenant?.business_type || "").trim().toLowerCase()]
      ?.color || null;
  const theme = buildReceiptTheme(typeColor || tenant?.brand_color);
  const businessName = tenant?.business_name || "Loan Payment Receipt";

  const txnCode = payment.transaction_code || `TXN-${payment.id || ""}`;
  const firstName = (receipt.client_name || "").trim().split(/\s+/)[0] || "";
  const isFullyPaid = !!receipt.is_fully_paid;

  // Date/time meta line — date from payment_date, time from created_at.
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
  const meta = [
    dateStr,
    timeStr,
    payment.payment_method && `via ${payment.payment_method}`,
  ]
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
        ).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}`,
      );
    }
    const phone = (receipt.client_phone || "").replace(/[^0-9]/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank");
  };

  // ── Inline label helpers ────────────────────────────────────────
  const Label = ({ children }) => (
    <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500 font-semibold">
      {children}
    </p>
  );

  const Field = ({ icon: Icon, label, primary, secondary, mono }) => (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-full bg-stone-200/70 ring-1 ring-stone-300/60 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={13} className="text-stone-600" />
      </div>
      <div className="min-w-0">
        <Label>{label}</Label>
        <p
          className={`${mono ? "font-mono text-sm" : "font-semibold text-sm"} text-stone-800 break-words`}
        >
          {primary}
        </p>
        {secondary && (
          <p className="text-xs text-stone-500 mt-0.5">{secondary}</p>
        )}
      </div>
    </div>
  );

  // Compute extra rows for the Loan Summary box.
  const penaltyPaid = parseFloat(receipt.penalty_paid || 0);
  const overpayment = parseFloat(receipt.overpayment || 0);
  const amountPaidNum = parseFloat(payment.amount_paid || 0);
  const towardBalance = amountPaidNum - penaltyPaid - overpayment;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 no-print">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto">
        {/* ── Receipt card ──────────────────────────────────────── */}
        <div
          id="receipt-print-content"
          className="receipt-card relative rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.45)] overflow-visible"
          style={{
            backgroundColor: "#f4ecd6",
            backgroundImage:
              "linear-gradient(180deg, #f6efdc 0%, #f1e8cf 100%)",
          }}
        >
          {/* Paper grain — very faint diagonal noise. */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none mix-blend-multiply"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(120,90,40,0.02) 0 1px, transparent 1px 4px)",
            }}
            aria-hidden="true"
          />

          {/* ── Navy header band ──────────────────────────────── */}
          <div
            className="receipt-header relative rounded-t-2xl px-6 py-4 flex items-center justify-between gap-4"
            style={{
              background: `linear-gradient(180deg, ${theme.headerBg} 0%, ${theme.headerEdge} 100%)`,
            }}
          >
            <p className="text-white text-sm font-bold tracking-[0.18em]">
              PAYMENT RECEIVED
            </p>
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-[0.18em] text-white/55">
                Transaction
              </p>
              <p className="font-mono text-xs text-white">{txnCode}</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/12 ring-1 ring-white/25">
              <div className="w-4 h-4 rounded-full bg-emerald-400/90 flex items-center justify-center">
                <Check size={10} className="text-white" strokeWidth={3} />
              </div>
              <span className="text-xs font-semibold text-white">Paid</span>
            </div>
          </div>

          {/* ── Body ──────────────────────────────────────────── */}
          <div className="relative px-7 pt-7 pb-6">
            {/* Headline */}
            <p className="text-2xl lg:text-3xl font-serif italic text-stone-800 leading-tight">
              Thank you, {firstName || businessName}.
            </p>

            {/* Amount Paid block */}
            <div className="mt-5">
              <Label>Amount Paid</Label>
              <div className="mt-1">
                <AmountDisplay value={payment.amount_paid} />
              </div>
              {meta && (
                <p className="text-xs text-stone-500 mt-1.5">{meta}</p>
              )}
            </div>

            <div className="border-t border-stone-300/60 my-6" />

            {/* Field grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">
              <Field
                icon={User}
                label="Client"
                primary={receipt.client_name || "—"}
              />
              {receipt.client_code && (
                <Field
                  icon={Hash}
                  label="Client Code"
                  primary={receipt.client_code}
                  mono
                />
              )}
              {receipt.client_phone && (
                <Field
                  icon={Phone}
                  label="Phone"
                  primary={receipt.client_phone}
                />
              )}
              <Field
                icon={CreditCard}
                label="Method"
                primary={payment.payment_method || "—"}
                secondary={
                  payment.payment_reference
                    ? `Ref · ${payment.payment_reference}`
                    : null
                }
              />
              {receipt.loan_code && (
                <Field
                  icon={DollarSign}
                  label="Loan Code"
                  primary={receipt.loan_code}
                  mono
                />
              )}
            </div>

            {/* ── Loan Summary panel ─────────────────────────── */}
            <div
              className="relative mt-7 rounded-2xl border border-stone-300/60 p-5"
              style={{ backgroundColor: "rgba(255,253,245,0.7)" }}
            >
              <p className="text-center text-stone-700 font-semibold text-sm mb-3 tracking-wide">
                Loan Summary
              </p>
              <div className="space-y-2 text-sm">
                {receipt.principal != null && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Principal</span>
                    <span className="text-stone-800 font-medium">
                      {money(receipt.principal)}
                    </span>
                  </div>
                )}
                {receipt.total_amount_due != null && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Total due</span>
                    <span className="text-stone-800 font-medium">
                      {money(receipt.total_amount_due)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-stone-500">This payment</span>
                  <span className="font-semibold text-rose-700">
                    −{money(payment.amount_paid)}
                  </span>
                </div>
                {penaltyPaid > 0 && (
                  <div className="flex justify-between pl-3 text-xs">
                    <span className="text-stone-400">↳ Penalty cleared</span>
                    <span className="text-amber-700">
                      {money(penaltyPaid)}
                    </span>
                  </div>
                )}
                {penaltyPaid > 0 && towardBalance > 0 && (
                  <div className="flex justify-between pl-3 text-xs">
                    <span className="text-stone-400">↳ Toward balance</span>
                    <span className="text-stone-600">
                      {money(towardBalance)}
                    </span>
                  </div>
                )}
                {overpayment > 0 && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Overpaid</span>
                    <span className="font-semibold text-amber-700">
                      +{money(overpayment)}
                    </span>
                  </div>
                )}

                {/* Highlighted remaining balance row */}
                <div
                  className="mt-3 -mx-2 px-3 py-2 rounded-lg flex justify-between items-baseline"
                  style={{ backgroundColor: "rgba(217,200,150,0.35)" }}
                >
                  <span className="text-stone-700 font-semibold">
                    Remaining balance
                  </span>
                  <span className="font-serif text-lg text-stone-900 font-semibold">
                    {money(receipt.remaining_balance)}
                  </span>
                </div>
              </div>

            </div>

            {/* Fully-paid panel / next-payment box (mutually exclusive) */}
            {isFullyPaid ? (
              <div
                className="mt-6 rounded-2xl border p-5 text-center"
                style={{
                  borderColor: theme.accent,
                  backgroundColor: "rgba(255,255,255,0.45)",
                }}
              >
                <p
                  className="text-lg font-serif italic inline-flex items-center gap-2"
                  style={{ color: theme.accent }}
                >
                  <CheckCircle size={18} /> Loan fully paid
                </p>
              </div>
            ) : (
              nextDateStr && (
                <div className="mt-6 rounded-2xl border border-stone-300/60 p-4 flex items-center justify-between bg-white/40">
                  <div>
                    <Label>Next Payment</Label>
                    <p className="font-serif text-lg text-stone-900 mt-0.5">
                      {money(receipt.next_payment_amount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <Label>Due</Label>
                    <p className="text-sm font-semibold text-stone-700 mt-0.5">
                      {nextDateStr}
                    </p>
                  </div>
                </div>
              )
            )}

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="font-serif italic text-stone-600">
                A receipt for your records.
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-stone-400 mt-2">
                This is a system-generated document and requires no signature.
              </p>
              {/* Official lender stamp — same artwork as the PDF
                  receipt's stamp (src/utils/stamp.js) so on-screen
                  and printed receipts look identical. Falls back
                  to just the name if the tenant has no
                  city/country on file. Date is the txn's
                  payment_date — a re-opened receipt always shows
                  the day the payment landed, not "today". */}
              {tenant?.business_name && (
                <div className="mt-4 flex justify-center">
                  <Stamp
                    lenderName={tenant.business_name}
                    location={[tenant.city, tenant.country]
                      .filter(Boolean)
                      .join(" · ")}
                    date={payment?.payment_date || new Date()}
                    size={110}
                    className="opacity-90"
                  />
                </div>
              )}
              {!tenant?.hide_platform_branding && (
                <p className="text-[10px] uppercase tracking-[0.18em] text-stone-400 mt-3">
                  Powered by{" "}
                  <span className="text-stone-600 font-semibold">LenderFest</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Actions (hidden when printing) ─────────────────── */}
        <div className="mt-4 flex gap-2 no-print">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-white/90 text-stone-700 rounded-xl font-semibold shadow-sm hover:bg-white"
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
        .receipt-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .receipt-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          body * { visibility: hidden; }
          #receipt-print-content, #receipt-print-content * { visibility: visible; }
          #receipt-print-content {
            position: absolute; left: 0; top: 0; width: 100%;
            box-shadow: none;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

export default PaymentReceipt;
