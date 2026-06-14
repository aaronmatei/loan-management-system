// ============================================================
// Shared PDF document builders.
//
// These produce the exact same PDFs that the /reports/pdf/*
// download endpoints serve, but return an in-memory Buffer so
// the same documents can also be attached to emails. reports.js
// pipes the buffer to the HTTP response; the email service
// attaches it. Single source of truth for every PDF layout.
// ============================================================

import PDFDocument from "pdfkit";
import { query } from "../config/database.js";
import { drawPdfStamp } from "./stamp.js";
import { FONT, registerPdfFonts } from "./pdfFonts.js";
import { drawBrandMark } from "./pdfBrand.js";

// Thrown when the primary record (client/loan/transaction) does
// not exist, so callers can map it to an HTTP 404.
export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.notFound = true;
  }
}

// Kept identical to the formatters reports.js uses for PDFs so the
// generated documents are byte-for-byte unchanged.
const formatCurrency = (amount) => {
  return `KES ${parseFloat(amount || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (date) => {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

// Tenant scoping for the primary-record lookups. `tid` is the
// caller's tenant id (number) or null/undefined for a platform
// admin, in which case no scope is applied. Mirrors
// utils/tenantScope.js but takes a raw id since these builders are
// not request-bound (also called by the email service).
const tClause = (tid, startParam, col = "tenant_id") =>
  tid == null
    ? { clause: "", params: [] }
    : { clause: ` AND ${col} = $${startParam + 1}`, params: [tid] };

// Collect a PDFKit document into a single Buffer. Listeners must be
// attached before doc.end(); the promise resolves once flushed.
const streamToBuffer = (doc) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

// Receipt palette — mirrors components/PaymentReceipt.buildReceiptTheme
// so the PDF and the on-screen receipt are the same document. Driven by
// the tenant brand color; deep emerald is ONLY a fallback for a
// missing/invalid hex, never a co-default. Returns [r,g,b] arrays
// (pdfkit's native color form).
const receiptTheme = (brandColor) => {
  const valid = brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor);
  const n = parseInt((valid ? brandColor : "#0a5c4c").slice(1), 16);
  const base = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const shift = (amt) =>
    base.map((v) => Math.max(0, Math.min(255, v + amt)));
  return {
    accent: base,
    deepTop: shift(-20),
    deepBottom: shift(-70),
    accentLight: shift(90),
  };
};

// ============================================================
// CLIENT STATEMENT
// ============================================================
export const buildClientStatementPdf = async (clientId, tid) => {
  const ct = tClause(tid, 1);
  const clientResult = await query(
    `SELECT c.*,
            tn.business_name AS tenant_name,
            tn.city AS tenant_city,
            tn.country AS tenant_country
       FROM clients c
       LEFT JOIN tenants tn ON tn.id = c.tenant_id
      WHERE c.id = $1${ct.clause}`,
    [clientId, ...ct.params],
  );
  if (clientResult.rows.length === 0) {
    throw new NotFoundError("Client not found");
  }
  const client = clientResult.rows[0];

  const loansResult = await query(
    // total_paid here is the SETTLED amount: cash applied to
    // amount_due (per-row LEAST cap excludes principal knockdown)
    // + amount_due-side waivers. Same formula the staff
    // /payments/loan/:id/summary uses, so the client statement
    // shows what the borrower actually owes — the prior
    // SUM(t.amount_paid) reported gross cash and produced a
    // non-zero balance on loans that had been settled partly by
    // waiver, even when status=COMPLETED.
    `
      SELECT l.*,
        (
          (SELECT COALESCE(SUM(LEAST(amount_paid, amount_due)), 0)
             FROM payment_schedules WHERE loan_id = l.id)
          +
          (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
             FROM loan_waivers
            WHERE loan_id = l.id AND status = 'approved')
        ) AS total_paid
      FROM loans l
      WHERE l.client_id = $1
      ORDER BY l.created_at DESC
    `,
    [clientId],
  );

  const paymentsResult = await query(
    `
      SELECT t.*, l.loan_code
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      WHERE t.client_id = $1 AND t.payment_status = 'completed'
      ORDER BY t.payment_date DESC
    `,
    [clientId],
  );

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  registerPdfFonts(doc);
  const filename = `client_statement_${client.client_code}_${new Date().toISOString().split("T")[0]}.pdf`;
  const done = streamToBuffer(doc);

  doc
    .fontSize(20)
    .fillColor("#0e8a6e")
    .text("LOAN MANAGEMENT SYSTEM", { align: "center" });
  doc
    .fontSize(14)
    .fillColor("#000")
    .text("Client Statement", { align: "center" });
  doc.moveDown();

  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Generated: ${formatDate(new Date())}`, { align: "right" });
  doc.moveDown();

  doc.rect(50, doc.y, 500, 100).stroke("#0e8a6e");
  doc.fontSize(12).fillColor("#000");
  const boxY = doc.y + 10;
  doc.text(`Client Code: ${client.client_code}`, 60, boxY);
  doc.text(`Name: ${client.first_name} ${client.last_name}`, 60, boxY + 15);
  doc.text(`Phone: ${client.phone_number}`, 60, boxY + 30);
  doc.text(`Email: ${client.email || "N/A"}`, 60, boxY + 45);
  doc.text(`Business: ${client.business_name || "N/A"}`, 60, boxY + 60);
  doc.text(`Member Since: ${formatDate(client.created_at)}`, 60, boxY + 75);

  doc.y = boxY + 100;
  doc.moveDown();

  const totalBorrowed = loansResult.rows.reduce(
    (sum, l) => sum + parseFloat(l.principal_amount),
    0,
  );
  const totalDue = loansResult.rows.reduce(
    (sum, l) => sum + parseFloat(l.total_amount_due),
    0,
  );
  const totalPaid = loansResult.rows.reduce(
    (sum, l) => sum + parseFloat(l.total_paid),
    0,
  );
  const outstanding = totalDue - totalPaid;

  doc.fontSize(14).fillColor("#0e8a6e").text("SUMMARY", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Total Loans: ${loansResult.rows.length}`);
  doc.text(`Total Borrowed: ${formatCurrency(totalBorrowed)}`);
  doc.text(`Total Due (with interest): ${formatCurrency(totalDue)}`);
  doc.text(`Total Paid: ${formatCurrency(totalPaid)}`);
  doc
    .fontSize(12)
    .fillColor(outstanding > 0 ? "#DC2626" : "#059669")
    .text(`Outstanding Balance: ${formatCurrency(outstanding)}`, {
      continued: false,
    });
  doc.moveDown();

  if (loansResult.rows.length > 0) {
    doc
      .fontSize(14)
      .fillColor("#0e8a6e")
      .text("LOAN HISTORY", { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    doc.fontSize(9).fillColor("#000");
    doc.text("Loan Code", 50, tableTop);
    doc.text("Principal", 130, tableTop);
    doc.text("Total Due", 200, tableTop);
    doc.text("Paid", 270, tableTop);
    doc.text("Balance", 330, tableTop);
    doc.text("Status", 400, tableTop);
    doc.text("Start Date", 460, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    let y = tableTop + 20;
    loansResult.rows.forEach((loan) => {
      const balance =
        parseFloat(loan.total_amount_due) - parseFloat(loan.total_paid);
      doc.fontSize(8);
      doc.text(loan.loan_code, 50, y);
      doc.text(formatCurrency(loan.principal_amount), 130, y);
      doc.text(formatCurrency(loan.total_amount_due), 200, y);
      doc.text(formatCurrency(loan.total_paid), 270, y);
      doc.text(formatCurrency(balance), 330, y);
      doc.text(loan.status, 400, y);
      doc.text(formatDate(loan.start_date), 460, y);
      y += 15;

      if (y > 700) {
        doc.addPage();
        y = 50;
      }
    });

    doc.y = y + 10;
    doc.moveDown();
  }

  if (paymentsResult.rows.length > 0) {
    if (doc.y > 600) doc.addPage();

    doc
      .fontSize(14)
      .fillColor("#0e8a6e")
      .text("PAYMENT HISTORY (Last 20)", { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    doc.fontSize(9).fillColor("#000");
    doc.text("Date", 50, tableTop);
    doc.text("Transaction", 130, tableTop);
    doc.text("Loan Code", 240, tableTop);
    doc.text("Amount", 320, tableTop);
    doc.text("Method", 400, tableTop);
    doc.text("Reference", 470, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    let y = tableTop + 20;
    paymentsResult.rows.slice(0, 20).forEach((payment) => {
      doc.fontSize(8);
      doc.text(formatDate(payment.payment_date), 50, y);
      doc.text(payment.transaction_code, 130, y);
      doc.text(payment.loan_code, 240, y);
      doc.text(formatCurrency(payment.amount_paid), 320, y);
      doc.text(payment.payment_method, 400, y);
      doc.text(payment.payment_reference || "-", 470, y);
      y += 15;

      if (y > 750) {
        doc.addPage();
        y = 50;
      }
    });
  }

  doc.fontSize(8).fillColor("#666");
  doc.text(
    "This is a system-generated statement. For inquiries, contact our office.",
    50,
    770,
    { align: "center", width: 495 },
  );

  // Official stamp — bottom-right, doesn't shift the system-
  // generated footer text. Anchored to a fixed page coordinate
  // so it sits in the same spot whether the LOAN HISTORY table
  // ran short or long.
  drawPdfStamp(doc, {
    x: 420,
    y: 640,
    size: 130,
    tenant: {
      business_name: client.tenant_name,
      city: client.tenant_city,
      country: client.tenant_country,
    },
  });

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// LOAN STATEMENT
// ============================================================
export const buildLoanStatementPdf = async (loanId, tid) => {
  const lt = tClause(tid, 1, "l.tenant_id");
  const loanResult = await query(
    `
      SELECT l.*,
             c.first_name, c.last_name, c.phone_number, c.email, c.client_code,
             tn.business_name AS tenant_name,
             tn.city AS tenant_city,
             tn.country AS tenant_country
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      JOIN tenants tn ON tn.id = l.tenant_id
      WHERE l.id = $1${lt.clause}
    `,
    [loanId, ...lt.params],
  );

  if (loanResult.rows.length === 0) {
    throw new NotFoundError("Loan not found");
  }
  const loan = loanResult.rows[0];

  const scheduleResult = await query(
    "SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
    [loanId],
  );

  const transactionsResult = await query(
    "SELECT * FROM transactions WHERE loan_id = $1 AND payment_status = $2 ORDER BY payment_date",
    [loanId, "completed"],
  );

  // Approved waivers + per-row waiver attribution. Both feed the
  // LOAN DETAILS settlement breakdown — the prior version showed
  // "Total Paid: 12,000 / Balance: 500" with Status COMPLETED
  // because it used SUM(amount_paid) (gross cash) and ignored the
  // waiver-settled portion of amount_due. After the fix, the
  // statement reports cash and waivers separately and the balance
  // matches the loan's actual closed state.
  const waiversResult = await query(
    `SELECT id, amount, allocation, type, approved_at, reason
       FROM loan_waivers
      WHERE loan_id = $1 AND status = 'approved'
      ORDER BY approved_at NULLS LAST, created_at`,
    [loanId],
  );

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  registerPdfFonts(doc);
  const filename = `loan_statement_${loan.loan_code}_${new Date().toISOString().split("T")[0]}.pdf`;
  const done = streamToBuffer(doc);

  doc
    .fontSize(20)
    .fillColor("#0e8a6e")
    .text("LOAN STATEMENT", { align: "center" });
  doc.fontSize(14).fillColor("#000").text(loan.loan_code, { align: "center" });
  doc.moveDown();
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Generated: ${formatDate(new Date())}`, { align: "right" });
  doc.moveDown();

  doc.rect(50, doc.y, 500, 80).stroke("#0e8a6e");
  const boxY = doc.y + 10;
  doc.fontSize(11).fillColor("#000");
  doc.text(`Client: ${loan.first_name} ${loan.last_name}`, 60, boxY);
  doc.text(`Client Code: ${loan.client_code}`, 60, boxY + 15);
  doc.text(`Phone: ${loan.phone_number}`, 60, boxY + 30);
  doc.text(`Email: ${loan.email || "N/A"}`, 60, boxY + 45);
  doc.y = boxY + 80;
  doc.moveDown();

  const totalDue = parseFloat(loan.total_amount_due) || 0;
  // Cash leg: gross cash received less any refundable
  // overpayment. amount_paid alone over-states what the borrower
  // actually parted with when a refund is pending.
  const grossCashPaid = transactionsResult.rows.reduce(
    (sum, t) =>
      sum
      + parseFloat(t.amount_paid || 0)
      - parseFloat(t.overpayment_portion || 0),
    0,
  );
  // Penalty cash + amount-due cash split — useful in the
  // breakdown because customers reading the statement otherwise
  // can't see why the schedule rows' "Amount Paid" sum to a
  // smaller number than the gross cash.
  const penaltyCashPaid = transactionsResult.rows.reduce(
    (sum, t) => sum + parseFloat(t.penalty_portion || 0),
    0,
  );
  const cashToAmountDue = Math.max(0, grossCashPaid - penaltyCashPaid);
  // Waivers applied to amount_due vs penalty. allocation.amount_total
  // covers interest+principal (the amount_due side); allocation.penalty_total
  // covers fines. Pulled from approved waivers only — pending/reversed
  // don't count toward settlement.
  const waivedAmountDue = waiversResult.rows.reduce(
    (s, w) => s + parseFloat(w.allocation?.amount_total || 0),
    0,
  );
  const waivedPenalty = waiversResult.rows.reduce(
    (s, w) => s + parseFloat(w.allocation?.penalty_total || 0),
    0,
  );
  // "Total settled" = what the borrower no longer owes, regardless
  // of source. This is the number that must agree with the
  // loan.status ("COMPLETED" only when settled >= due). Capped at
  // total_due so an overpayment (refundable) doesn't push it
  // above the contract.
  const totalSettled = Math.min(totalDue, cashToAmountDue + waivedAmountDue);
  const balance = Math.max(0, totalDue - totalSettled);

  doc
    .fontSize(14)
    .fillColor("#0e8a6e")
    .text("LOAN DETAILS", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Principal Amount: ${formatCurrency(loan.principal_amount)}`);
  if (parseFloat(loan.processing_fee || 0) > 0) {
    doc.text(
      `Processing Fee: ${formatCurrency(loan.processing_fee)} (${parseFloat(loan.processing_fee_rate)}%)`,
    );
  }
  doc.text(`Interest Rate: ${loan.interest_rate}% per month`);
  doc.text(`Duration: ${loan.loan_duration_months} months`);
  doc.text(`Total Interest: ${formatCurrency(loan.total_interest)}`);
  doc.text(`Total Amount Due: ${formatCurrency(totalDue)}`);
  doc.text(`Cash Paid: ${formatCurrency(grossCashPaid)}`);
  // Sub-line breaks the cash into where it landed (amount_due vs
  // penalty) so the row totals reconcile when the customer adds
  // up the schedule's "Amount Paid" column. Only show when there's
  // actually penalty cash to separate.
  if (penaltyCashPaid > 0) {
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `   • To amount due: ${formatCurrency(cashToAmountDue)}   • To penalty: ${formatCurrency(penaltyCashPaid)}`,
        { indent: 10 },
      )
      .fontSize(10)
      .fillColor("#000");
  }
  if (waivedAmountDue > 0 || waivedPenalty > 0) {
    doc.text(
      `Waivers Applied: ${formatCurrency(waivedAmountDue + waivedPenalty)}`,
    );
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `   • To amount due: ${formatCurrency(waivedAmountDue)}   • To penalty: ${formatCurrency(waivedPenalty)}`,
        { indent: 10 },
      )
      .fontSize(10)
      .fillColor("#000");
  }
  doc.text(`Total Settled: ${formatCurrency(totalSettled)}`);
  doc
    .fontSize(12)
    .fillColor(balance > 0 ? "#DC2626" : "#059669")
    .text(`Balance: ${formatCurrency(balance)}`);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Status: ${loan.status.toUpperCase()}`);
  doc.text(`Start Date: ${formatDate(loan.start_date)}`);
  doc.text(`End Date: ${formatDate(loan.end_date)}`);
  doc.moveDown();

  doc
    .fontSize(14)
    .fillColor("#0e8a6e")
    .text("PAYMENT SCHEDULE", { underline: true });
  doc.moveDown(0.5);

  let y = doc.y;
  doc.fontSize(9).fillColor("#000");
  doc.text("Payment #", 50, y);
  doc.text("Due Date", 130, y);
  doc.text("Amount Due", 220, y);
  doc.text("Amount Paid", 310, y);
  doc.text("Status", 400, y);
  doc.text("Paid Date", 470, y);
  doc.moveTo(50, y + 15).lineTo(545, y + 15).stroke();
  y += 20;

  let scheduleSumDue = 0;
  let scheduleSumPaid = 0;
  scheduleResult.rows.forEach((s) => {
    const due = parseFloat(s.amount_due || 0);
    const paid = parseFloat(s.amount_paid || 0);
    scheduleSumDue += due;
    scheduleSumPaid += paid;
    doc.fontSize(8);
    doc.text(`${s.payment_number}/${loan.loan_duration_months}`, 50, y);
    doc.text(formatDate(s.due_date), 130, y);
    doc.text(formatCurrency(due), 220, y);
    doc.text(formatCurrency(paid), 310, y);
    doc.fillColor(
      s.status === "paid"
        ? "#059669"
        : s.status === "overdue"
          ? "#DC2626"
          : "#666",
    );
    doc.text(s.status.toUpperCase(), 400, y);
    doc.fillColor("#000");
    doc.text(s.actual_payment_date ? formatDate(s.actual_payment_date) : "-", 470, y);
    y += 15;
    if (y > 750) {
      doc.addPage();
      y = 50;
    }
  });
  // Schedule totals row so the customer can verify the column
  // sums match the LOAN DETAILS breakdown above. The "Amount Paid"
  // total here equals cash_to_amount_due — which is normally
  // LESS than Total Settled when waivers covered part of the
  // amount_due (the rest came from waivers, listed in LOAN
  // DETAILS as "Waivers Applied · To amount due").
  doc.moveTo(50, y).lineTo(545, y).stroke();
  y += 4;
  doc.fontSize(9).fillColor("#000");
  doc.text("TOTALS", 50, y);
  doc.text(formatCurrency(scheduleSumDue), 220, y);
  doc.text(formatCurrency(scheduleSumPaid), 310, y);
  y += 15;

  // Official stamp — bottom-right of the page so it sits below
  // the data. Uses the lender's name + city + country so each
  // tenant brands its own documents.
  drawPdfStamp(doc, {
    x: 410,
    y: Math.min(y + 10, 670),
    size: 130,
    tenant: {
      business_name: loan.tenant_name,
      city: loan.tenant_city,
      country: loan.tenant_country,
    },
  });

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// RECEIPT — brand-driven, mirrors components/PaymentReceipt.jsx so the
// printed/emailed PDF and the on-screen receipt are the same document.
// ============================================================
export const buildReceiptPdf = async (transactionId, tid) => {
  const tt = tClause(tid, 1, "t.tenant_id");
  const result = await query(
    `
      SELECT t.*,
        l.loan_code, l.principal_amount, l.total_amount_due,
        c.first_name, c.last_name, c.phone_number, c.client_code,
        tn.brand_color, tn.business_name, tn.business_type, tn.hide_platform_branding,
        tn.city AS tenant_city, tn.country AS tenant_country
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      JOIN clients c ON t.client_id = c.id
      JOIN tenants tn ON t.tenant_id = tn.id
      WHERE t.id = $1${tt.clause}
    `,
    [transactionId, ...tt.params],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError("Transaction not found");
  }
  const txn = result.rows[0];

  // Balance AS OF this payment: cumulative settlement through this
  // transaction so a re-printed receipt still reflects the state at
  // the time it was paid. Two bugs in the old formula:
  //   1) SUM(amount_paid) is the gross transaction figure — included
  //      penalty and overpayment, both of which do NOT pay down
  //      amount_due. Receipt under-stated remaining by the penalty
  //      cash applied to the loan.
  //   2) Waivers weren't subtracted at all. A receipt issued after a
  //      waiver+cash combo that fully cleared the loan still showed a
  //      "remaining" equal to the waived amount.
  // Now: cash net of penalty/overpayment through this txn, plus
  // waivers approved on or before this payment's date. Mirrors the
  // formula buildReceiptBlock and the loans-list balance_due use, so
  // the printed PDF, the on-screen receipt, and every other surface
  // can't disagree.
  const paidThroughRes = await query(
    `SELECT
        COALESCE(SUM(
          amount_paid - COALESCE(penalty_portion, 0) - COALESCE(overpayment_portion, 0)
        ), 0) AS cash_through,
        (SELECT COALESCE(SUM(COALESCE((allocation->>'amount_total')::float, 0)), 0)
           FROM loan_waivers
          WHERE loan_id = $1 AND status = 'approved'
            AND approved_at <= $3) AS waived_through
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed' AND id <= $2`,
    [txn.loan_id, txn.id, txn.payment_date],
  );
  const cashThrough = parseFloat(paidThroughRes.rows[0].cash_through);
  const waivedThrough = parseFloat(paidThroughRes.rows[0].waived_through);
  const paidThrough = cashThrough + waivedThrough;
  const remaining = Math.max(0, parseFloat(txn.total_amount_due) - paidThrough);

  // Next unpaid installment (schedules are already allocated by now).
  const nextRes = await query(
    `SELECT payment_number, due_date, amount_due,
            COALESCE(amount_paid, 0) AS amount_paid
       FROM payment_schedules
      WHERE loan_id = $1 AND status <> 'paid'
      ORDER BY due_date ASC, payment_number ASC
      LIMIT 1`,
    [txn.loan_id],
  );
  const next = nextRes.rows[0] || null;
  const nextDue = next
    ? Math.max(0, parseFloat(next.amount_due) - parseFloat(next.amount_paid))
    : 0;
  const fullyPaid = remaining <= 0;

  const firstName =
    (txn.first_name || "").trim() || txn.business_name || "there";

  const TYPE_COLORS = {
    microfinance: "#0086cc",
    sacco: "#ea580c",
    chama: "#7c3aed",
    individual: "#16a34a",
    other: "#64748b",
  };
  const typeColor =
    TYPE_COLORS[String(txn.business_type || "").trim().toLowerCase()] ||
    (/^#[0-9a-fA-F]{6}$/.test(txn.brand_color || "") ? txn.brand_color : "#0E8A6E");
  const darkenHex = (hex, f) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (
      "#" +
      [c(((n >> 16) & 255) * f), c(((n >> 8) & 255) * f), c((n & 255) * f)]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Parchment receipt — mirrors the on-screen PaymentReceipt. Header band
  // is the lender's TYPE colour (microfinance/sacco/chama/individual).
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  registerPdfFonts(doc);
  const filename = `receipt_${txn.transaction_code}.pdf`;
  const done = streamToBuffer(doc);

  const PW = doc.page.width;
  const PH = doc.page.height;

  doc.rect(0, 0, PW, PH).fill("#F3ECDB");

  const headH = 92;
  const hg = doc.linearGradient(0, 0, PW, 0);
  hg.stop(0, darkenHex(typeColor, 0.72)).stop(1, typeColor);
  doc.rect(0, 0, PW, headH).fill(hg);

  drawBrandMark(doc, { x: 36, y: 26, size: 40, variant: "light" });
  doc.fillColor("#ffffff").font(FONT.display).fontSize(24).text("LenderFest", 86, 34);

  doc
    .font(FONT.bold)
    .fontSize(10)
    .fillColor("#ffffff")
    .fillOpacity(0.92)
    .text("PAYMENT RECEIVED", PW - 360, 28, {
      width: 280,
      align: "right",
      characterSpacing: 1.2,
    });
  doc
    .font("Courier")
    .fontSize(10)
    .fillOpacity(0.8)
    .text(txn.transaction_code, PW - 360, 46, { width: 280, align: "right" });
  doc.fillOpacity(1);
  doc.font(FONT.bold).fontSize(9);
  const pillW = doc.widthOfString("PAID") + 24;
  const pillX = PW - 36 - pillW;
  doc.fillOpacity(0.16).roundedRect(pillX, 34, pillW, 22, 11).fill("#ffffff");
  doc
    .fillOpacity(1)
    .fillColor("#ffffff")
    .text("PAID", pillX, 40.5, { width: pillW, align: "center" });

  const bodyTop = headH + 34;
  const colL = 40;
  const colM = 332;
  const colR = 582;
  const divTop = headH + 16;
  const divBot = PH - 118;
  doc.lineWidth(0.7).strokeColor("#E2D9C3");
  doc.moveTo(colM - 22, divTop).lineTo(colM - 22, divBot).stroke();
  doc.moveTo(colR - 22, divTop).lineTo(colR - 22, divBot).stroke();

  doc
    .font(FONT.italic)
    .fontSize(26)
    .fillColor("#2B2A26")
    .text(`Thank you, ${firstName}.`, colL, bodyTop, { width: colM - colL - 30 });
  doc
    .font(FONT.bold)
    .fontSize(8)
    .fillColor("#9C9384")
    .text("AMOUNT PAID", colL, bodyTop + 58, { characterSpacing: 1.4 });
  const [whole, dec = "00"] = Number(txn.amount_paid || 0).toFixed(2).split(".");
  doc
    .font(FONT.display)
    .fontSize(38)
    .fillColor("#2B2A26")
    .text(`KES ${Number(whole).toLocaleString()}`, colL, bodyTop + 72, {
      continued: true,
    });
  doc.font(FONT.display).fontSize(18).fillColor("#9C9384").text(`.${dec}`);
  const timeStr = txn.created_at
    ? new Date(txn.created_at).toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
  const meta = [
    formatDate(txn.payment_date),
    timeStr,
    txn.payment_method && `via ${txn.payment_method}`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.font(FONT.reg).fontSize(11).fillColor("#6f6a5e").text(meta, colL, bodyTop + 128);

  const details = [
    ["CLIENT", `${txn.first_name || ""} ${txn.last_name || ""}`.trim(), false],
    ["CLIENT CODE", txn.client_code, true],
    ["PHONE", txn.phone_number, false],
    ["METHOD", txn.payment_method, false],
    ["LOAN CODE", txn.loan_code, true],
  ];
  let dyy = bodyTop;
  details.forEach(([label, value, mono]) => {
    doc
      .font(FONT.bold)
      .fontSize(8)
      .fillColor("#9C9384")
      .text(label, colM, dyy, { characterSpacing: 1.1 });
    doc
      .font(mono ? "Courier" : FONT.bold)
      .fontSize(mono ? 11 : 12.5)
      .fillColor("#2B2A26")
      .text(value || "—", colM, dyy + 12, { width: colR - colM - 30 });
    dyy += 42;
  });

  const boxX = colR;
  const boxW = PW - colR - 40;
  const boxY = bodyTop - 10;
  const boxH = divBot - boxY + 6;
  doc.roundedRect(boxX, boxY, boxW, boxH, 12).fill("#FAF6EC");
  doc
    .roundedRect(boxX, boxY, boxW, boxH, 12)
    .lineWidth(0.8)
    .strokeColor("#E2D9C3")
    .stroke();
  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor("#2B2A26")
    .text("Loan Summary", boxX, boxY + 16, { width: boxW, align: "center" });
  let ry = boxY + 50;
  const srow = (k, v, color) => {
    doc.font(FONT.reg).fontSize(11).fillColor("#6f6a5e").text(k, boxX + 18, ry);
    doc
      .font(FONT.bold)
      .fontSize(11)
      .fillColor(color || "#2B2A26")
      .text(v, boxX + 18, ry, { width: boxW - 36, align: "right" });
    ry += 26;
  };
  srow("Principal", money(txn.principal_amount));
  srow("Total due", money(txn.total_amount_due));
  srow("This payment", `-${money(txn.amount_paid)}`, "#C62A5A");
  const balY = boxY + boxH - 54;
  doc.roundedRect(boxX + 14, balY, boxW - 28, 42, 8).fill("#E9DFC7");
  doc
    .font(FONT.bold)
    .fontSize(11)
    .fillColor("#2B2A26")
    .text("Remaining balance", boxX + 26, balY + 14);
  doc
    .font(FONT.display)
    .fontSize(16)
    .fillColor("#2B2A26")
    .text(money(remaining), boxX + 14, balY + 11, {
      width: boxW - 40,
      align: "right",
    });

  const footY = PH - 94;
  doc
    .moveTo(40, footY)
    .lineTo(PW - 40, footY)
    .dash(2, { space: 3 })
    .lineWidth(0.8)
    .strokeColor("#d2c8af")
    .stroke()
    .undash();
  doc
    .font(FONT.italic)
    .fontSize(15)
    .fillColor("#2B2A26")
    .text("A receipt for your records.", 40, footY + 16);
  doc
    .font(FONT.reg)
    .fontSize(7.5)
    .fillColor("#9C9384")
    .text(
      "THIS IS A SYSTEM-GENERATED DOCUMENT AND REQUIRES NO SIGNATURE.",
      40,
      footY + 40,
      { width: 280, characterSpacing: 0.4 },
    );
  drawPdfStamp(doc, {
    x: (PW - 86) / 2,
    y: footY + 4,
    size: 86,
    tenant: {
      business_name: txn.business_name,
      city: txn.tenant_city,
      country: txn.tenant_country,
    },
    date: txn.payment_date || new Date(),
  });
  if (!txn.hide_platform_branding) {
    const pwY = footY + 32;
    doc
      .font(FONT.bold)
      .fontSize(8)
      .fillColor("#9C9384")
      .text("POWERED BY", PW - 250, pwY - 13, {
        width: 210,
        align: "right",
        characterSpacing: 1,
      });
    drawBrandMark(doc, { x: PW - 134, y: pwY - 2, size: 18 });
    doc
      .font(FONT.display)
      .fontSize(15)
      .fillColor("#10242A")
      .text("Lender", PW - 110, pwY - 2, { continued: true });
    doc.fillColor("#159A66").text("Fest");
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// LOAN AGREEMENT
// ============================================================
export const buildLoanAgreementPdf = async (loanId, tid) => {
  const lt = tClause(tid, 1, "l.tenant_id");
  const loanResult = await query(
    `
      SELECT l.*,
        c.first_name, c.last_name, c.phone_number, c.email,
        c.id_number, c.address, c.city, c.county, c.client_code,
        c.business_name, c.business_type
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1${lt.clause}
    `,
    [loanId, ...lt.params],
  );

  if (loanResult.rows.length === 0) {
    throw new NotFoundError("Loan not found");
  }
  const loan = loanResult.rows[0];

  // The agreement is between the loan's own lender (tenant) and the
  // borrower — always derive branding from the loan's tenant, never a
  // global singleton, so a platform admin generating it still gets
  // the correct lender's letterhead.
  const companyResult = await query(
    "SELECT * FROM company_settings WHERE tenant_id = $1",
    [loan.tenant_id],
  );
  const tenantResult = await query(
    "SELECT business_name, city, country FROM tenants WHERE id = $1",
    [loan.tenant_id],
  );
  const tenant = tenantResult.rows[0] || {};
  const company = companyResult.rows[0] || {
    company_name: "Your Company",
    company_address: "P.O Box 12345-00100, Nairobi",
    company_phone: "+254700000000",
    company_email: "info@yourcompany.com",
  };

  const scheduleResult = await query(
    "SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
    [loanId],
  );

  const monthlyPayment =
    parseFloat(loan.total_amount_due) /
    parseInt(loan.loan_duration_months, 10);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  registerPdfFonts(doc);
  const filename = `loan_agreement_${loan.loan_code}.pdf`;
  const done = streamToBuffer(doc);

  // ===== PAGE 1: AGREEMENT =====
  doc
    .fontSize(20)
    .fillColor("#0e8a6e")
    .text(company.company_name.toUpperCase(), { align: "center" });
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(company.company_address || "", { align: "center" });
  doc.text(
    `Phone: ${company.company_phone} | Email: ${company.company_email}`,
    { align: "center" },
  );
  if (company.business_registration_number) {
    doc.text(`Business Reg No: ${company.business_registration_number}`, {
      align: "center",
    });
  }
  doc.moveDown();

  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#0e8a6e");
  doc.moveDown();

  doc
    .fontSize(18)
    .fillColor("#000")
    .text("LOAN AGREEMENT", { align: "center", underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Agreement No: ${loan.loan_code}`, {
    align: "center",
  });
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Date: ${formatDate(loan.start_date)}`, { align: "center" });
  doc.moveDown();

  doc.fontSize(11).fillColor("#000");
  doc.text("THIS LOAN AGREEMENT is made on ", { continued: true });
  doc.font(FONT.bold).text(formatDate(loan.start_date), {
    continued: true,
  });
  doc.font(FONT.reg).text(" BETWEEN:");
  doc.moveDown(0.5);

  doc.fontSize(11).font(FONT.bold).text("LENDER:");
  doc.font(FONT.reg).fontSize(10);
  doc.text(`${company.company_name}`);
  doc.text(`${company.company_address}`);
  doc.text(`Phone: ${company.company_phone}`);
  doc.text(`Email: ${company.company_email}`);
  doc.text('(hereinafter referred to as "the Lender")');
  doc.moveDown(0.5);

  doc.fontSize(11).font(FONT.bold).text("AND");
  doc.moveDown(0.3);

  doc.fontSize(11).font(FONT.bold).text("BORROWER:");
  doc.font(FONT.reg).fontSize(10);
  doc.text(`Name: ${loan.first_name} ${loan.last_name}`);
  doc.text(`ID Number: ${loan.id_number || "N/A"}`);
  doc.text(`Phone: ${loan.phone_number}`);
  if (loan.email) doc.text(`Email: ${loan.email}`);
  doc.text(
    `Address: ${loan.address || "N/A"}, ${loan.city || ""}, ${
      loan.county || "Kenya"
    }`,
  );
  if (loan.business_name)
    doc.text(
      `Business: ${loan.business_name} (${loan.business_type || "N/A"})`,
    );
  doc.text(`Client Code: ${loan.client_code}`);
  doc.text('(hereinafter referred to as "the Borrower")');
  doc.moveDown();

  doc
    .fontSize(12)
    .fillColor("#0e8a6e")
    .font(FONT.bold)
    .text("1. LOAN TERMS", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#000").font(FONT.reg);

  const terms = [
    ["Principal Amount:", formatCurrency(loan.principal_amount)],
    ...(parseFloat(loan.processing_fee || 0) > 0
      ? [
          [
            "Processing Fee:",
            `${formatCurrency(loan.processing_fee)} (${parseFloat(loan.processing_fee_rate)}%)`,
          ],
        ]
      : []),
    [
      "Interest Rate:",
      `${parseFloat(loan.interest_rate).toFixed(2)}% per month`,
    ],
    ["Total Interest:", formatCurrency(loan.total_interest)],
    ["Total Amount Repayable:", formatCurrency(loan.total_amount_due)],
    ["Loan Duration:", `${loan.loan_duration_months} months`],
    ["Monthly Installment:", formatCurrency(monthlyPayment)],
    ["Loan Start Date:", formatDate(loan.start_date)],
    ["Loan End Date:", formatDate(loan.end_date)],
    ["Purpose:", loan.purpose || "Not specified"],
    [
      "Late Payment Fee:",
      `${formatCurrency(loan.late_payment_fee)} per missed payment`,
    ],
    [
      "Penalty Interest:",
      `${loan.penalty_rate}% per month on overdue amount`,
    ],
  ];

  terms.forEach(([label, value]) => {
    doc
      .font(FONT.bold)
      .text(label, 70, doc.y, { continued: true, width: 200 });
    doc.font(FONT.reg).text(value);
    doc.moveDown(0.2);
  });
  doc.moveDown();

  if (loan.collateral_description) {
    doc
      .fontSize(12)
      .fillColor("#0e8a6e")
      .font(FONT.bold)
      .text("2. COLLATERAL/SECURITY", { underline: true });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor("#000")
      .font(FONT.reg)
      .text(loan.collateral_description);
    doc.moveDown();
  }

  if (loan.guarantor_name) {
    doc
      .fontSize(12)
      .fillColor("#0e8a6e")
      .font(FONT.bold)
      .text("3. GUARANTOR", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#000").font(FONT.reg);
    doc.text(`Name: ${loan.guarantor_name}`);
    if (loan.guarantor_id_number)
      doc.text(`ID Number: ${loan.guarantor_id_number}`);
    if (loan.guarantor_phone)
      doc.text(`Phone: ${loan.guarantor_phone}`);
    doc.text(
      "The Guarantor agrees to be jointly and severally liable for repayment.",
    );
    doc.moveDown();
  }

  // ===== PAGE 2: TERMS AND CONDITIONS =====
  doc.addPage();
  doc
    .fontSize(14)
    .fillColor("#0e8a6e")
    .font(FONT.bold)
    .text("TERMS AND CONDITIONS", { align: "center", underline: true });
  doc.moveDown();

  const termsAndConditions = [
    {
      title: "1. REPAYMENT",
      content: `The Borrower agrees to repay the loan in ${loan.loan_duration_months} equal monthly installments of ${formatCurrency(monthlyPayment)} each, commencing one month from the date of disbursement.`,
    },
    {
      title: "2. INTEREST",
      content: `Interest shall be calculated at the rate of ${parseFloat(loan.interest_rate).toFixed(2)}% per month on the principal amount. The total interest payable over the loan period is ${formatCurrency(loan.total_interest)}.`,
    },
    {
      title: "3. PAYMENT METHODS",
      content:
        `Payments shall be made via:\n` +
        (company.mpesa_paybill
          ? `• M-Pesa Paybill: ${company.mpesa_paybill}\n`
          : "") +
        (company.mpesa_till_number
          ? `• M-Pesa Till Number: ${company.mpesa_till_number}\n`
          : "") +
        (company.bank_account_number
          ? `• Bank Transfer: ${company.bank_name}, A/C: ${company.bank_account_number}\n`
          : "") +
        `• Cash at our offices`,
    },
    {
      title: "4. LATE PAYMENT",
      content: `In the event of late payment, the Borrower shall pay a late payment fee of ${formatCurrency(loan.late_payment_fee)} per missed payment, plus a penalty interest of ${loan.penalty_rate}% per month on the overdue amount.`,
    },
    {
      title: "5. DEFAULT",
      content: `If the Borrower fails to make payments for three (3) consecutive months, the entire outstanding balance shall become immediately due and payable. The Lender reserves the right to take legal action and/or seize collateral (if any) to recover the debt.`,
    },
    {
      title: "6. EARLY REPAYMENT",
      content: `The Borrower may repay the loan in full or in part before the maturity date without any prepayment penalty. Interest savings on early repayment shall be calculated proportionally.`,
    },
    {
      title: "7. GOVERNING LAW",
      content: `This Agreement shall be governed by and construed in accordance with the laws of Kenya. Any disputes arising from this Agreement shall be subject to the exclusive jurisdiction of Kenyan courts.`,
    },
    {
      title: "8. PRIVACY",
      content: `The Lender shall keep all Borrower information confidential and shall not share it with third parties without consent, except as required by law or for legitimate business purposes such as credit reference bureaus.`,
    },
    {
      title: "9. AMENDMENTS",
      content: `This Agreement may only be amended in writing and signed by both parties.`,
    },
    {
      title: "10. ACKNOWLEDGMENT",
      content: `The Borrower acknowledges that they have read, understood, and agree to all the terms and conditions of this Loan Agreement.`,
    },
  ];

  termsAndConditions.forEach((section) => {
    if (doc.y > 700) {
      doc.addPage();
    }
    doc
      .fontSize(11)
      .fillColor("#000")
      .font(FONT.bold)
      .text(section.title);
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .font(FONT.reg)
      .text(section.content, { align: "justify" });
    doc.moveDown(0.5);
  });

  // ===== PAGE 3: PAYMENT SCHEDULE =====
  doc.addPage();
  doc
    .fontSize(14)
    .fillColor("#0e8a6e")
    .font(FONT.bold)
    .text("PAYMENT SCHEDULE", { align: "center", underline: true });
  doc.moveDown();

  let scheduleY = doc.y;
  doc.fontSize(10).fillColor("#fff").rect(50, scheduleY - 5, 495, 25).fill("#0e8a6e");
  doc.fillColor("#fff").font(FONT.bold);
  doc.text("#", 60, scheduleY + 3);
  doc.text("Due Date", 100, scheduleY + 3);
  doc.text("Principal", 220, scheduleY + 3);
  doc.text("Interest", 300, scheduleY + 3);
  doc.text("Amount Due", 380, scheduleY + 3);
  doc.text("Status", 470, scheduleY + 3);

  scheduleY += 30;
  doc.fillColor("#000").font(FONT.reg);

  const principalPerMonth =
    parseFloat(loan.principal_amount) /
    parseInt(loan.loan_duration_months, 10);
  const interestPerMonth =
    parseFloat(loan.total_interest) /
    parseInt(loan.loan_duration_months, 10);

  scheduleResult.rows.forEach((schedule, idx) => {
    if (scheduleY > 750) {
      doc.addPage();
      scheduleY = 50;
    }

    if (idx % 2 === 0) {
      doc.rect(50, scheduleY - 3, 495, 22).fillAndStroke("#F3F4F6", "#E5E7EB");
    }

    doc.fillColor("#000").fontSize(9);
    doc.text(`${schedule.payment_number}`, 60, scheduleY + 3);
    doc.text(formatDate(schedule.due_date), 100, scheduleY + 3);
    doc.text(formatCurrency(principalPerMonth), 220, scheduleY + 3);
    doc.text(formatCurrency(interestPerMonth), 300, scheduleY + 3);
    doc.text(formatCurrency(schedule.amount_due), 380, scheduleY + 3);
    doc.text(schedule.status.toUpperCase(), 470, scheduleY + 3);

    scheduleY += 22;
  });

  doc.rect(50, scheduleY - 3, 495, 22).fillAndStroke("#0e8a6e", "#0e8a6e");
  doc.fillColor("#fff").font(FONT.bold).fontSize(10);
  doc.text("TOTAL", 60, scheduleY + 3);
  doc.text(formatCurrency(loan.principal_amount), 220, scheduleY + 3);
  doc.text(formatCurrency(loan.total_interest), 300, scheduleY + 3);
  doc.text(formatCurrency(loan.total_amount_due), 380, scheduleY + 3);

  // ===== PAGE 4: SIGNATURES =====
  doc.addPage();
  doc
    .fontSize(14)
    .fillColor("#0e8a6e")
    .font(FONT.bold)
    .text("SIGNATURES", { align: "center", underline: true });
  doc.moveDown(2);

  doc
    .fontSize(11)
    .fillColor("#000")
    .font(FONT.bold)
    .text("BORROWER:");
  doc.moveDown(0.5);
  doc.fontSize(10).font(FONT.reg);
  doc.text(`Name: ${loan.first_name} ${loan.last_name}`);
  doc.text(`ID Number: ${loan.id_number || "________________"}`);
  doc.moveDown();
  doc.text("Signature: _____________________________________");
  doc.moveDown();
  doc.text("Date: _________________________________________");
  doc.moveDown(2);

  if (loan.guarantor_name) {
    doc.fontSize(11).font(FONT.bold).text("GUARANTOR:");
    doc.moveDown(0.5);
    doc.fontSize(10).font(FONT.reg);
    doc.text(`Name: ${loan.guarantor_name}`);
    doc.text(`ID Number: ${loan.guarantor_id_number || "________________"}`);
    doc.text(`Phone: ${loan.guarantor_phone || "________________"}`);
    doc.moveDown();
    doc.text("Signature: _____________________________________");
    doc.moveDown();
    doc.text("Date: _________________________________________");
    doc.moveDown(2);
  }

  doc
    .fontSize(11)
    .font(FONT.bold)
    .text(
      "LENDER (for and on behalf of " + company.company_name + "):",
    );
  doc.moveDown(0.5);
  doc.fontSize(10).font(FONT.reg);
  doc.text("Name: _________________________________________");
  doc.text("Position: ______________________________________");
  doc.moveDown();
  doc.text("Signature: _____________________________________");
  doc.moveDown();
  doc.text("Date: _________________________________________");
  doc.moveDown();
  doc.text("Official Stamp:");
  // Square box sized to fit the circular stamp comfortably.
  // 120×120 leaves a 5pt margin on each side around a 110pt
  // stamp — the stamp reads as "inside the box" instead of
  // "drifting across the page" (which was the earlier 130pt
  // bottom-right placement).
  const stampBoxX = 50;
  const stampBoxY = doc.y + 5;
  const stampBoxSize = 120;
  doc.rect(stampBoxX, stampBoxY, stampBoxSize, stampBoxSize).stroke("#999");
  // Centre the stamp inside the box with a tiny margin so the
  // outer ring doesn't graze the box border.
  const stampSize = 110;
  drawPdfStamp(doc, {
    x: stampBoxX + (stampBoxSize - stampSize) / 2,
    y: stampBoxY + (stampBoxSize - stampSize) / 2,
    size: stampSize,
    tenant: {
      business_name: tenant.business_name || company.company_name,
      city: tenant.city,
      country: tenant.country,
    },
  });
  // Advance past the box + extra breathing room before the
  // WITNESS section. Was moveDown(7) which left the witness
  // label overlapping with the box on tall stamps; now we
  // jump explicitly to (box bottom + 30pt) so there's a clean
  // gap between sections regardless of the page's prior
  // cursor position.
  doc.y = stampBoxY + stampBoxSize + 30;

  doc.fontSize(11).font(FONT.bold).text("WITNESS:");
  doc.moveDown(0.5);
  doc.fontSize(10).font(FONT.reg);
  doc.text("Name: _________________________________________");
  doc.text("ID Number: _____________________________________");
  doc.text("Phone: _________________________________________");
  doc.text("Signature: _____________________________________");
  doc.text("Date: _________________________________________");

  doc.fontSize(8).fillColor("#999").font(FONT.reg);
  doc.text(
    `This document is a legal binding agreement between ${company.company_name} and the named borrower.`,
    50,
    770,
    { align: "center", width: 495 },
  );
  doc.text(
    `Loan Code: ${loan.loan_code} | Generated: ${new Date().toLocaleString()}`,
    { align: "center" },
  );

  // (Stamp lives inside the "Official Stamp:" box above —
  // no second bottom-right stamp, that would be redundant.)

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// PLATFORM INVOICE — the LenderFest bill a tenant gets each month (a fee
// on the interest they earned). Tenant-scoped; downloadable from the
// tenant Billing page. Same {buffer, filename} contract as the others.
// ============================================================
export const buildInvoicePdf = async (invoiceId, tid) => {
  const it = tClause(tid, 1, "i.tenant_id");
  const invRes = await query(
    `SELECT i.*,
            tn.business_name AS tenant_name,
            tn.subdomain     AS tenant_subdomain,
            tn.contact_email AS tenant_email
       FROM invoices i
       JOIN tenants tn ON tn.id = i.tenant_id
      WHERE i.id = $1${it.clause}`,
    [invoiceId, ...it.params],
  );
  if (invRes.rows.length === 0) throw new NotFoundError("Invoice not found");
  const inv = invRes.rows[0];

  const payRes = await query(
    `SELECT amount, payment_method, payment_reference, payment_date
       FROM invoice_payments WHERE invoice_id = $1
      ORDER BY payment_date ASC, id ASC`,
    [invoiceId],
  );

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const money = (n) =>
    "KES " +
    parseFloat(n || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const fmtDate = (d) =>
    d
      ? new Date(d).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  registerPdfFonts(doc);
  const filename = `invoice_${inv.invoice_number}.pdf`;
  const done = streamToBuffer(doc);

  const PAGE_W = doc.page.width;
  const M = 50;
  const RIGHT = PAGE_W - M;
  const period = `${MONTHS[(inv.billing_month || 1) - 1]} ${inv.billing_year}`;

  // Header band
  doc.rect(0, 0, PAGE_W, 96).fill("#0e8a6e");
  drawBrandMark(doc, { x: M, y: 26, size: 34, variant: "light" });
  doc.fillColor("#ffffff").font(FONT.display).fontSize(24).text("LenderFest", M + 42, 30);
  doc.font(FONT.reg).fontSize(10).fillColor("#dff3ec").text("Platform Invoice", M, 64);
  doc
    .font(FONT.bold)
    .fontSize(16)
    .fillColor("#ffffff")
    .text(inv.invoice_number, M, 32, { width: PAGE_W - M * 2, align: "right" });
  doc
    .font(FONT.reg)
    .fontSize(10)
    .fillColor("#dff3ec")
    .text(String(inv.status || "pending").toUpperCase(), M, 64, {
      width: PAGE_W - M * 2,
      align: "right",
    });

  doc.fillColor("#000");
  let y = 130;

  // Billed-to + period/dates
  doc.font(FONT.bold).fontSize(9).fillColor("#64748b").text("BILLED TO", M, y);
  doc.font(FONT.bold).fontSize(13).fillColor("#122a2e").text(inv.tenant_name || "—", M, y + 14);
  doc
    .font(FONT.reg)
    .fontSize(10)
    .fillColor("#475569")
    .text(
      `${inv.tenant_subdomain || ""}${inv.tenant_email ? " · " + inv.tenant_email : ""}`,
      M,
      y + 32,
    );

  doc
    .font(FONT.bold)
    .fontSize(9)
    .fillColor("#64748b")
    .text("BILLING PERIOD", RIGHT - 220, y, { width: 220, align: "right" });
  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor("#122a2e")
    .text(period, RIGHT - 220, y + 14, { width: 220, align: "right" });
  doc
    .font(FONT.reg)
    .fontSize(10)
    .fillColor("#475569")
    .text(`Issued ${fmtDate(inv.issued_date)} · Due ${fmtDate(inv.due_date)}`, RIGHT - 260, y + 32, {
      width: 260,
      align: "right",
    });

  y += 72;
  doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor("#e2e8f0").stroke();
  y += 16;

  const row = (label, value, opts = {}) => {
    doc
      .font(opts.bold ? FONT.bold : FONT.reg)
      .fontSize(opts.size || 10)
      .fillColor(opts.color || "#334155");
    doc.text(label, M, y, { width: 320 });
    doc.text(value, RIGHT - 200, y, { width: 200, align: "right" });
    y += opts.gap || 20;
  };

  doc.font(FONT.bold).fontSize(9).fillColor("#64748b").text("DESCRIPTION", M, y);
  doc.text("AMOUNT", RIGHT - 200, y, { width: 200, align: "right" });
  y += 18;
  row(`Interest you earned (${period})`, money(inv.interest_earned));
  row(`Platform fee (${parseFloat(inv.fee_percentage)}% of interest)`, money(inv.amount_due));
  if (parseFloat(inv.base_fee) > 0) row("Base fee", money(inv.base_fee));
  if (parseFloat(inv.addon_fees) > 0) row("Add-on fees", money(inv.addon_fees));
  if (parseFloat(inv.discount) > 0) row("Discount", "-" + money(inv.discount));
  y += 4;
  doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor("#e2e8f0").stroke();
  y += 14;
  row("Total", money(inv.total_amount), { bold: true, size: 12, color: "#122a2e", gap: 22 });
  row("Paid", money(inv.amount_paid), { color: "#0e8a6e" });
  const balance = Math.max(
    0,
    parseFloat(inv.total_amount) - parseFloat(inv.amount_paid || 0),
  );
  row("Balance due", money(balance), {
    bold: true,
    size: 12,
    color: balance > 0 ? "#dc2626" : "#0e8a6e",
    gap: 24,
  });

  if (payRes.rows.length) {
    y += 8;
    doc.font(FONT.bold).fontSize(9).fillColor("#64748b").text("PAYMENT HISTORY", M, y);
    y += 16;
    payRes.rows.forEach((p) => {
      doc.font(FONT.reg).fontSize(9.5).fillColor("#475569");
      doc.text(
        `${fmtDate(p.payment_date)} · ${p.payment_method || "—"}${p.payment_reference ? " · " + p.payment_reference : ""}`,
        M,
        y,
        { width: 340 },
      );
      doc.text(money(p.amount), RIGHT - 200, y, { width: 200, align: "right" });
      y += 16;
    });
  }

  // Official LenderFest stamp, bottom-right (this is LenderFest's bill).
  drawPdfStamp(doc, {
    x: PAGE_W - 168,
    y: 612,
    size: 118,
    tenant: { business_name: "LenderFest", city: "Nairobi", country: "Kenya" },
  });

  // Footer — kept clear of the A4 bottom margin (842 − 50 = 792) and marked
  // lineBreak:false so a single line never tips the doc onto a 2nd page.
  drawBrandMark(doc, { x: (PAGE_W - 10) / 2, y: 756, size: 10 });
  doc
    .font(FONT.reg)
    .fontSize(8)
    .fillColor("#94a3b8")
    .text(
      `Generated ${new Date().toLocaleDateString("en-KE")} · Powered by LenderFest`,
      M,
      772,
      { width: PAGE_W - M * 2, align: "center", lineBreak: false },
    );

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// PAWN TICKET
//
// The claim ticket the borrower keeps to redeem a pledged item. A
// single-page A4 ticket mirroring the receipt's parchment look:
// header band in the lender's type colour, the pledged item + its
// valuation on the left, the loan terms + redemption total on the
// right, and the redemption deadline + terms below.
// ============================================================
export const buildPawnTicketPdf = async (loanId, tid) => {
  const lt = tClause(tid, 1, "l.tenant_id");
  const result = await query(
    `SELECT l.*,
        c.first_name, c.last_name, c.phone_number, c.id_number, c.client_code,
        tn.brand_color, tn.business_name, tn.business_type, tn.hide_platform_branding,
        tn.city AS tenant_city, tn.country AS tenant_country
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      JOIN tenants tn ON l.tenant_id = tn.id
      WHERE l.id = $1 AND l.loan_type = 'pawn'${lt.clause}`,
    [loanId, ...lt.params],
  );
  if (result.rows.length === 0) throw new NotFoundError("Pawn loan not found");
  const loan = result.rows[0];

  const colRes = await query(
    `SELECT * FROM loan_collateral WHERE loan_id = $1 ORDER BY id DESC LIMIT 1`,
    [loanId],
  );
  const col = colRes.rows[0] || {};

  const TYPE_COLORS = {
    microfinance: "#0086cc",
    sacco: "#ea580c",
    chama: "#7c3aed",
    individual: "#16a34a",
    other: "#64748b",
  };
  const typeColor =
    TYPE_COLORS[String(loan.business_type || "").trim().toLowerCase()] ||
    (/^#[0-9a-fA-F]{6}$/.test(loan.brand_color || "") ? loan.brand_color : "#0E8A6E");
  const darkenHex = (hex, f) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (
      "#" +
      [c(((n >> 16) & 255) * f), c(((n >> 8) & 255) * f), c((n & 255) * f)]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const fee = parseFloat(loan.total_interest || 0);
  const principal = parseFloat(loan.principal_amount || 0);
  const totalDue = parseFloat(loan.total_amount_due || 0);

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  registerPdfFonts(doc);
  const filename = `pawn_ticket_${loan.loan_code}.pdf`;
  const done = streamToBuffer(doc);

  const PW = doc.page.width;
  const PH = doc.page.height;
  const M = 40;

  doc.rect(0, 0, PW, PH).fill("#F3ECDB");

  // Header band
  const headH = 96;
  const hg = doc.linearGradient(0, 0, PW, 0);
  hg.stop(0, darkenHex(typeColor, 0.72)).stop(1, typeColor);
  doc.rect(0, 0, PW, headH).fill(hg);
  drawBrandMark(doc, { x: M, y: 28, size: 40, variant: "light" });
  doc.fillColor("#ffffff").font(FONT.display).fontSize(24).text("LenderFest", M + 50, 30);
  doc
    .font(FONT.reg)
    .fontSize(9)
    .fillOpacity(0.9)
    .text((loan.business_name || "").toUpperCase(), M + 50, 60, { characterSpacing: 1 });
  doc.fillOpacity(1);
  doc
    .font(FONT.bold)
    .fontSize(11)
    .fillColor("#ffffff")
    .text("PAWN TICKET", PW - 240, 30, { width: 200, align: "right", characterSpacing: 1.5 });
  doc
    .font("Courier")
    .fontSize(11)
    .fillOpacity(0.9)
    .text(loan.loan_code, PW - 240, 48, { width: 200, align: "right" });
  doc.fillOpacity(1);
  // Status pill
  const st = String(loan.status || "").toUpperCase();
  const stLabel = st === "ACTIVE" ? "ACTIVE" : st === "COMPLETED" ? "REDEEMED" : st === "DEFAULTED" ? "FORFEITED" : st;
  doc.font(FONT.bold).fontSize(9);
  const pillW = doc.widthOfString(stLabel) + 24;
  const pillX = PW - M - pillW;
  doc.fillOpacity(0.16).roundedRect(pillX, 66, pillW, 22, 11).fill("#ffffff");
  doc.fillOpacity(1).fillColor("#ffffff").text(stLabel, pillX, 72.5, { width: pillW, align: "center" });

  // Two-column body
  const top = headH + 36;
  const gap = 24;
  const colW = (PW - M * 2 - gap) / 2;
  const leftX = M;
  const rightX = M + colW + gap;

  const panel = (x, y, w, h, title) => {
    doc.roundedRect(x, y, w, h, 12).fill("#FAF6EC");
    doc.roundedRect(x, y, w, h, 12).lineWidth(0.8).strokeColor("#E2D9C3").stroke();
    doc
      .font(FONT.bold)
      .fontSize(8)
      .fillColor(typeColor)
      .text(title, x + 18, y + 16, { characterSpacing: 1.4 });
  };
  const fieldRow = (x, y, w, label, value, mono) => {
    doc.font(FONT.bold).fontSize(7.5).fillColor("#9C9384").text(label, x, y, { characterSpacing: 1 });
    doc
      .font(mono ? "Courier" : FONT.bold)
      .fontSize(mono ? 10.5 : 11.5)
      .fillColor("#2B2A26")
      .text(value || "—", x, y + 11, { width: w });
    return y + 38;
  };

  const panelH = 286;
  // LEFT — pledged item
  panel(leftX, top, colW, panelH, "PLEDGED ITEM");
  let ly = top + 42;
  const lpad = leftX + 18;
  const lw = colW - 36;
  ly = fieldRow(lpad, ly, lw, "DESCRIPTION", col.description);
  ly = fieldRow(lpad, ly, lw, "CATEGORY", col.category);
  ly = fieldRow(lpad, ly, lw, "SERIAL / IDENTIFIER", col.serial_number, true);
  ly = fieldRow(lpad, ly, lw, "CONDITION", col.condition);
  ly = fieldRow(lpad, ly, lw, "STORAGE LOCATION", col.storage_location);
  // Appraised value highlight
  const valY = top + panelH - 56;
  doc.roundedRect(lpad, valY, lw, 42, 8).fill("#E9DFC7");
  doc.font(FONT.reg).fontSize(9).fillColor("#6f6a5e").text("APPRAISED VALUE", lpad + 12, valY + 9);
  doc
    .font(FONT.display)
    .fontSize(15)
    .fillColor("#2B2A26")
    .text(`${money(col.appraised_value)}  ·  LTV ${parseFloat(col.ltv_percent || 0)}%`, lpad, valY + 8, {
      width: lw - 12,
      align: "right",
    });

  // RIGHT — loan terms
  panel(rightX, top, colW, panelH, "LOAN TERMS");
  let ry2 = top + 42;
  const rpad = rightX + 18;
  const rw = colW - 36;
  const trow = (k, v, color) => {
    doc.font(FONT.reg).fontSize(10.5).fillColor("#6f6a5e").text(k, rpad, ry2);
    doc
      .font(FONT.bold)
      .fontSize(11)
      .fillColor(color || "#2B2A26")
      .text(v, rpad, ry2, { width: rw, align: "right" });
    ry2 += 28;
  };
  trow("Borrower", `${loan.first_name || ""} ${loan.last_name || ""}`.trim());
  trow("Phone", loan.phone_number || "—");
  trow("Loan amount (advanced)", money(principal));
  trow("Pawn fee", money(fee));
  trow("Issued", formatDate(loan.start_date));
  trow("Redeem by", formatDate(loan.end_date), "#C62A5A");
  // Redemption total highlight
  const totY = top + panelH - 56;
  doc.roundedRect(rpad, totY, rw, 42, 8).fill(typeColor);
  doc.font(FONT.reg).fontSize(9).fillColor("#ffffff").fillOpacity(0.9).text("REDEMPTION TOTAL", rpad + 12, totY + 9);
  doc.fillOpacity(1).font(FONT.display).fontSize(16).fillColor("#ffffff").text(money(totalDue), rpad, totY + 8, {
    width: rw - 12,
    align: "right",
  });

  // Terms
  const termsY = top + panelH + 26;
  doc.font(FONT.bold).fontSize(8).fillColor("#9C9384").text("REDEMPTION TERMS", M, termsY, { characterSpacing: 1.2 });
  doc
    .font(FONT.reg)
    .fontSize(9)
    .fillColor("#6f6a5e")
    .text(
      `Present this ticket and pay the redemption total of ${money(totalDue)} on or before ` +
        `${formatDate(loan.end_date)} to reclaim the pledged item. The fee is fixed for the term; ` +
        `partial early redemption does not reduce it. If not redeemed by the redemption date, the ` +
        `lender may forfeit and dispose of the item to recover the loan. Keep this ticket safe — it is ` +
        `your proof of pledge.`,
      M,
      termsY + 14,
      { width: PW - M * 2, lineGap: 2 },
    );

  // Footer — stamp + powered by
  const footY = PH - 150;
  doc
    .moveTo(M, footY)
    .lineTo(PW - M, footY)
    .dash(2, { space: 3 })
    .lineWidth(0.8)
    .strokeColor("#d2c8af")
    .stroke()
    .undash();
  // Signature lines
  doc.font(FONT.reg).fontSize(9).fillColor("#6f6a5e");
  doc.moveTo(M, footY + 70).lineTo(M + 180, footY + 70).lineWidth(0.7).strokeColor("#b8ad92").stroke();
  doc.text("Borrower signature", M, footY + 76);
  doc.moveTo(PW - M - 180, footY + 70).lineTo(PW - M, footY + 70).stroke();
  doc.text("Authorised by (lender)", PW - M - 180, footY + 76, { width: 180, align: "left" });

  drawPdfStamp(doc, {
    x: (PW - 90) / 2,
    y: footY + 18,
    size: 90,
    tenant: {
      business_name: loan.business_name,
      city: loan.tenant_city,
      country: loan.tenant_country,
    },
    date: loan.start_date || new Date(),
  });

  if (!loan.hide_platform_branding) {
    doc
      .font(FONT.reg)
      .fontSize(7.5)
      .fillColor("#9C9384")
      .text("Powered by LenderFest · lenderfest.loans", M, PH - 30, {
        width: PW - M * 2,
        align: "center",
      });
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// VEHICLE SECURITY CERTIFICATE (logbook loans)
//
// Proof that the lender holds a lien over the borrower's vehicle for the
// duration of a logbook loan. Single-page A4, same parchment look as the
// pawn ticket: vehicle + logbook identifiers on the left, loan terms on the
// right, lien status + terms below.
// ============================================================
export const buildVehicleSecurityPdf = async (loanId, tid) => {
  const lt = tClause(tid, 1, "l.tenant_id");
  const result = await query(
    `SELECT l.*,
        c.first_name, c.last_name, c.phone_number, c.id_number, c.client_code,
        tn.brand_color, tn.business_name, tn.business_type, tn.hide_platform_branding,
        tn.city AS tenant_city, tn.country AS tenant_country
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      JOIN tenants tn ON l.tenant_id = tn.id
      WHERE l.id = $1 AND l.loan_type = 'logbook'${lt.clause}`,
    [loanId, ...lt.params],
  );
  if (result.rows.length === 0) throw new NotFoundError("Logbook loan not found");
  const loan = result.rows[0];

  const vRes = await query(
    `SELECT * FROM loan_vehicle_security WHERE loan_id = $1`,
    [loanId],
  );
  if (vRes.rows.length === 0) {
    throw new NotFoundError("No vehicle security on file for this loan");
  }
  const v = vRes.rows[0];

  const TYPE_COLORS = {
    microfinance: "#0086cc",
    sacco: "#ea580c",
    chama: "#7c3aed",
    individual: "#16a34a",
    other: "#64748b",
  };
  const typeColor =
    TYPE_COLORS[String(loan.business_type || "").trim().toLowerCase()] ||
    (/^#[0-9a-fA-F]{6}$/.test(loan.brand_color || "") ? loan.brand_color : "#0E8A6E");
  const darkenHex = (hex, f) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const c = (x) => Math.max(0, Math.min(255, Math.round(x)));
    return (
      "#" +
      [c(((n >> 16) & 255) * f), c(((n >> 8) & 255) * f), c((n & 255) * f)]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("")
    );
  };
  const money = (val) =>
    "KES " +
    Number(val || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const principal = parseFloat(loan.principal_amount || 0);
  const totalDue = parseFloat(loan.total_amount_due || 0);
  const months = parseInt(loan.loan_duration_months, 10) || 1;
  const monthly = totalDue / months;
  const vehicleName = [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  registerPdfFonts(doc);
  const filename = `vehicle_security_${loan.loan_code}.pdf`;
  const done = streamToBuffer(doc);

  const PW = doc.page.width;
  const PH = doc.page.height;
  const M = 40;

  doc.rect(0, 0, PW, PH).fill("#F3ECDB");

  const headH = 96;
  const hg = doc.linearGradient(0, 0, PW, 0);
  hg.stop(0, darkenHex(typeColor, 0.72)).stop(1, typeColor);
  doc.rect(0, 0, PW, headH).fill(hg);
  drawBrandMark(doc, { x: M, y: 28, size: 40, variant: "light" });
  doc.fillColor("#ffffff").font(FONT.display).fontSize(24).text("LenderFest", M + 50, 30);
  doc
    .font(FONT.reg)
    .fontSize(9)
    .fillOpacity(0.9)
    .text((loan.business_name || "").toUpperCase(), M + 50, 60, { characterSpacing: 1 });
  doc.fillOpacity(1);
  doc
    .font(FONT.bold)
    .fontSize(11)
    .fillColor("#ffffff")
    .text("VEHICLE SECURITY", PW - 250, 30, { width: 210, align: "right", characterSpacing: 1.2 });
  doc
    .font("Courier")
    .fontSize(11)
    .fillOpacity(0.9)
    .text(loan.loan_code, PW - 250, 48, { width: 210, align: "right" });
  doc.fillOpacity(1);
  const LIEN_LABEL = {
    active: "LIEN ACTIVE",
    released: "LIEN RELEASED",
    repossessed: "REPOSSESSED",
  };
  const stLabel = LIEN_LABEL[v.lien_status] || String(v.lien_status || "").toUpperCase();
  doc.font(FONT.bold).fontSize(9);
  const pillW = doc.widthOfString(stLabel) + 24;
  const pillX = PW - M - pillW;
  doc.fillOpacity(0.16).roundedRect(pillX, 66, pillW, 22, 11).fill("#ffffff");
  doc.fillOpacity(1).fillColor("#ffffff").text(stLabel, pillX, 72.5, { width: pillW, align: "center" });

  const top = headH + 36;
  const gap = 24;
  const colW = (PW - M * 2 - gap) / 2;
  const leftX = M;
  const rightX = M + colW + gap;

  const panel = (x, y, w, h, title) => {
    doc.roundedRect(x, y, w, h, 12).fill("#FAF6EC");
    doc.roundedRect(x, y, w, h, 12).lineWidth(0.8).strokeColor("#E2D9C3").stroke();
    doc
      .font(FONT.bold)
      .fontSize(8)
      .fillColor(typeColor)
      .text(title, x + 18, y + 16, { characterSpacing: 1.4 });
  };
  const fieldRow = (x, y, w, label, value, mono) => {
    doc.font(FONT.bold).fontSize(7.5).fillColor("#9C9384").text(label, x, y, { characterSpacing: 1 });
    doc
      .font(mono ? "Courier" : FONT.bold)
      .fontSize(mono ? 10.5 : 11.5)
      .fillColor("#2B2A26")
      .text(value || "—", x, y + 11, { width: w });
    return y + 36;
  };

  const panelH = 290;
  // LEFT — vehicle
  panel(leftX, top, colW, panelH, "VEHICLE");
  let ly = top + 42;
  const lpad = leftX + 18;
  const lw = colW - 36;
  ly = fieldRow(lpad, ly, lw, "MAKE / MODEL / YEAR", vehicleName);
  ly = fieldRow(lpad, ly, lw, "REGISTRATION NO.", v.registration_number, true);
  ly = fieldRow(lpad, ly, lw, "LOGBOOK NO.", v.logbook_number, true);
  ly = fieldRow(lpad, ly, lw, "CHASSIS / ENGINE NO.", [v.chassis_number, v.engine_number].filter(Boolean).join("  /  "), true);
  ly = fieldRow(lpad, ly, lw, "COLOUR", v.color);
  const valY = top + panelH - 56;
  doc.roundedRect(lpad, valY, lw, 42, 8).fill("#E9DFC7");
  doc.font(FONT.reg).fontSize(9).fillColor("#6f6a5e").text("VEHICLE VALUATION", lpad + 12, valY + 9);
  doc
    .font(FONT.display)
    .fontSize(15)
    .fillColor("#2B2A26")
    .text(money(v.valuation), lpad, valY + 8, { width: lw - 12, align: "right" });

  // RIGHT — loan terms
  panel(rightX, top, colW, panelH, "LOAN SECURED");
  let ry = top + 42;
  const rpad = rightX + 18;
  const rw = colW - 36;
  const trow = (k, val, color) => {
    doc.font(FONT.reg).fontSize(10.5).fillColor("#6f6a5e").text(k, rpad, ry);
    doc
      .font(FONT.bold)
      .fontSize(11)
      .fillColor(color || "#2B2A26")
      .text(val, rpad, ry, { width: rw, align: "right" });
    ry += 28;
  };
  trow("Borrower", `${loan.first_name || ""} ${loan.last_name || ""}`.trim());
  trow("Phone", loan.phone_number || "—");
  trow("Loan amount", money(principal));
  trow("Total repayable", money(totalDue));
  trow("Instalment", `${money(monthly)} × ${months}`);
  trow("Maturity", formatDate(loan.end_date), "#C62A5A");
  const lienY = top + panelH - 56;
  doc.roundedRect(rpad, lienY, rw, 42, 8).fill(typeColor);
  doc.font(FONT.reg).fontSize(9).fillColor("#ffffff").fillOpacity(0.9).text("LOGBOOK", rpad + 12, lienY + 9);
  doc.fillOpacity(1).font(FONT.display).fontSize(14).fillColor("#ffffff").text(
    v.logbook_held ? "Held by lender" : "With borrower",
    rpad,
    lienY + 9,
    { width: rw - 12, align: "right" },
  );

  // Terms
  const termsY = top + panelH + 26;
  doc.font(FONT.bold).fontSize(8).fillColor("#9C9384").text("SECURITY TERMS", M, termsY, { characterSpacing: 1.2 });
  doc
    .font(FONT.reg)
    .fontSize(9)
    .fillColor("#6f6a5e")
    .text(
      `The borrower pledges the vehicle described above as security for loan ${loan.loan_code}. ` +
        `The lender holds a lien over the vehicle's logbook until the loan is repaid in full, ` +
        `whereupon the lien is released and the logbook returned. The vehicle remains in the ` +
        `borrower's possession and use. On default the lender may exercise the lien and repossess ` +
        `the vehicle to recover the outstanding balance.`,
      M,
      termsY + 14,
      { width: PW - M * 2, lineGap: 2 },
    );

  // Footer — signatures + stamp
  const footY = PH - 150;
  doc
    .moveTo(M, footY)
    .lineTo(PW - M, footY)
    .dash(2, { space: 3 })
    .lineWidth(0.8)
    .strokeColor("#d2c8af")
    .stroke()
    .undash();
  doc.font(FONT.reg).fontSize(9).fillColor("#6f6a5e");
  doc.moveTo(M, footY + 70).lineTo(M + 180, footY + 70).lineWidth(0.7).strokeColor("#b8ad92").stroke();
  doc.text("Borrower signature", M, footY + 76);
  doc.moveTo(PW - M - 180, footY + 70).lineTo(PW - M, footY + 70).stroke();
  doc.text("Authorised by (lender)", PW - M - 180, footY + 76, { width: 180, align: "left" });

  drawPdfStamp(doc, {
    x: (PW - 90) / 2,
    y: footY + 18,
    size: 90,
    tenant: {
      business_name: loan.business_name,
      city: loan.tenant_city,
      country: loan.tenant_country,
    },
    date: loan.start_date || new Date(),
  });

  if (!loan.hide_platform_branding) {
    doc
      .font(FONT.reg)
      .fontSize(7.5)
      .fillColor("#9C9384")
      .text("Powered by LenderFest · lenderfest.loans", M, PH - 30, {
        width: PW - M * 2,
        align: "center",
      });
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

export default {
  buildClientStatementPdf,
  buildLoanStatementPdf,
  buildReceiptPdf,
  buildLoanAgreementPdf,
  buildInvoicePdf,
  buildPawnTicketPdf,
  buildVehicleSecurityPdf,
  NotFoundError,
};
