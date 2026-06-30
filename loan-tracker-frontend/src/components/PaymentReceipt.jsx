import React, { useEffect } from "react";
import { LENDER_TYPES } from "../portal/lenderType";

// Shared, premium payment receipt — used by the tenant admin (post-payment
// modal in pages/Payments.jsx) AND the customer portal (payment-history view
// in portal/pages/LoanDetails.jsx). One component, two call sites — do not
// fork. Props (unchanged so call sites keep working):
//   payment — transactions row (transaction_code, amount_paid, payment_method,
//             payment_reference, payment_date, created_at, id)
//   receipt — client_name, client_phone, client_code, loan_code, principal,
//             total_amount_due, remaining_balance, is_fully_paid, ...
//   tenant  — business_name, business_type, brand_color, city, country
//
// The parchment receipt design; the header gradient is driven by the lender's
// TYPE colour (Microfinance / SACCO / Chama / Individual).

const money = (v) =>
  `KES ${Number(v || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Darken a hex toward black by factor f (<1 darker). Returns an rgb() string.
function darken(hex, f) {
  const h = /^#?([0-9a-fA-F]{6})$/.test(hex || "")
    ? hex.replace("#", "")
    : "0e8a6e";
  const n = parseInt(h, 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(((n >> 16) & 255) * f)}, ${c(((n >> 8) & 255) * f)}, ${c((n & 255) * f)})`;
}

