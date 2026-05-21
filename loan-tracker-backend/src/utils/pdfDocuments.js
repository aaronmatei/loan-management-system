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

// ============================================================
// CLIENT STATEMENT
// ============================================================
export const buildClientStatementPdf = async (clientId, tid) => {
  const ct = tClause(tid, 1);
  const clientResult = await query(
    `SELECT * FROM clients WHERE id = $1${ct.clause}`,
    [clientId, ...ct.params],
  );
  if (clientResult.rows.length === 0) {
    throw new NotFoundError("Client not found");
  }
  const client = clientResult.rows[0];

  const loansResult = await query(
    `
      SELECT l.*,
        COALESCE(SUM(t.amount_paid), 0) as total_paid
      FROM loans l
      LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
      WHERE l.client_id = $1
      GROUP BY l.id
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
      SELECT l.*, c.first_name, c.last_name, c.phone_number, c.email, c.client_code
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

  const scheduleResult = await query(
    "SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
    [loanId],
  );

  const transactionsResult = await query(
    "SELECT * FROM transactions WHERE loan_id = $1 AND payment_status = $2 ORDER BY payment_date",
    [loanId, "completed"],
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

  const totalPaid = transactionsResult.rows.reduce(
    (sum, t) => sum + parseFloat(t.amount_paid),
    0,
  );
  const balance = parseFloat(loan.total_amount_due) - totalPaid;

  doc
    .fontSize(14)
    .fillColor("#4F46E5")
    .text("LOAN DETAILS", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Principal Amount: ${formatCurrency(loan.principal_amount)}`);
  doc.text(`Interest Rate: ${loan.interest_rate}% per month`);
  doc.text(`Duration: ${loan.loan_duration_months} months`);
  doc.text(`Total Interest: ${formatCurrency(loan.total_interest)}`);
  doc.text(`Total Amount Due: ${formatCurrency(loan.total_amount_due)}`);
  doc.text(`Total Paid: ${formatCurrency(totalPaid)}`);
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

  scheduleResult.rows.forEach((s) => {
    doc.fontSize(8);
    doc.text(`${s.payment_number}/${loan.loan_duration_months}`, 50, y);
    doc.text(formatDate(s.due_date), 130, y);
    doc.text(formatCurrency(s.amount_due), 220, y);
    doc.text(formatCurrency(s.amount_paid || 0), 310, y);
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

  doc.end();
  const buffer = await done;
  return { buffer, filename };
};

// ============================================================
// PAYMENT RECEIPT
// ============================================================
export const buildReceiptPdf = async (transactionId, tid) => {
  const tt = tClause(tid, 1, "t.tenant_id");
  const result = await query(
    `
      SELECT t.*,
        l.loan_code, l.principal_amount, l.total_amount_due,
        c.first_name, c.last_name, c.phone_number, c.client_code
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      JOIN clients c ON t.client_id = c.id
      WHERE t.id = $1${tt.clause}
    `,
    [transactionId, ...tt.params],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError("Transaction not found");
  }
  const txn = result.rows[0];

  const doc = new PDFDocument({ size: "A5", margin: 30 });
  const filename = `receipt_${txn.transaction_code}.pdf`;
  const done = streamToBuffer(doc);

  doc
    .fontSize(18)
    .fillColor("#059669")
    .text("PAYMENT RECEIPT", { align: "center" });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`#${txn.transaction_code}`, { align: "center" });
  doc.moveDown();

  doc.fontSize(11).fillColor("#000");
  doc.text(`Date: ${formatDate(txn.payment_date)}`);
  doc.text(`Time: ${new Date(txn.created_at).toLocaleTimeString()}`);
  doc.moveDown();

  doc.fontSize(12).fillColor("#4F46E5").text("CLIENT:", { underline: true });
  doc.fontSize(11).fillColor("#000");
  doc.text(`${txn.first_name} ${txn.last_name}`);
  doc.text(`${txn.phone_number}`);
  doc.text(`Client Code: ${txn.client_code}`);
  doc.moveDown();

  doc.fontSize(12).fillColor("#4F46E5").text("LOAN:", { underline: true });
  doc.fontSize(11).fillColor("#000");
  doc.text(`Loan Code: ${txn.loan_code}`);
  doc.text(`Principal: ${formatCurrency(txn.principal_amount)}`);
  doc.text(`Total Due: ${formatCurrency(txn.total_amount_due)}`);
  doc.moveDown();

  doc.rect(30, doc.y, 350, 60).fillAndStroke("#F0FDF4", "#059669");
  doc.fillColor("#059669").fontSize(11);
  const payY = doc.y + 10;
  doc.text("PAYMENT AMOUNT:", 40, payY);
  doc.fontSize(20).text(formatCurrency(txn.amount_paid), 40, payY + 18);
  doc.y = payY + 60;
  doc.moveDown();

  doc.fontSize(10).fillColor("#000");
  doc.text(`Method: ${txn.payment_method}`);
  if (txn.payment_reference) {
    doc.text(`Reference: ${txn.payment_reference}`);
  }
  doc.moveDown();

  // Balance + next payment, computed AS OF this payment: cumulative
  // amount paid through this transaction (id <= current) so a receipt
  // re-printed later still reflects the state at the time it was paid.
  const paidThroughRes = await query(
    `SELECT COALESCE(SUM(amount_paid), 0) AS paid
       FROM transactions
      WHERE loan_id = $1 AND payment_status = 'completed' AND id <= $2`,
    [txn.loan_id, txn.id],
  );
  const paidThrough = parseFloat(paidThroughRes.rows[0].paid);
  const remaining = Math.max(
    0,
    parseFloat(txn.total_amount_due) - paidThrough,
  );

  // Next unpaid installment after this payment (schedules are already
  // allocated by the time the receipt is generated).
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

  doc.fontSize(12).fillColor("#4F46E5").text("BALANCE:", { underline: true });
  doc.fontSize(11).fillColor("#000");
  doc.text(`Remaining Balance: ${formatCurrency(remaining)}`);
  if (remaining <= 0) {
    doc.fillColor("#059669").text("Loan fully paid. Thank you!");
    doc.fillColor("#000");
  } else if (next) {
    doc.text(`Next Payment: ${formatCurrency(nextDue)}`);
    doc.text(`Next Payment Due: ${formatDate(next.due_date)}`);
  }
  doc.moveDown();

  if (txn.notes) {
    doc.fontSize(9).fillColor("#666").text(`Notes: ${txn.notes}`);
  }

  doc.moveDown(2);
  doc
    .fontSize(8)
    .fillColor("#666")
    .text("Thank you for your payment!", { align: "center" });
  doc.text("This is a system-generated receipt.", { align: "center" });

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
    [
      "Interest Rate:",
      `${(parseFloat(loan.interest_rate) * 12).toFixed(2)}% per annum`,
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
      content: `Interest shall be calculated at the rate of ${(parseFloat(loan.interest_rate) * 12).toFixed(2)}% per annum on the principal amount. The total interest payable over the loan period is ${formatCurrency(loan.total_interest)}.`,
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
