import express from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

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

// ============================================================
// EXCEL EXPORTS
// ============================================================

// Export all clients to Excel
router.get("/export/clients", async (req, res) => {
  try {
    // Subqueries (not JOINs) so transaction rows don't fan out and
    // inflate total_borrowed.
    const result = await query(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id)
          AS total_loans,
        (SELECT COALESCE(SUM(l.principal_amount), 0)
           FROM loans l WHERE l.client_id = c.id) AS total_borrowed,
        (SELECT COALESCE(SUM(t.amount_paid), 0)
           FROM transactions t
           JOIN loans l ON t.loan_id = l.id
           WHERE l.client_id = c.id
             AND t.payment_status = 'completed') AS total_paid
      FROM clients c
      ORDER BY c.created_at DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Clients");

    sheet.columns = [
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "First Name", key: "first_name", width: 15 },
      { header: "Last Name", key: "last_name", width: 15 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "ID Number", key: "id_number", width: 12 },
      { header: "Business", key: "business_name", width: 20 },
      { header: "City", key: "city", width: 15 },
      { header: "County", key: "county", width: 15 },
      { header: "Total Loans", key: "total_loans", width: 12 },
      { header: "Total Borrowed", key: "total_borrowed", width: 18 },
      { header: "Total Paid", key: "total_paid", width: 18 },
      { header: "Status", key: "status", width: 12 },
      { header: "Joined", key: "created_at", width: 15 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };

    result.rows.forEach((client) => {
      sheet.addRow({
        ...client,
        total_borrowed: parseFloat(client.total_borrowed).toFixed(2),
        total_paid: parseFloat(client.total_paid).toFixed(2),
        created_at: new Date(client.created_at).toLocaleDateString(),
      });
    });

    const filename = `clients_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export clients error:", error);
    res.status(500).json({ error: "Failed to export clients" });
  }
});

// Export all loans to Excel
router.get("/export/loans", async (req, res) => {
  try {
    const { status } = req.query;
    let queryText = `
      SELECT
        l.loan_code,
        c.first_name, c.last_name, c.phone_number, c.client_code,
        l.principal_amount, l.interest_rate, l.loan_duration_months,
        l.total_amount_due, l.total_interest,
        COALESCE(SUM(t.amount_paid), 0) as total_paid,
        l.status, l.start_date, l.end_date,
        l.overpayment_amount, l.refund_status
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
    `;

    if (status) {
      queryText += ` WHERE l.status = $1`;
    }

    queryText += ` GROUP BY l.id, c.first_name, c.last_name, c.phone_number, c.client_code ORDER BY l.created_at DESC`;

    const result = await query(queryText, status ? [status] : []);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Loans");

    sheet.columns = [
      { header: "Loan Code", key: "loan_code", width: 15 },
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "Client Name", key: "client_name", width: 25 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Principal", key: "principal_amount", width: 15 },
      { header: "Interest Rate (%)", key: "interest_rate", width: 15 },
      { header: "Duration (months)", key: "loan_duration_months", width: 15 },
      { header: "Total Due", key: "total_amount_due", width: 18 },
      { header: "Total Interest", key: "total_interest", width: 15 },
      { header: "Total Paid", key: "total_paid", width: 15 },
      { header: "Balance", key: "balance", width: 15 },
      { header: "Start Date", key: "start_date", width: 15 },
      { header: "End Date", key: "end_date", width: 15 },
      { header: "Status", key: "status", width: 12 },
      { header: "Overpayment", key: "overpayment_amount", width: 15 },
      { header: "Refund Status", key: "refund_status", width: 15 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };

    result.rows.forEach((loan) => {
      sheet.addRow({
        ...loan,
        client_name: `${loan.first_name} ${loan.last_name}`,
        principal_amount: parseFloat(loan.principal_amount).toFixed(2),
        total_amount_due: parseFloat(loan.total_amount_due).toFixed(2),
        total_interest: parseFloat(loan.total_interest).toFixed(2),
        total_paid: parseFloat(loan.total_paid).toFixed(2),
        balance: (
          parseFloat(loan.total_amount_due) - parseFloat(loan.total_paid)
        ).toFixed(2),
        overpayment_amount: parseFloat(loan.overpayment_amount || 0).toFixed(2),
        start_date: new Date(loan.start_date).toLocaleDateString(),
        end_date: new Date(loan.end_date).toLocaleDateString(),
      });
    });

    const filename = `loans_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export loans error:", error);
    res.status(500).json({ error: "Failed to export loans" });
  }
});