const CSS = `
.lf-rcpt{
  --paper:#F3ECDB; --paper-2:#FAF6EC; --band:#E9DFC7; --ink:#2B2A26; --muted:#9C9384;
  --line:#E2D9C3; --neg:#C62A5A; --seal:#23332C; --lender-navy:#10242A;
  --fest-green:#159A66; --orange:#E8651E; --wa:#22C15E; --chip:#E7DEC9;
  font-family:"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  color:var(--ink); width:100%; max-width:1080px; margin:0 auto;
}
.lf-rcpt .serif{font-family:"Lora", Georgia, serif}
.lf-rcpt .mono{font-family:"JetBrains Mono", ui-monospace, monospace}
.lf-rcpt .receipt{background:var(--paper);border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(0,0,0,.55);position:relative}
.lf-rcpt .receipt::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background:repeating-linear-gradient(135deg,rgba(0,0,0,.012) 0 2px,transparent 2px 9px)}
/* Header sits on the parchment now (no coloured band). The lender's own
   identity leads — monogram + name + address — with the brand colour kept
   only as accents (monogram, doc title, Paid pill). */
.lf-rcpt .r-header{background:var(--paper-2);color:var(--ink);padding:28px 36px 24px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;position:relative;z-index:1;border-bottom:1px solid var(--line)}
.lf-rcpt .brand{display:flex;align-items:center;gap:15px}
.lf-rcpt .brand .monogram{width:52px;height:52px;flex:0 0 auto;border-radius:14px;background:linear-gradient(140deg,var(--red2),var(--red1));color:#fff;display:grid;place-items:center;font-family:"Lora",Georgia,serif;font-weight:600;letter-spacing:.5px;box-shadow:0 8px 18px -9px var(--red1)}
.lf-rcpt .brand .word{display:flex;flex-direction:column;line-height:1.18}
.lf-rcpt .brand .word .name{font-weight:800;font-size:23px;letter-spacing:-.01em;color:var(--ink)}
.lf-rcpt .brand .word .sub{font-size:12px;color:var(--muted);margin-top:6px;font-weight:600}
.lf-rcpt .brand .word .contact{font-size:11.5px;color:var(--muted);margin-top:3px}
.lf-rcpt .header-right{display:flex;align-items:center;gap:24px}
.lf-rcpt .doc-meta{text-align:right}
.lf-rcpt .doc-meta .title{font-weight:800;font-size:14px;letter-spacing:.16em;color:var(--red2)}
.lf-rcpt .doc-meta .txn{font-size:12px;letter-spacing:.06em;color:var(--muted);margin-top:5px}
.lf-rcpt .paid{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--red2);padding:8px 15px;border-radius:999px;font-weight:700;font-size:14px;color:var(--red2)}
.lf-rcpt .paid svg{width:17px;height:17px}
.lf-rcpt .r-body{display:grid;grid-template-columns:1.18fr 1fr 1.12fr;position:relative;z-index:1}
.lf-rcpt .r-body > div{padding:30px 32px}
.lf-rcpt .col-mid,.lf-rcpt .col-right{border-left:1px solid var(--line)}
.lf-rcpt .greet{font-size:30px;font-style:italic;color:var(--ink);margin-bottom:24px;letter-spacing:-.01em}
.lf-rcpt .lbl{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}
.lf-rcpt .amount{font-size:46px;font-weight:600;color:var(--ink);letter-spacing:-.01em;margin:8px 0 10px;line-height:1}
.lf-rcpt .amount sup{font-size:.42em;font-weight:500;top:-1.1em;margin-left:2px;color:var(--muted)}
.lf-rcpt .paid-meta{font-size:14px;color:#6f6a5e}
.lf-rcpt .details{display:flex;flex-direction:column;gap:18px}
.lf-rcpt .drow{display:flex;align-items:center;gap:13px}
.lf-rcpt .dchip{width:38px;height:38px;border-radius:50%;background:var(--chip);display:grid;place-items:center;flex:0 0 auto}
.lf-rcpt .dchip svg{width:18px;height:18px;stroke:#7d7567;fill:none}
.lf-rcpt .dtext .dl{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.lf-rcpt .dtext .dv{font-size:15px;font-weight:600;color:var(--ink);margin-top:2px}
.lf-rcpt .dtext .dv.code{font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:500;font-size:13.5px;letter-spacing:-.2px}
.lf-rcpt .summary{background:var(--paper-2);border:1px solid var(--line);border-radius:14px;padding:20px;height:100%;display:flex;flex-direction:column}
.lf-rcpt .summary h3{text-align:center;font-size:16px;font-weight:700;color:var(--ink);margin-bottom:18px}
.lf-rcpt .srow{display:flex;justify-content:space-between;align-items:baseline;padding:9px 4px;font-size:15px}
.lf-rcpt .srow .k{color:#6f6a5e}
.lf-rcpt .srow .v{font-weight:600;color:var(--ink)}
.lf-rcpt .srow .v.neg{color:var(--neg);font-weight:700}
.lf-rcpt .sbal{margin-top:auto;background:var(--band);border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}
.lf-rcpt .sbal .k{font-weight:700;font-size:15px}
.lf-rcpt .sbal .v{font-family:"Lora",Georgia,serif;font-weight:600;font-size:23px}
.lf-rcpt .r-footer{border-top:1px dashed #d2c8af;padding:26px 36px;display:flex;align-items:center;justify-content:space-between;gap:24px;position:relative;z-index:1}
.lf-rcpt .foot-text{max-width:330px}
.lf-rcpt .foot-text .rec{font-family:"Lora",Georgia,serif;font-style:italic;font-size:19px;color:var(--ink)}
.lf-rcpt .foot-text .sys{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:8px;line-height:1.7}
.lf-rcpt .seal{width:124px;height:124px;flex:0 0 auto}
.lf-rcpt .seal-txt{font-family:"Lora",Georgia,serif;font-weight:600;font-size:12px;letter-spacing:1.5px}
.lf-rcpt .seal-lf{font-family:"Lora",Georgia,serif;font-weight:700;font-size:38px;letter-spacing:1px}
.lf-rcpt .seal-date{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:7.5px;letter-spacing:1px}
.lf-rcpt .powered{display:flex;align-items:center;gap:9px;justify-content:flex-end}
.lf-rcpt .powered .pl{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.lf-rcpt .powered .pmark{width:22px;height:22px}
.lf-rcpt .powered .pword{font-weight:800;font-size:17px;letter-spacing:-.02em}
.lf-rcpt .powered .pword .l{color:var(--lender-navy)}
.lf-rcpt .powered .pword .f{color:var(--fest-green)}
.lf-rcpt .foot-right{display:flex;flex-direction:column;align-items:flex-end;gap:14px}
.lf-rcpt .actions{display:flex;gap:14px;margin-top:18px}
.lf-rcpt .actions button,.lf-rcpt .actions a{flex:1;border:none;cursor:pointer;border-radius:13px;padding:16px;font-family:inherit;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;gap:9px;transition:.2s;color:#fff}
.lf-rcpt .actions button svg,.lf-rcpt .actions a svg{width:19px;height:19px}
.lf-rcpt .btn-close{background:#E7E4DE;color:#4a4a46;max-width:200px;flex:0 0 200px}
.lf-rcpt .btn-close:hover{background:#dcd8d0}
.lf-rcpt .btn-print{background:linear-gradient(180deg,var(--red2),var(--red1))}
.lf-rcpt .btn-print:hover{filter:brightness(1.05);transform:translateY(-1px)}
.lf-rcpt .btn-wa{background:var(--wa)}
.lf-rcpt .btn-wa:hover{filter:brightness(1.05);transform:translateY(-1px)}
@media screen and (max-width:860px){
  .lf-rcpt .r-body{grid-template-columns:1fr}
  .lf-rcpt .col-mid,.lf-rcpt .col-right{border-left:none;border-top:1px solid var(--line)}
  .lf-rcpt .r-footer{flex-direction:column;text-align:center;align-items:center}
  .lf-rcpt .foot-right{align-items:center}
  .lf-rcpt .powered{justify-content:center}
  .lf-rcpt .actions{flex-wrap:wrap}
  .lf-rcpt .btn-close{flex:1 1 100%;max-width:none}
}
@media print{
  @page{size:landscape;margin:6mm}
  html,body{background:#fff!important}
  body *{visibility:hidden!important}
  .lf-rcpt,.lf-rcpt *{visibility:visible!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .lf-rcpt{position:absolute!important;left:0;top:0;width:100%!important;max-width:none!important;padding:0!important;margin:0!important}
  /* keep the 3 columns side-by-side regardless of paper width */
  .lf-rcpt .r-body{grid-template-columns:1.18fr 1fr 1.12fr!important}
  .lf-rcpt .col-mid,.lf-rcpt .col-right{border-left:1px solid var(--line)!important;border-top:none!important}
  .lf-rcpt .r-footer{flex-direction:row!important;text-align:left!important;align-items:center!important}
  .lf-rcpt .actions{display:none!important}
  .lf-rcpt .receipt{box-shadow:none;border-radius:0}
}
`;

