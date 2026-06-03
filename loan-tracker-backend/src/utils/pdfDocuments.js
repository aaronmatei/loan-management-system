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
  const n = parseInt((valid ? brandColor : "#0f3d2e").slice(1), 16);
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
  const filename = `client_statement_${client.client_code}_${new Date().toISOString().split("T")[0]}.pdf`;
  const done = streamToBuffer(doc);

  doc
    .fontSize(20)
    .fillColor("#4F46E5")
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

  doc.rect(50, doc.y, 500, 100).stroke("#4F46E5");
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

  doc.fontSize(14).fillColor("#4F46E5").text("SUMMARY", { underline: true });
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
      .fillColor("#4F46E5")
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
      .fillColor("#4F46E5")
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
  const filename = `loan_statement_${loan.loan_code}_${new Date().toISOString().split("T")[0]}.pdf`;
  const done = streamToBuffer(doc);

  doc
    .fontSize(20)
    .fillColor("#4F46E5")
    .text("LOAN STATEMENT", { align: "center" });
  doc.fontSize(14).fillColor("#000").text(loan.loan_code, { align: "center" });
  doc.moveDown();
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Generated: ${formatDate(new Date())}`, { align: "right" });
  doc.moveDown();

  doc.rect(50, doc.y, 500, 80).stroke("#4F46E5");
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
    .fillColor("#4F46E5")
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
    .fillColor("#4F46E5")
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
        tn.brand_color, tn.business_name, tn.hide_platform_branding,
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

  const theme = receiptTheme(txn.brand_color);
  const firstName =
    (txn.first_name || "").trim() || txn.business_name || "there";

  const doc = new PDFDocument({ size: "A5", margin: 0 });
  const filename = `receipt_${txn.transaction_code}.pdf`;
  const done = streamToBuffer(doc);

  const W = doc.page.width; // A5 ≈ 419.5
  const PAD = 28;
  const CW = W - PAD * 2;
  const WHITE = [255, 255, 255];
  const microLabel = (txt, x, yy, w) =>
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor([150, 150, 150])
      .text(txt, x, yy, { characterSpacing: 1, ...(w ? { width: w } : {}) });

  // ── Dark gradient header ──────────────────────────────────────────
  const headerH = 240;
  const grad = doc.linearGradient(0, 0, W, headerH);
  grad.stop(0, theme.deepTop).stop(1, theme.deepBottom);
  doc.rect(0, 0, W, headerH).fill(grad);

  // top-left: glow dot + PAYMENT RECEIVED
  doc.circle(PAD + 3, 33, 3).fill(theme.accentLight);
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(theme.accentLight)
    .text("PAYMENT RECEIVED", PAD + 12, 29, { characterSpacing: 1.5 });

  // top-right: TRANSACTION / code / PAID pill
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(WHITE)
    .fillOpacity(0.5)
    .text("TRANSACTION", PAD, 29, { width: CW, align: "right", characterSpacing: 1 });
  doc
    .fillOpacity(0.9)
    .font("Courier")
    .fontSize(10)
    .text(txn.transaction_code, PAD, 40, { width: CW, align: "right" });
  doc.fillOpacity(1);
  // pill (avoid the ✓ glyph — not in WinAnsi; "PAID" reads like a stamp)
  doc.font("Helvetica-Bold").fontSize(7.5);
  const pillTxt = "PAID";
  const pillW = doc.widthOfString(pillTxt) + 18;
  const pillX = W - PAD - pillW;
  const pillY = 56;
  doc.fillOpacity(0.1).roundedRect(pillX, pillY, pillW, 15, 7.5).fill(WHITE);
  doc
    .fillOpacity(0.3)
    .lineWidth(0.5)
    .roundedRect(pillX, pillY, pillW, 15, 7.5)
    .stroke(WHITE);
  doc
    .fillOpacity(1)
    .fillColor(WHITE)
    .text(pillTxt, pillX, pillY + 4, { width: pillW, align: "center" });

  // headline
  doc
    .font("Helvetica")
    .fontSize(17)
    .fillColor(WHITE)
    .fillOpacity(0.9)
    .text("Thank you,", PAD, 92);
  doc
    .fillOpacity(1)
    .font("Times-Italic")
    .fontSize(28)
    .fillColor(theme.accentLight)
    .text(`${firstName}.`, PAD, 112, { width: CW });

  // amount — whole-shilling bold/white, decimals dimmed
  const [whole, dec = "00"] = Number(txn.amount_paid || 0)
    .toFixed(2)
    .split(".");
  const wholeFmt = Number(whole).toLocaleString();
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(WHITE)
    .fillOpacity(0.5)
    .text("AMOUNT PAID", PAD, 162, { characterSpacing: 1.5 });
  doc.fillOpacity(1);
  const amtY = 176;
  doc
    .font("Helvetica")
    .fontSize(12)
    .fillColor(WHITE)
    .fillOpacity(0.6)
    .text("KES ", PAD, amtY + 14, { continued: true });
  doc
    .fillOpacity(1)
    .font("Helvetica-Bold")
    .fontSize(34)
    .text(wholeFmt, { continued: true });
  doc.font("Helvetica-Bold").fontSize(20).fillOpacity(0.4).text(`.${dec}`);
  doc.fillOpacity(1);

  // meta: date · time · via method
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
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(WHITE)
    .fillOpacity(0.55)
    .text(meta, PAD, 220);
  doc.fillOpacity(1);

  // ── Body ──────────────────────────────────────────────────────────
  doc.rect(0, headerH, W, doc.page.height - headerH).fill([247, 246, 243]);
  // ticket perforation: notch circles biting the seam + dashed line
  doc.circle(0, headerH, 7).fill([247, 246, 243]);
  doc.circle(W, headerH, 7).fill([247, 246, 243]);
  doc
    .save()
    .lineWidth(0.7)
    .dash(3, { space: 3 })
    .strokeColor([212, 210, 205])
    .moveTo(PAD - 6, headerH)
    .lineTo(W - PAD + 6, headerH)
    .stroke()
    .undash()
    .restore();

  // detail grid (2 cols)
  let by = headerH + 22;
  const colL = PAD;
  const colR = PAD + CW / 2;

  microLabel("CLIENT", colL, by);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor([40, 40, 40])
    .text(`${txn.first_name} ${txn.last_name}`.trim(), colL, by + 9);
  if (txn.phone_number)
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor([130, 130, 130])
      .text(txn.phone_number, colL, by + 22);
  if (txn.client_code) {
    microLabel("CLIENT CODE", colR, by);
    doc
      .font("Courier")
      .fontSize(9)
      .fillColor([40, 40, 40])
      .text(txn.client_code, colR, by + 9);
  }

  by += 42;
  microLabel("LOAN CODE", colL, by);
  doc
    .font("Courier")
    .fontSize(9)
    .fillColor([40, 40, 40])
    .text(txn.loan_code, colL, by + 9);
  microLabel("METHOD", colR, by);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor([40, 40, 40])
    .text(txn.payment_method || "—", colR, by + 9);
  if (txn.payment_reference)
    doc
      .font("Courier")
      .fontSize(8)
      .fillColor([130, 130, 130])
      .text(`Ref · ${txn.payment_reference}`, colR, by + 22, { width: CW / 2 - 8 });

  by += 42;
  doc
    .lineWidth(0.5)
    .strokeColor([225, 225, 225])
    .moveTo(PAD, by)
    .lineTo(W - PAD, by)
    .stroke();
  by += 14;

  // loan summary panel
  const sumH = 96;
  doc.roundedRect(PAD, by, CW, sumH, 10).fill([238, 236, 231]);
  let py = by + 12;
  microLabel("LOAN SUMMARY", PAD + 12, py);
  py += 15;
  const sumRow = (label, valStr, opts = {}) => {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor([120, 120, 120])
      .text(label, PAD + 12, py, { width: CW - 24 });
    doc
      .font(opts.font || "Helvetica")
      .fontSize(9)
      .fillColor(opts.color || [60, 60, 60])
      .text(valStr, PAD + 12, py, { width: CW - 24, align: "right" });
    py += 14;
  };
  sumRow("Principal", formatCurrency(txn.principal_amount));
  sumRow("Total due", formatCurrency(txn.total_amount_due));
  sumRow("This payment", `- ${formatCurrency(txn.amount_paid)}`, {
    color: theme.accent,
    font: "Helvetica-Bold",
  });
  doc
    .lineWidth(0.5)
    .strokeColor([216, 213, 207])
    .moveTo(PAD + 12, py)
    .lineTo(PAD + CW - 12, py)
    .stroke();
  py += 7;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor([80, 80, 80])
    .text("Remaining balance", PAD + 12, py + 5);
  doc
    .font("Times-Roman")
    .fontSize(17)
    .fillColor([20, 20, 20])
    .text(formatCurrency(remaining), PAD + 12, py, {
      width: CW - 24,
      align: "right",
    });
  by += sumH + 14;

  // next-payment panel / fully-paid state
  if (fullyPaid) {
    const ph = 44;
    doc.roundedRect(PAD, by, CW, ph, 10).lineWidth(1).stroke(theme.accent);
    doc
      .font("Times-Italic")
      .fontSize(13)
      .fillColor(theme.accent)
      .text("Loan fully paid", PAD, by + 15, { width: CW, align: "center" });
    by += ph + 12;
  } else if (next) {
    const ph = 50;
    doc.roundedRect(PAD, by, CW, ph, 10).lineWidth(0.7).stroke([225, 225, 225]);
    microLabel("NEXT PAYMENT", PAD + 14, by + 12);
    doc
      .font("Times-Roman")
      .fontSize(15)
      .fillColor([20, 20, 20])
      .text(formatCurrency(nextDue), PAD + 14, by + 24);
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor([150, 150, 150])
      .text("DUE", PAD, by + 12, { width: CW - 14, align: "right", characterSpacing: 1 });
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor([70, 70, 70])
      .text(formatDate(next.due_date), PAD, by + 24, {
        width: CW - 14,
        align: "right",
      });
    by += ph + 12;
  }

  // footer
  by += 4;
  doc
    .font("Times-Italic")
    .fontSize(11)
    .fillColor([130, 130, 130])
    .text("A receipt for your records.", PAD, by, { width: CW, align: "center" });
  by += 16;
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .fillColor([165, 165, 165])
    .text("SYSTEM GENERATED · NO SIGNATURE REQUIRED", PAD, by, {
      width: CW,
      align: "center",
      characterSpacing: 1,
    });
  if (!txn.hide_platform_branding) {
    by += 13;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor([200, 200, 200])
      .text("Powered by LoanFix", PAD, by, { width: CW, align: "center" });
  }

  // Stamp the receipt — A5 page (420×595pt), so use a small
  // stamp (~80pt) tucked under the "system-generated" notice.
  // Centered on the card horizontally.
  drawPdfStamp(doc, {
    x: (420 - 80) / 2,
    y: Math.min(by + 18, 495),
    size: 80,
    tenant: {
      business_name: txn.business_name,
      city: txn.tenant_city,
      country: txn.tenant_country,
    },
    date: txn.payment_date || new Date(),
  });

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
  const filename = `loan_agreement_${loan.loan_code}.pdf`;
  const done = streamToBuffer(doc);

  // ===== PAGE 1: AGREEMENT =====
  doc
    .fontSize(20)
    .fillColor("#4F46E5")
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

  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#4F46E5");
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
  doc.font("Helvetica-Bold").text(formatDate(loan.start_date), {
    continued: true,
  });
  doc.font("Helvetica").text(" BETWEEN:");
  doc.moveDown(0.5);

  doc.fontSize(11).font("Helvetica-Bold").text("LENDER:");
  doc.font("Helvetica").fontSize(10);
  doc.text(`${company.company_name}`);
  doc.text(`${company.company_address}`);
  doc.text(`Phone: ${company.company_phone}`);
  doc.text(`Email: ${company.company_email}`);
  doc.text('(hereinafter referred to as "the Lender")');
  doc.moveDown(0.5);

  doc.fontSize(11).font("Helvetica-Bold").text("AND");
  doc.moveDown(0.3);

  doc.fontSize(11).font("Helvetica-Bold").text("BORROWER:");
  doc.font("Helvetica").fontSize(10);
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
    .fillColor("#4F46E5")
    .font("Helvetica-Bold")
    .text("1. LOAN TERMS", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#000").font("Helvetica");

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
      .font("Helvetica-Bold")
      .text(label, 70, doc.y, { continued: true, width: 200 });
    doc.font("Helvetica").text(value);
    doc.moveDown(0.2);
  });
  doc.moveDown();

  if (loan.collateral_description) {
    doc
      .fontSize(12)
      .fillColor("#4F46E5")
      .font("Helvetica-Bold")
      .text("2. COLLATERAL/SECURITY", { underline: true });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor("#000")
      .font("Helvetica")
      .text(loan.collateral_description);
    doc.moveDown();
  }

  if (loan.guarantor_name) {
    doc
      .fontSize(12)
      .fillColor("#4F46E5")
      .font("Helvetica-Bold")
      .text("3. GUARANTOR", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#000").font("Helvetica");
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
    .fillColor("#4F46E5")
    .font("Helvetica-Bold")
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
      .font("Helvetica-Bold")
      .text(section.title);
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(section.content, { align: "justify" });
    doc.moveDown(0.5);
  });

  // ===== PAGE 3: PAYMENT SCHEDULE =====
  doc.addPage();
  doc
    .fontSize(14)
    .fillColor("#4F46E5")
    .font("Helvetica-Bold")
    .text("PAYMENT SCHEDULE", { align: "center", underline: true });
  doc.moveDown();

  let scheduleY = doc.y;
  doc.fontSize(10).fillColor("#fff").rect(50, scheduleY - 5, 495, 25).fill("#4F46E5");
  doc.fillColor("#fff").font("Helvetica-Bold");
  doc.text("#", 60, scheduleY + 3);
  doc.text("Due Date", 100, scheduleY + 3);
  doc.text("Principal", 220, scheduleY + 3);
  doc.text("Interest", 300, scheduleY + 3);
  doc.text("Amount Due", 380, scheduleY + 3);
  doc.text("Status", 470, scheduleY + 3);

  scheduleY += 30;
  doc.fillColor("#000").font("Helvetica");

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

  doc.rect(50, scheduleY - 3, 495, 22).fillAndStroke("#4F46E5", "#4F46E5");
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10);
  doc.text("TOTAL", 60, scheduleY + 3);
  doc.text(formatCurrency(loan.principal_amount), 220, scheduleY + 3);
  doc.text(formatCurrency(loan.total_interest), 300, scheduleY + 3);
  doc.text(formatCurrency(loan.total_amount_due), 380, scheduleY + 3);

  // ===== PAGE 4: SIGNATURES =====
  doc.addPage();
  doc
    .fontSize(14)
    .fillColor("#4F46E5")
    .font("Helvetica-Bold")
    .text("SIGNATURES", { align: "center", underline: true });
  doc.moveDown(2);

  doc
    .fontSize(11)
    .fillColor("#000")
    .font("Helvetica-Bold")
    .text("BORROWER:");
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Name: ${loan.first_name} ${loan.last_name}`);
  doc.text(`ID Number: ${loan.id_number || "________________"}`);
  doc.moveDown();
  doc.text("Signature: _____________________________________");
  doc.moveDown();
  doc.text("Date: _________________________________________");
  doc.moveDown(2);

  if (loan.guarantor_name) {
    doc.fontSize(11).font("Helvetica-Bold").text("GUARANTOR:");
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica");
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
    .font("Helvetica-Bold")
    .text(
      "LENDER (for and on behalf of " + company.company_name + "):",
    );
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text("Name: _________________________________________");
  doc.text("Position: ______________________________________");
  doc.moveDown();
  doc.text("Signature: _____________________________________");
  doc.moveDown();
  doc.text("Date: _________________________________________");
  doc.moveDown();
  doc.text("Official Stamp:");
  doc.rect(50, doc.y + 5, 150, 80).stroke("#999");
  doc.moveDown(7);

  doc.fontSize(11).font("Helvetica-Bold").text("WITNESS:");
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text("Name: _________________________________________");
  doc.text("ID Number: _____________________________________");
  doc.text("Phone: _________________________________________");
  doc.text("Signature: _____________________________________");
  doc.text("Date: _________________________________________");

  doc.fontSize(8).fillColor("#999").font("Helvetica");
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

  // Official stamp on the agreement — bottom-right, well clear
  // of the witness/signature lines. Uses the tenant business
  // name (matches the company letterhead) so the agreement
  // bears the same brand twice.
  drawPdfStamp(doc, {
    x: 420,
    y: 660,
    size: 130,
    tenant: {
      business_name: tenant.business_name || company.company_name,
      city: tenant.city,
      country: tenant.country,
    },
  });

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

export default {
  buildClientStatementPdf,
  buildLoanStatementPdf,
  buildReceiptPdf,
  buildLoanAgreementPdf,
  NotFoundError,
};