// Export all payments to Excel
router.get("/export/payments", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    let queryText = `
      SELECT
        t.transaction_code, t.amount_paid, t.payment_date, t.payment_method,
        t.payment_reference, t.notes,
        c.client_code, c.first_name, c.last_name, c.phone_number,
        l.loan_code, l.principal_amount
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE t.payment_status = 'completed'
    `;

    const params = [];
    if (date_from) {
      params.push(date_from);
      queryText += ` AND t.payment_date >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      queryText += ` AND t.payment_date <= $${params.length}`;
    }

    queryText += ` ORDER BY t.payment_date DESC`;

    const result = await query(queryText, params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Payments");

    sheet.columns = [
      { header: "Transaction Code", key: "transaction_code", width: 18 },
      { header: "Date", key: "payment_date", width: 15 },
      { header: "Loan Code", key: "loan_code", width: 15 },
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "Client Name", key: "client_name", width: 25 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Amount Paid", key: "amount_paid", width: 15 },
      { header: "Method", key: "payment_method", width: 15 },
      { header: "Reference", key: "payment_reference", width: 20 },
      { header: "Notes", key: "notes", width: 30 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF059669" },
    };

    let totalAmount = 0;
    result.rows.forEach((payment) => {
      sheet.addRow({
        ...payment,
        client_name: `${payment.first_name} ${payment.last_name}`,
        amount_paid: parseFloat(payment.amount_paid).toFixed(2),
        payment_date: new Date(payment.payment_date).toLocaleDateString(),
      });
      totalAmount += parseFloat(payment.amount_paid);
    });

    const totalRow = sheet.addRow({
      transaction_code: "TOTAL",
      amount_paid: totalAmount.toFixed(2),
    });
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    const filename = `payments_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export payments error:", error);
    res.status(500).json({ error: "Failed to export payments" });
  }
});

// Export overdue payments
router.get("/export/overdue", async (req, res) => {
  try {
    const result = await query(`
      SELECT
        ps.payment_number, ps.due_date, ps.amount_due, ps.amount_paid,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) as balance_due,
        (CURRENT_DATE - ps.due_date) as days_late,
        l.loan_code, l.principal_amount, l.total_amount_due,
        c.client_code, c.first_name, c.last_name, c.phone_number, c.email
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ps.status = 'overdue'
      ORDER BY days_late DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Overdue Payments");

    sheet.columns = [
      { header: "Days Late", key: "days_late", width: 12 },
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "Client Name", key: "client_name", width: 25 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "Loan Code", key: "loan_code", width: 15 },
      { header: "Payment #", key: "payment_number", width: 12 },
      { header: "Due Date", key: "due_date", width: 15 },
      { header: "Amount Due", key: "amount_due", width: 15 },
      { header: "Amount Paid", key: "amount_paid", width: 15 },
      { header: "Balance", key: "balance_due", width: 15 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDC2626" },
    };

    let totalOverdue = 0;
    result.rows.forEach((item) => {
      sheet.addRow({
        ...item,
        client_name: `${item.first_name} ${item.last_name}`,
        amount_due: parseFloat(item.amount_due).toFixed(2),
        amount_paid: parseFloat(item.amount_paid || 0).toFixed(2),
        balance_due: parseFloat(item.balance_due).toFixed(2),
        due_date: new Date(item.due_date).toLocaleDateString(),
      });
      totalOverdue += parseFloat(item.balance_due);
    });

    const totalRow = sheet.addRow({
      days_late: "TOTAL",
      balance_due: totalOverdue.toFixed(2),
    });
    totalRow.font = { bold: true };

    const filename = `overdue_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export overdue error:", error);
    res.status(500).json({ error: "Failed to export overdue payments" });
  }
});

// ============================================================
// PDF REPORTS
// ============================================================

// Client Statement PDF
router.get("/pdf/client-statement/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    const clientResult = await query("SELECT * FROM clients WHERE id = $1", [
      clientId,
    ]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);

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

    doc
      .fontSize(14)
      .fillColor("#4F46E5")
      .text("SUMMARY", { underline: true });
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
  } catch (error) {
    logger.error("Generate client statement error:", error);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// Loan Statement PDF
router.get("/pdf/loan-statement/:loanId", async (req, res) => {
  try {
    const { loanId } = req.params;

    const loanResult = await query(
      `
      SELECT l.*, c.first_name, c.last_name, c.phone_number, c.email, c.client_code
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1
    `,
      [loanId],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

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
  } catch (error) {
    logger.error("Generate loan statement error:", error);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// Payment Receipt PDF
router.get("/pdf/receipt/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    const result = await query(
      `
      SELECT t.*,
        l.loan_code, l.principal_amount, l.total_amount_due,
        c.first_name, c.last_name, c.phone_number, c.client_code
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      JOIN clients c ON t.client_id = c.id
      WHERE t.id = $1
    `,
      [transactionId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    const txn = result.rows[0];

    const doc = new PDFDocument({ size: "A5", margin: 30 });
    const filename = `receipt_${txn.transaction_code}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

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

    doc
      .rect(30, doc.y, 350, 60)
      .fillAndStroke("#F0FDF4", "#059669");
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
  } catch (error) {
    logger.error("Generate receipt error:", error);
    res.status(500).json({ error: "Failed to generate receipt" });
  }
});

// Loan Agreement PDF
router.get("/pdf/loan-agreement/:loanId", async (req, res) => {
  try {
    const { loanId } = req.params;

    const loanResult = await query(
      `
      SELECT l.*,
        c.first_name, c.last_name, c.phone_number, c.email,
        c.id_number, c.address, c.city, c.county, c.client_code,
        c.business_name, c.business_type
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1
    `,
      [loanId],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const loan = loanResult.rows[0];

    const companyResult = await query(
      "SELECT * FROM company_settings ORDER BY id LIMIT 1",
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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

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
  } catch (error) {
    logger.error("Generate loan agreement error:", error);
    res.status(500).json({ error: "Failed to generate loan agreement" });
  }
});

export default router;