function PaymentReceipt({
  payment,
  receipt,
  tenant,
  onClose,
  onPrint,
  fetchReceiptPdf,
}) {
  // Load the receipt's display fonts once, lazily.
  useEffect(() => {
    const id = "lf-receipt-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);

  if (!payment || !receipt) return null;

  const typeColor =
    LENDER_TYPES[String(tenant?.business_type || "").trim().toLowerCase()]
      ?.color ||
    (/^#[0-9a-fA-F]{6}$/.test(tenant?.brand_color || "")
      ? tenant.brand_color
      : "#0E8A6E");

  const businessName = (tenant?.business_name || "").trim();
  const firstName = (receipt.client_name || "").trim().split(/\s+/)[0] || "there";
  const txnCode = payment.transaction_code || `TXN-${payment.id || ""}`;

  const dateObj = payment.payment_date
    ? new Date(payment.payment_date)
    : payment.created_at
      ? new Date(payment.created_at)
      : new Date();
  const timeObj = payment.created_at ? new Date(payment.created_at) : null;
  const meta = [
    dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    timeObj &&
      timeObj.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }),
    payment.payment_method && `via ${payment.payment_method}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const [amtWhole, amtDec = "00"] = Number(payment.amount_paid || 0)
    .toFixed(2)
    .split(".");
  const amountWhole = Number(amtWhole).toLocaleString("en-KE");

  const sealDate = dateObj
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
  const sealLocation = [tenant?.city, tenant?.country]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();

  // Lender monogram (header tile + seal centre) — the lender's own 3-letter
  // code prefix that the backend bakes into every code (e.g. "PAY" in
  // LN-PAY-112023-00275). Pulled from the loan this receipt is serving, then
  // the client/txn code; falls back to 3-letter business-name initials.
  const codePrefix = [receipt.loan_code, receipt.client_code, txnCode]
    .map((c) => (String(c || "").match(/^[A-Za-z]+-([A-Za-z0-9]{2,5})-/) || [])[1])
    .find(Boolean);
  const SUFFIXES = new Set([
    "ltd", "limited", "company", "co", "plc", "inc", "llc", "group",
    "enterprises", "enterprise", "services", "sacco", "microfinance", "bank",
  ]);
  const nameWords = businessName.split(/\s+/).filter(Boolean);
  const sigWords = nameWords.filter(
    (w) => !SUFFIXES.has(w.toLowerCase().replace(/[^a-z]/gi, "")),
  );
  const baseWords = sigWords.length ? sigWords : nameWords;
  const nameInitials =
    baseWords.length >= 3
      ? baseWords.slice(0, 3).map((w) => w[0]).join("")
      : baseWords.length === 2
        ? baseWords[0][0] + baseWords[1].slice(0, 2)
        : (baseWords[0] || "LEN").slice(0, 3);
  const initials = (codePrefix || nameInitials || "LEN")
    .toUpperCase()
    .slice(0, 3);
  const monogramFont = initials.length >= 3 ? 18 : initials.length === 2 ? 22 : 26;
  const sealMonoFont = initials.length >= 3 ? 24 : initials.length === 2 ? 30 : 40;

  // Header identity — the lender's own name leads; address = location + contact.
  const headerSub = [
    tenant?.business_type,
    [tenant?.city, tenant?.country].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  const headerContact = [tenant?.support_phone, tenant?.support_email]
    .filter(Boolean)
    .join(" · ");

  // Seal: scale the wrapped business name so long names still fit the top arc.
  const sealName = businessName.toUpperCase();
  const sealNameFont =
    sealName.length <= 12 ? 13
      : sealName.length <= 18 ? 11
        : sealName.length <= 24 ? 9
          : sealName.length <= 30 ? 7.6
            : 6.6;
  const sealNameLS =
    sealName.length <= 18 ? 1.5 : sealName.length <= 24 ? 1 : 0.5;

  const handlePrint = () => (onPrint ? onPrint() : window.print());

  // WhatsApp the receipt to the client. Caption = the payment details. When
  // the receipt PDF can be fetched (admin) AND the browser supports sharing
  // files (mobile), we attach the actual PDF via the native share sheet — the
  // client picks the WhatsApp chat. Otherwise we open a WhatsApp chat aimed at
  // the client's number with the details, downloading the PDF so it can be
  // attached manually. (wa.me links can't carry an attachment, and there's no
  // WhatsApp Business API to push a document to a number server-side.)
  const onWhatsApp = async () => {
    const dateStr = dateObj.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
    const caption = [
      `Payment received${businessName ? ` — ${businessName}` : ""}`,
      `Receipt: ${txnCode}`,
      receipt.client_name && `Client: ${receipt.client_name}`,
      `Amount paid: ${money(payment.amount_paid)}${payment.payment_method ? ` via ${payment.payment_method}` : ""}`,
      `Date: ${dateStr}`,
      receipt.loan_code && `Loan: ${receipt.loan_code}`,
      `Remaining balance: ${money(receipt.remaining_balance)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const phone = (receipt.client_phone || "").replace(/[^0-9]/g, "");
    const waChat = () =>
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`,
        "_blank",
      );

    // No PDF source (e.g. customer portal) → just open the chat with details.
    if (!fetchReceiptPdf) return waChat();

    let pdf = null;
    try {
      pdf = await fetchReceiptPdf();
    } catch (err) {
      console.error("Receipt PDF fetch failed:", err);
    }
    if (!pdf?.blob) return waChat();

    const file = new File([pdf.blob], pdf.filename || `Receipt-${txnCode}.pdf`, {
      type: "application/pdf",
    });

    // Native share with the PDF attached + caption (mobile / supported browsers).
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          text: caption,
          title: `Payment Receipt ${txnCode}`,
        });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return; // user dismissed the sheet
        // any other failure → fall through to the chat + download path
      }
    }

    // Desktop fallback: hand over the PDF for manual attach, open the chat.
    const url = URL.createObjectURL(pdf.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    waChat();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div
          className="lf-rcpt"
          onClick={(e) => e.stopPropagation()}
          style={{ "--red2": typeColor, "--red1": darken(typeColor, 0.72) }}
        >
          <style>{CSS}</style>

      <div className="receipt">
        {/* ===== HEADER ===== */}
        <div className="r-header">
          <div className="brand">
            <span className="monogram" style={{ fontSize: monogramFont }}>
              {initials}
            </span>
            <span className="word">
              <span className="name">{businessName || "Your Business"}</span>
              {headerSub && <span className="sub">{headerSub}</span>}
              {headerContact && <span className="contact">{headerContact}</span>}
            </span>
          </div>
          <div className="header-right">
            <div className="doc-meta">
              <div className="title">PAYMENT RECEIVED</div>
              <div className="txn mono">{txnCode}</div>
            </div>
            <span className="paid">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" fill="rgba(46,158,91,.9)" stroke="none" />
                <path d="M7 12.5l3.2 3.2L17 9" />
              </svg>
              Paid
            </span>
          </div>
        </div>

        {/* ===== BODY ===== */}
        <div className="r-body">
          <div className="col-left">
            <div className="greet serif">Thank you, {firstName}.</div>
            <div className="lbl">Amount paid</div>
            <div className="amount serif">
              KES {amountWhole}
              <sup>.{amtDec}</sup>
            </div>
            <div className="paid-meta">{meta}</div>
          </div>

          <div className="col-mid">
            <div className="details">
              <Detail label="Client" value={receipt.client_name}>
                <circle cx="12" cy="8" r="3.4" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </Detail>
              <Detail label="Client code" value={receipt.client_code} code>
                <path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </Detail>
              <Detail label="Phone" value={receipt.client_phone}>
                <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L20 13l-3 5a13 13 0 01-13-13z" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </Detail>
              <Detail label="Method" value={payment.payment_method}>
                <rect x="3" y="6" width="18" height="13" rx="2.5" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 10h18" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </Detail>
              <Detail label="Loan code" value={receipt.loan_code} code>
                <path d="M12 3v18M8 7.5c0-1.4 1.8-2.5 4-2.5s4 1.1 4 2.5-1.8 2.5-4 2.5-4 1.1-4 2.5 1.8 2.5 4 2.5 4-1.1 4-2.5" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </Detail>
            </div>
          </div>

          <div className="col-right">
            <div className="summary">
              <h3>Loan Summary</h3>
              <div className="srow"><span className="k">Principal</span><span className="v">{money(receipt.principal)}</span></div>
              <div className="srow"><span className="k">Total due</span><span className="v">{money(receipt.total_amount_due)}</span></div>
              <div className="srow"><span className="k">This payment</span><span className="v neg">−{money(payment.amount_paid)}</span></div>
              <div className="sbal"><span className="k">Remaining balance</span><span className="v serif">{money(receipt.remaining_balance)}</span></div>
            </div>
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="r-footer">
          <div className="foot-text">
            <div className="rec">A receipt for your records.</div>
            <div className="sys">This is a system-generated document and requires no signature.</div>
          </div>

          <svg className="seal" viewBox="0 0 200 200" aria-label="Company seal">
            <defs>
              <path id="lfTopArc" d="M 32 100 A 68 68 0 0 1 168 100" />
              <path id="lfBotArc" d="M 40 108 A 60 60 0 0 0 160 108" />
            </defs>
            <circle cx="100" cy="100" r="88" fill="none" stroke="var(--seal)" strokeWidth="2.5" />
            <circle cx="100" cy="100" r="80" fill="none" stroke="var(--seal)" strokeWidth="1" />
            <circle cx="100" cy="100" r="54" fill="none" stroke="var(--seal)" strokeWidth="1.5" />
            <text
              className="seal-txt"
              fill="var(--seal)"
              style={{ fontSize: sealNameFont, letterSpacing: sealNameLS }}
            >
              <textPath href="#lfTopArc" startOffset="50%" textAnchor="middle">
                {sealName}
              </textPath>
            </text>
            <text className="seal-txt" fill="var(--seal)">
              <textPath href="#lfBotArc" startOffset="50%" textAnchor="middle">
                {sealLocation}
              </textPath>
            </text>
            <text
              x="100"
              y="98"
              textAnchor="middle"
              className="seal-lf"
              fill="var(--seal)"
              style={{ fontSize: sealMonoFont }}
            >
              {initials}
            </text>
            <rect x="72" y="112" width="56" height="15" rx="3" fill="none" stroke="var(--seal)" strokeWidth="1" />
            <text x="100" y="122.5" textAnchor="middle" className="seal-date" fill="var(--seal)">{sealDate}</text>
            <path d="M16 100 l5 -5 5 5 -5 5 z" fill="var(--seal)" />
            <path d="M184 100 l-5 -5 -5 5 5 5 z" fill="var(--seal)" />
          </svg>

          <div className="foot-right">
            <div className="powered">
              <span className="pl">Powered by</span>
              <svg className="pmark" viewBox="0 0 100 100">
                <rect x="14" y="58" width="17" height="26" rx="7" fill="#0A5C4C" />
                <rect x="39" y="44" width="17" height="40" rx="7" fill="#0E8A6E" />
                <rect x="64" y="30" width="17" height="54" rx="7" fill="#22B488" />
                <path d="M70 3 Q75 12 84 17 Q75 22 70 31 Q65 22 56 17 Q65 12 70 3 Z" fill="#F6A92B" />
              </svg>
              <span className="pword"><span className="l">Lender</span><span className="f">Fest</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== ACTIONS ===== */}
      <div className="actions">
        <button className="btn-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          Close
        </button>
        <button className="btn-print" onClick={handlePrint}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-4a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2h-2M6 14h12v7H6z" />
          </svg>
          Print
        </button>
        <button className="btn-wa" onClick={onWhatsApp}>
          <svg viewBox="0 0 24 24" fill="#fff">
            <path d="M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1012 2zm0 2a8 8 0 11-4.1 14.8l-.3-.2-2.8.7.8-2.7-.2-.3A8 8 0 0112 4zm4.4 9.9c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 01-1.9-1.2 7.2 7.2 0 01-1.3-1.7c-.1-.2 0-.4.1-.5l.4-.4.2-.4v-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 00-.7.3 2.8 2.8 0 00-.9 2.1 4.9 4.9 0 001 2.6 11 11 0 004.3 3.8c2.5 1 2.5.7 3 .6a2.5 2.5 0 001.6-1.1 2 2 0 00.1-1.1c0-.1-.2-.2-.4-.3z" />
          </svg>
          WhatsApp
        </button>
      </div>
        </div>
      </div>
    </div>
  );
}

// One labelled detail row with an icon chip.
function Detail({ label, value, code, children }) {
  return (
    <div className="drow">
      <span className="dchip">
        <svg viewBox="0 0 24 24">{children}</svg>
      </span>
      <span className="dtext">
        <span className="dl">{label}</span>
        <span className={`dv${code ? " code" : ""}`}>{value || "—"}</span>
      </span>
    </div>
  );
}

export default PaymentReceipt;
