import express from "express";
import ExcelJS from "exceljs";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import logger from "../config/logger.js";
import {
  buildClientStatementPdf,
  buildLoanStatementPdf,
  buildReceiptPdf,
  buildLoanAgreementPdf,
  NotFoundError,
} from "../utils/pdfDocuments.js";
import { stampExcelSheet } from "../utils/stamp.js";

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

// Build a PDF (via the shared builders in utils/pdfDocuments.js) and
// stream it to the response as an attachment. The same builders are
// used by the email service so downloads and emailed PDFs match.
const servePdf = async (res, build, errMsg, logLabel) => {
  try {
    const { buffer, filename } = await build();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    logger.error(logLabel, error);
    res.status(500).json({ error: errMsg });
  }
};

// ============================================================
// EXCEL EXPORTS
// ============================================================

// Export all clients to Excel. Optional date_from / date_to narrow
// the result to clients that joined within that window.
router.get("/export/clients", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    // Subqueries (not JOINs) so transaction rows don't fan out and
    // inflate total_borrowed.
    const params = [];
    let queryText = `
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
      WHERE 1=1`;
    if (date_from) {
      params.push(date_from);
      queryText += ` AND c.created_at::date >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      queryText += ` AND c.created_at::date <= $${params.length}`;
    }
    const tc = tenantClause(req, params.length, "c.tenant_id");
    queryText += tc.clause;
    params.push(...tc.params);
    queryText += ` ORDER BY c.created_at DESC`;

    const result = await query(queryText, params);

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

    await stampExcelSheet(query, sheet, tenantId(req));
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Export clients error:", error);
    res.status(500).json({ error: "Failed to export clients" });
  }
});

// Export all loans to Excel. Filters:
//   - status: active | completed | defaulted | overdue (special-cased to
//             "any loan with at least one overdue installment" rather
//             than a literal loan.status value)
//   - date_from / date_to: narrow to loans disbursed in that window
router.get("/export/loans", async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    const params = [];
    let queryText = `
      SELECT
        l.loan_code,
        c.first_name, c.last_name, c.phone_number, c.client_code,
        l.principal_amount, l.interest_rate, l.loan_duration_months,
        l.total_amount_due, l.total_interest,
        COALESCE(SUM(t.amount_paid), 0) as total_paid,
        l.status, l.start_date, l.end_date, l.disbursed_at,
        l.overpayment_amount, l.refund_status
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
      WHERE 1=1
    `;

    if (status === "overdue") {
      // "Overdue" isn't a literal loan.status — it means any disbursed
      // loan that has at least one past-due installment with a balance.
      queryText += ` AND l.status IN ('active', 'defaulted')
        AND EXISTS (
          SELECT 1 FROM payment_schedules ps
          WHERE ps.loan_id = l.id
            AND (ps.status = 'overdue'
                 OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE))
            AND ps.amount_due > COALESCE(ps.amount_paid, 0)
        )`;
    } else if (status) {
      params.push(status);
      queryText += ` AND l.status = $${params.length}`;
    }

    if (date_from) {
      params.push(date_from);
      queryText += ` AND l.disbursed_at::date >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      queryText += ` AND l.disbursed_at::date <= $${params.length}`;
    }

    const tc = tenantClause(req, params.length, "l.tenant_id");
    queryText += tc.clause;
    params.push(...tc.params);

    queryText += ` GROUP BY l.id, c.first_name, c.last_name, c.phone_number, c.client_code ORDER BY l.created_at DESC`;

    const result = await query(queryText, params);

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
      { header: "Disbursed", key: "disbursed_at", width: 15 },
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

    const tot = {
      principal: 0, totalDue: 0, interest: 0, paid: 0, balance: 0, overpayment: 0,
    };
    result.rows.forEach((loan) => {
      const principal = parseFloat(loan.principal_amount) || 0;
      const totalDue = parseFloat(loan.total_amount_due) || 0;
      const interest = parseFloat(loan.total_interest) || 0;
      const paid = parseFloat(loan.total_paid) || 0;
      const balance = totalDue - paid;
      const overpayment = parseFloat(loan.overpayment_amount || 0);
      sheet.addRow({
        ...loan,
        client_name: `${loan.first_name} ${loan.last_name}`,
        principal_amount: principal.toFixed(2),
        total_amount_due: totalDue.toFixed(2),
        total_interest: interest.toFixed(2),
        total_paid: paid.toFixed(2),
        balance: balance.toFixed(2),
        overpayment_amount: overpayment.toFixed(2),
        disbursed_at: loan.disbursed_at
          ? new Date(loan.disbursed_at).toLocaleDateString()
          : "",
        start_date: new Date(loan.start_date).toLocaleDateString(),
        end_date: new Date(loan.end_date).toLocaleDateString(),
      });
      tot.principal += principal;
      tot.totalDue += totalDue;
      tot.interest += interest;
      tot.paid += paid;
      tot.balance += balance;
      tot.overpayment += overpayment;
    });

    // Totals row at the bottom — sums the numeric columns so the
    // user can sanity-check the portfolio without re-summing in Excel.
    const totalsRow = sheet.addRow({
      loan_code: "TOTAL",
      client_name: `${result.rows.length} loans`,
      principal_amount: tot.principal.toFixed(2),
      total_amount_due: tot.totalDue.toFixed(2),
      total_interest: tot.interest.toFixed(2),
      total_paid: tot.paid.toFixed(2),
      balance: tot.balance.toFixed(2),
      overpayment_amount: tot.overpayment.toFixed(2),
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    const filename = `loans_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await stampExcelSheet(query, sheet, tenantId(req));
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

    const tc = tenantClause(req, params.length, "t.tenant_id");
    queryText += tc.clause;
    params.push(...tc.params);

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

    await stampExcelSheet(query, sheet, tenantId(req));
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
    const tc = tenantClause(req, 0, "l.tenant_id");
    const result = await query(
      `
      SELECT
        ps.payment_number, ps.due_date, ps.amount_due, ps.amount_paid,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) as balance_due,
        (CURRENT_DATE - ps.due_date) as days_late,
        l.loan_code, l.principal_amount, l.total_amount_due,
        c.client_code, c.first_name, c.last_name, c.phone_number, c.email
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ps.status = 'overdue'${tc.clause}
      ORDER BY days_late DESC
    `,
      tc.params,
    );

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

    await stampExcelSheet(query, sheet, tenantId(req));
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
router.get("/pdf/client-statement/:clientId", (req, res) =>
  servePdf(
    res,
    () => buildClientStatementPdf(req.params.clientId, tenantId(req)),
    "Failed to generate statement",
    "Generate client statement error:",
  ),
);

// Loan Statement PDF
router.get("/pdf/loan-statement/:loanId", (req, res) =>
  servePdf(
    res,
    () => buildLoanStatementPdf(req.params.loanId, tenantId(req)),
    "Failed to generate statement",
    "Generate loan statement error:",
  ),
);

// Payment Receipt PDF
router.get("/pdf/receipt/:transactionId", (req, res) =>
  servePdf(
    res,
    () => buildReceiptPdf(req.params.transactionId, tenantId(req)),
    "Failed to generate receipt",
    "Generate receipt error:",
  ),
);

// Loan Agreement PDF
router.get("/pdf/loan-agreement/:loanId", (req, res) =>
  servePdf(
    res,
    () => buildLoanAgreementPdf(req.params.loanId, tenantId(req)),
    "Failed to generate loan agreement",
    "Generate loan agreement error:",
  ),
);

export default router;
