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
    // LEFT JOIN branches so clients without a branch (older rows
    // pre-multi-branch, or platform-managed default) come through
    // with branch_name NULL instead of being dropped. client_type,
    // credit_score, kyc_verified, gender, dob and signup promo are
    // surfaced too — these are the "newly-added" fields the dashboard
    // already shows on the client detail page that were missing from
    // the export.
    let queryText = `
      SELECT
        c.*,
        b.name AS branch_name,
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
      LEFT JOIN branches b ON b.id = c.branch_id
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

    // Title-case helper for enum values so the spreadsheet reads
    // "Individual / Group / Business" instead of the raw lowercase
    // stored on the row.
    const titleCase = (s) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    sheet.columns = [
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "First Name", key: "first_name", width: 15 },
      { header: "Last Name", key: "last_name", width: 15 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "ID Number", key: "id_number", width: 12 },
      { header: "Client Type", key: "client_type", width: 12 },
      { header: "Branch", key: "branch_name", width: 18 },
      { header: "Gender", key: "gender", width: 10 },
      { header: "Date of Birth", key: "date_of_birth", width: 14 },
      { header: "Business", key: "business_name", width: 20 },
      { header: "Business Type", key: "business_type", width: 16 },
      { header: "City", key: "city", width: 15 },
      { header: "County", key: "county", width: 15 },
      { header: "Credit Score", key: "credit_score", width: 13 },
      { header: "KYC Verified", key: "kyc_verified", width: 13 },
      { header: "Total Loans", key: "total_loans", width: 12 },
      { header: "Total Borrowed", key: "total_borrowed", width: 18 },
      { header: "Total Paid", key: "total_paid", width: 18 },
      { header: "Status", key: "status", width: 12 },
      { header: "Signup Promo", key: "signup_promo_code", width: 16 },
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
        client_type: titleCase(client.client_type),
        gender: titleCase(client.gender),
        date_of_birth: client.date_of_birth
          ? new Date(client.date_of_birth).toLocaleDateString()
          : "",
        kyc_verified: client.kyc_verified ? "Yes" : "No",
        // Numeric credit_score stays as an Excel number (no toFixed)
        // so column math works; empty string when unscored.
        credit_score:
          client.credit_score == null ? "" : client.credit_score,
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
    // Build the loan row out of per-loan subqueries (NOT join + SUM)
    // so a loan with N transactions doesn't fan out and inflate the
    // per-loan totals N×. Mirrors the same shape /loans uses for its
    // list query. Each subquery is independent, so adding a column
    // here doesn't perturb anything else.
    let queryText = `
      SELECT
        l.loan_code,
        c.first_name, c.last_name, c.phone_number, c.client_code,
        l.principal_amount, l.interest_rate, l.loan_duration_months,
        l.total_amount_due, l.total_interest,
        l.interest_method,
        pk.name AS package_name,
        l.status, l.start_date, l.end_date, l.disbursed_at,
        l.overpayment_amount, l.refund_status,
        -- Gross cash booked (matches what staff hand-counted in the
        -- "amount paid" field across all completed transactions).
        COALESCE((SELECT SUM(t.amount_paid)
                    FROM transactions t
                   WHERE t.loan_id = l.id
                     AND t.payment_status = 'completed'), 0) AS gross_cash,
        -- Cash that actually settled amount_due, per-row LEAST cap so
        -- knockdown principal doesn't double-count.
        COALESCE((SELECT SUM(LEAST(ps.amount_paid, ps.amount_due))
                    FROM payment_schedules ps
                   WHERE ps.loan_id = l.id), 0) AS cash_to_due,
        -- Penalty paid in cash (transactions.penalty_portion lives
        -- alongside amount_paid).
        COALESCE((SELECT SUM(t.penalty_portion)
                    FROM transactions t
                   WHERE t.loan_id = l.id
                     AND t.payment_status = 'completed'), 0) AS penalty_paid,
        -- Waivers — count + buckets pulled from the allocation JSON the
        -- waiverService stores at apply-time.
        COALESCE((SELECT COUNT(*) FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS waivers_count,
        COALESCE((SELECT SUM(w.amount) FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS total_waived,
        COALESCE((SELECT SUM(COALESCE((w.allocation->>'amount_total')::float, 0))
                    FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS waived_toward_balance,
        COALESCE((SELECT SUM(COALESCE((w.allocation->>'interest_total')::float, 0))
                    FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS interest_waived,
        COALESCE((SELECT SUM(COALESCE((w.allocation->>'penalty_total')::float, 0))
                    FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS penalty_waived,
        COALESCE((SELECT SUM(COALESCE((w.allocation->>'principal_total')::float, 0))
                    FROM loan_waivers w
                   WHERE w.loan_id = l.id AND w.status = 'approved'), 0)
          AS principal_waived
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      LEFT JOIN loan_packages pk ON pk.id = l.package_id
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

    // No GROUP BY: every aggregate above lives in a scalar subquery,
    // so the outer row is already 1:1 with `loans l`.
    queryText += ` ORDER BY l.created_at DESC`;

    const result = await query(queryText, params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Loans");

    // Title-case enum helper for interest_method so the column reads
    // "Flat / Reducing" instead of the raw lowercase token.
    const titleCase = (s) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

    sheet.columns = [
      // Identity + client
      { header: "Loan Code", key: "loan_code", width: 15 },
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "Client Name", key: "client_name", width: 25 },
      { header: "Phone", key: "phone_number", width: 15 },
      // Terms
      { header: "Package", key: "package_name", width: 18 },
      { header: "Interest Method", key: "interest_method", width: 14 },
      { header: "Principal", key: "principal_amount", width: 15 },
      { header: "Interest Rate (%)", key: "interest_rate", width: 15 },
      { header: "Duration (months)", key: "loan_duration_months", width: 15 },
      // Money ledger — amount_due side
      { header: "Total Due", key: "total_amount_due", width: 16 },
      { header: "Total Interest", key: "total_interest", width: 15 },
      { header: "Cash Paid (gross)", key: "gross_cash", width: 17 },
      { header: "Cash to Balance", key: "cash_to_due", width: 16 },
      { header: "Waived to Balance", key: "waived_toward_balance", width: 18 },
      { header: "Balance", key: "balance", width: 15 },
      // Penalty
      { header: "Penalty Paid (cash)", key: "penalty_paid", width: 18 },
      { header: "Penalty Waived", key: "penalty_waived", width: 16 },
      // Waiver breakdown
      { header: "Waivers Count", key: "waivers_count", width: 14 },
      { header: "Total Waived", key: "total_waived", width: 15 },
      { header: "Interest Waived", key: "interest_waived", width: 16 },
      { header: "Principal Waived", key: "principal_waived", width: 17 },
      // Dates + status + refunds
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
      principal: 0, totalDue: 0, interest: 0,
      grossCash: 0, cashToDue: 0, waivedToBalance: 0, balance: 0,
      penaltyPaid: 0, penaltyWaived: 0,
      totalWaived: 0, interestWaived: 0, principalWaived: 0,
      waiversCount: 0, overpayment: 0,
    };
    result.rows.forEach((loan) => {
      const principal = parseFloat(loan.principal_amount) || 0;
      const totalDue = parseFloat(loan.total_amount_due) || 0;
      const interest = parseFloat(loan.total_interest) || 0;
      const grossCash = parseFloat(loan.gross_cash) || 0;
      const cashToDue = parseFloat(loan.cash_to_due) || 0;
      const waivedToBalance = parseFloat(loan.waived_toward_balance) || 0;
      // Balance: completed loans always settle to 0, sub-shilling
      // residuals on active loans also round to 0. Same rule the
      // /loans list query enforces — keeps Reports in sync with the
      // dashboard. Penalty + overpayment intentionally excluded from
      // the numerator: penalty is its own ledger, overpayment is a
      // refund liability not a balance owed.
      const rawBalance = totalDue - cashToDue - waivedToBalance;
      const balance =
        loan.status === "completed" || Math.abs(rawBalance) < 1
          ? 0
          : Math.max(0, rawBalance);
      const penaltyPaid = parseFloat(loan.penalty_paid) || 0;
      const penaltyWaived = parseFloat(loan.penalty_waived) || 0;
      const totalWaived = parseFloat(loan.total_waived) || 0;
      const interestWaived = parseFloat(loan.interest_waived) || 0;
      const principalWaived = parseFloat(loan.principal_waived) || 0;
      const waiversCount = parseInt(loan.waivers_count, 10) || 0;
      const overpayment = parseFloat(loan.overpayment_amount || 0);
      sheet.addRow({
        ...loan,
        client_name: `${loan.first_name} ${loan.last_name}`,
        package_name: loan.package_name || "—",
        interest_method: titleCase(loan.interest_method),
        principal_amount: principal.toFixed(2),
        total_amount_due: totalDue.toFixed(2),
        total_interest: interest.toFixed(2),
        gross_cash: grossCash.toFixed(2),
        cash_to_due: cashToDue.toFixed(2),
        waived_toward_balance: waivedToBalance.toFixed(2),
        balance: balance.toFixed(2),
        penalty_paid: penaltyPaid.toFixed(2),
        penalty_waived: penaltyWaived.toFixed(2),
        waivers_count: waiversCount,
        total_waived: totalWaived.toFixed(2),
        interest_waived: interestWaived.toFixed(2),
        principal_waived: principalWaived.toFixed(2),
        overpayment_amount: overpayment.toFixed(2),
        disbursed_at: loan.disbursed_at
          ? new Date(loan.disbursed_at).toLocaleDateString()
          : "",
        start_date: loan.start_date
          ? new Date(loan.start_date).toLocaleDateString()
          : "",
        end_date: loan.end_date
          ? new Date(loan.end_date).toLocaleDateString()
          : "",
      });
      tot.principal += principal;
      tot.totalDue += totalDue;
      tot.interest += interest;
      tot.grossCash += grossCash;
      tot.cashToDue += cashToDue;
      tot.waivedToBalance += waivedToBalance;
      tot.balance += balance;
      tot.penaltyPaid += penaltyPaid;
      tot.penaltyWaived += penaltyWaived;
      tot.totalWaived += totalWaived;
      tot.interestWaived += interestWaived;
      tot.principalWaived += principalWaived;
      tot.waiversCount += waiversCount;
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
      gross_cash: tot.grossCash.toFixed(2),
      cash_to_due: tot.cashToDue.toFixed(2),
      waived_toward_balance: tot.waivedToBalance.toFixed(2),
      balance: tot.balance.toFixed(2),
      penalty_paid: tot.penaltyPaid.toFixed(2),
      penalty_waived: tot.penaltyWaived.toFixed(2),
      waivers_count: tot.waiversCount,
      total_waived: tot.totalWaived.toFixed(2),
      interest_waived: tot.interestWaived.toFixed(2),
      principal_waived: tot.principalWaived.toFixed(2),
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
