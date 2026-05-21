import express from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import analyticsService from "../services/analyticsService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// ============================================================
// Monthly revenue trends (last 12 months)
// Disbursed (from loans) and collected (from transactions) are
// aggregated SEPARATELY then joined to the month series. Joining
// loans×transactions directly (as the spec did) fans out and
// multiplies principal by the transaction count.
// ============================================================
router.get("/revenue-trends", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const result = await query(
      `
      WITH months AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
          DATE_TRUNC('month', CURRENT_DATE),
          '1 month'::interval
        ) AS month
      ),
      disb AS (
        SELECT DATE_TRUNC('month', start_date) AS m,
               SUM(principal_amount) AS disbursed,
               COUNT(*) AS new_loans
        FROM loans
        WHERE 1=1${t.clause}
        GROUP BY 1
      ),
      coll AS (
        SELECT DATE_TRUNC('month', payment_date) AS m,
               SUM(amount_paid) AS collected,
               COUNT(*) AS txns
        FROM transactions
        WHERE payment_status = 'completed'${t.clause}
        GROUP BY 1
      )
      SELECT
        TO_CHAR(m.month, 'Mon YYYY') AS label,
        m.month AS date,
        COALESCE(d.disbursed, 0) AS disbursed,
        COALESCE(c.collected, 0) AS collected,
        COALESCE(d.new_loans, 0) AS new_loans,
        COALESCE(c.txns, 0) AS transactions_count
      FROM months m
      LEFT JOIN disb d ON d.m = m.month
      LEFT JOIN coll c ON c.m = m.month
      ORDER BY m.month ASC
    `,
      t.params,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Revenue trends error:", error);
    res.status(500).json({ error: "Failed to fetch trends" });
  }
});

// ============================================================
// Loan portfolio breakdown by status
// ============================================================
router.get("/portfolio-breakdown", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const result = await query(
      `
      SELECT status,
             COUNT(*)::int AS count,
             COALESCE(SUM(principal_amount), 0) AS total_value
      FROM loans
      WHERE 1=1${t.clause}
      GROUP BY status
      ORDER BY count DESC
    `,
      t.params,
    );
    const total = result.rows.reduce(
      (sum, row) => sum + parseInt(row.count, 10),
      0,
    );
    const data = result.rows.map((row) => ({
      ...row,
      percentage:
        total > 0
          ? ((parseInt(row.count, 10) / total) * 100).toFixed(1)
          : 0,
    }));
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Portfolio breakdown error:", error);
    res.status(500).json({ error: "Failed to fetch breakdown" });
  }
});

// ============================================================
// Top clients. Correlated subqueries (same pattern as the
// clients bulk export) so a client's principal isn't multiplied
// by their transaction count.
// ============================================================
router.get("/top-clients", async (req, res) => {
  try {
    const { metric = "borrowed", limit = 10 } = req.query;

    // Whitelist — never interpolate raw input into SQL
    const orderBy =
      metric === "paid"
        ? "total_paid"
        : metric === "loans"
          ? "loan_count"
          : "total_borrowed";
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const tc = tenantClause(req, 1, "c.tenant_id");
    const result = await query(
      `SELECT
        c.id, c.first_name, c.last_name, c.client_code, c.phone_number,
        (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id)
          AS loan_count,
        (SELECT COALESCE(SUM(l.principal_amount), 0)
           FROM loans l WHERE l.client_id = c.id) AS total_borrowed,
        (SELECT COALESCE(SUM(t.amount_paid), 0)
           FROM transactions t
           JOIN loans l ON t.loan_id = l.id
           WHERE l.client_id = c.id
             AND t.payment_status = 'completed') AS total_paid
      FROM clients c
      WHERE (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id) > 0${tc.clause}
      ORDER BY ${orderBy} DESC
      LIMIT $1`,
      [safeLimit, ...tc.params],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Top clients error:", error);
    res.status(500).json({ error: "Failed to fetch top clients" });
  }
});

// ============================================================
// Geographic distribution (single clients→loans join, no fan-out)
// ============================================================
router.get("/geographic", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "c.tenant_id");
    const result = await query(
      `
      SELECT
        COALESCE(c.county, 'Unknown') AS county,
        COUNT(DISTINCT c.id) AS client_count,
        COUNT(DISTINCT l.id) AS loan_count,
        COALESCE(SUM(l.principal_amount), 0) AS total_disbursed
      FROM clients c
      LEFT JOIN loans l ON c.id = l.client_id
      WHERE 1=1${tc.clause}
      GROUP BY c.county
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY client_count DESC
      LIMIT 15
    `,
      tc.params,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Geographic error:", error);
    res.status(500).json({ error: "Failed to fetch geographic data" });
  }
});

// ============================================================
// Loan size distribution
// ============================================================
router.get("/loan-distribution", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const result = await query(
      `
      SELECT
        CASE
          WHEN principal_amount < 10000 THEN '< 10K'
          WHEN principal_amount < 25000 THEN '10K - 25K'
          WHEN principal_amount < 50000 THEN '25K - 50K'
          WHEN principal_amount < 100000 THEN '50K - 100K'
          WHEN principal_amount < 250000 THEN '100K - 250K'
          WHEN principal_amount < 500000 THEN '250K - 500K'
          WHEN principal_amount < 1000000 THEN '500K - 1M'
          ELSE '> 1M'
        END AS range,
        CASE
          WHEN principal_amount < 10000 THEN 1
          WHEN principal_amount < 25000 THEN 2
          WHEN principal_amount < 50000 THEN 3
          WHEN principal_amount < 100000 THEN 4
          WHEN principal_amount < 250000 THEN 5
          WHEN principal_amount < 500000 THEN 6
          WHEN principal_amount < 1000000 THEN 7
          ELSE 8
        END AS sort_order,
        COUNT(*) AS count,
        COALESCE(SUM(principal_amount), 0) AS total_value
      FROM loans
      WHERE 1=1${t.clause}
      GROUP BY range, sort_order
      ORDER BY sort_order
    `,
      t.params,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Loan distribution error:", error);
    res.status(500).json({ error: "Failed to fetch distribution" });
  }
});

// ============================================================
// Default rate trend (last 12 months).
// NOTE: uses each loan's CURRENT status against the cumulative
// count of loans started by each month — there is no historical
// status, so this is an approximation (a loan defaulted today
// counts as defaulted in every past month it existed).
// ============================================================
router.get("/default-trend", async (req, res) => {
  try {
    const t = tenantClause(req, 0, "l.tenant_id");
    const result = await query(
      `
      WITH months AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
          DATE_TRUNC('month', CURRENT_DATE),
          '1 month'::interval
        ) AS month
      )
      SELECT
        TO_CHAR(m.month, 'Mon YYYY') AS label,
        COUNT(CASE
          WHEN DATE_TRUNC('month', l.start_date) <= m.month
           AND l.status IN ('active', 'completed', 'defaulted')
          THEN l.id END) AS total_loans,
        COUNT(CASE
          WHEN DATE_TRUNC('month', l.start_date) <= m.month
           AND l.status = 'defaulted'
          THEN l.id END) AS defaulted_loans
      FROM months m
      LEFT JOIN loans l ON DATE_TRUNC('month', l.start_date) <= m.month${t.clause}
      GROUP BY m.month
      ORDER BY m.month ASC
    `,
      t.params,
    );
    const data = result.rows.map((row) => ({
      ...row,
      default_rate:
        parseInt(row.total_loans, 10) > 0
          ? (
              (parseInt(row.defaulted_loans, 10) /
                parseInt(row.total_loans, 10)) *
              100
            ).toFixed(2)
          : 0,
    }));
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Default trend error:", error);
    res.status(500).json({ error: "Failed to fetch default trend" });
  }
});

// ============================================================
// Payment method breakdown
// ============================================================
router.get("/payment-methods", async (req, res) => {
  try {
    const t = tenantClause(req, 0);
    const result = await query(
      `
      SELECT payment_method,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount_paid), 0) AS total_amount
      FROM transactions
      WHERE payment_status = 'completed'${t.clause}
      GROUP BY payment_method
      ORDER BY count DESC
    `,
      t.params,
    );
    const total = result.rows.reduce(
      (sum, row) => sum + parseInt(row.count, 10),
      0,
    );
    const data = result.rows.map((row) => ({
      ...row,
      percentage:
        total > 0
          ? ((parseInt(row.count, 10) / total) * 100).toFixed(1)
          : 0,
    }));
    res.json({ success: true, data });
  } catch (error) {
    logger.error("Payment methods error:", error);
    res.status(500).json({ error: "Failed to fetch methods" });
  }
});

// ============================================================
// Business KPIs
// ============================================================
router.get("/kpis", async (req, res) => {
  try {
    // interest_rate stores the MONTHLY rate as a percent, so annual
    // % = interest_rate * 12 (the spec's *12*100 was a 100x bug).
    const k = tenantClause(req, 0);
    const c = k.clause;
    const kpis = await query(
      `
      SELECT
        (SELECT COUNT(*) FROM clients WHERE status = 'active'${c}) AS active_clients,
        (SELECT COUNT(*) FROM loans WHERE status = 'active'${c}) AS active_loans,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans WHERE status = 'active'${c}) AS active_portfolio,

        (SELECT COALESCE(SUM(amount_paid), 0) FROM transactions
          WHERE payment_status = 'completed'
            AND payment_date >= CURRENT_DATE - INTERVAL '30 days'${c}) AS collections_30d,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans
          WHERE start_date >= CURRENT_DATE - INTERVAL '30 days'${c}) AS disbursements_30d,

        (SELECT COUNT(*) FROM loans WHERE status = 'defaulted'${c}) AS total_defaulted,
        (SELECT COUNT(*) FROM payment_schedules WHERE status = 'overdue'${c}) AS overdue_count,
        (SELECT COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0)
          FROM payment_schedules WHERE status = 'overdue'${c}) AS total_overdue_amount,

        (SELECT COUNT(*) FROM clients WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'${c}) AS new_clients_30d,
        (SELECT COUNT(*) FROM loans WHERE start_date >= CURRENT_DATE - INTERVAL '30 days'${c}) AS new_loans_30d,

        (SELECT COALESCE(AVG(principal_amount), 0) FROM loans WHERE status = 'active'${c}) AS avg_loan_size,
        (SELECT COALESCE(AVG(interest_rate * 12), 0) FROM loans WHERE status = 'active'${c}) AS avg_interest_rate
    `,
      k.params,
    );
    res.json({ success: true, data: kpis.rows[0] });
  } catch (error) {
    logger.error("KPIs error:", error);
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

// ============================================================
// Bundled analytics for the new Reports & Analytics dashboards.
// Distinct from the per-chart endpoints above (which still drive
// pages/Analytics.jsx). These ones do one round-trip and return
// everything the new dashboard renders.
// ============================================================

// TENANT: full report data for /pages/Reports.jsx
router.get("/tenant", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res.status(400).json({ error: "Tenant context required" });
    }
    const { from, to } = req.query;
    const months = Math.min(
      Math.max(parseInt(req.query.months, 10) || 6, 1),
      24,
    );

    const [
      kpis,
      par,
      collectionTrend,
      disbursementTrend,
      aging,
      officers,
      statusDist,
    ] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid, from, to),
      analyticsService.getPortfolioAtRisk(tid),
      analyticsService.getCollectionTrend(tid, months),
      analyticsService.getDisbursementTrend(tid, months),
      analyticsService.getAgingAnalysis(tid),
      analyticsService.getLoanOfficerPerformance(tid),
      analyticsService.getLoanStatusDistribution(tid),
    ]);

    res.json({
      success: true,
      data: {
        kpis,
        par,
        collectionTrend,
        disbursementTrend,
        aging,
        officers,
        statusDist,
      },
    });
  } catch (error) {
    logger.error("Tenant analytics error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// PLATFORM: full report data for /admin/pages/PlatformReports.jsx
router.get("/platform", async (req, res) => {
  try {
    if (!req.user?.is_platform_admin) {
      return res.status(403).json({ error: "Platform admin only" });
    }
    const { from, to } = req.query;
    const months = Math.min(
      Math.max(parseInt(req.query.months, 10) || 6, 1),
      24,
    );

    const [kpis, revenueTrend, leaderboard] = await Promise.all([
      analyticsService.getPlatformKPIs(from, to),
      analyticsService.getPlatformRevenueTrend(months),
      analyticsService.getTenantLeaderboard(),
    ]);

    res.json({
      success: true,
      data: { kpis, revenueTrend, leaderboard },
    });
  } catch (error) {
    logger.error("Platform analytics error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// PDF portfolio report — KPI overview + PAR + aging. Streamed
// straight to the response. Mirrors the existing servePdf pattern in
// routes/reports.js but uses a bespoke builder (the shared builders
// in utils/pdfDocuments.js are loan/client/receipt-specific).
router.get("/export/pdf", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res.status(400).json({ error: "Tenant context required" });
    }

    const [kpis, par, aging] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid),
      analyticsService.getPortfolioAtRisk(tid),
      analyticsService.getAgingAnalysis(tid),
    ]);

    const tr = await query(
      "SELECT business_name FROM tenants WHERE id = $1",
      [tid],
    );
    const businessName = tr.rows[0]?.business_name || "Portfolio Report";

    const filename = `portfolio-report-${new Date()
      .toISOString()
      .split("T")[0]}.pdf`;
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    doc.pipe(res);

    const fmtKES = (n) =>
      "KES " +
      parseFloat(n || 0).toLocaleString("en-KE", {
        maximumFractionDigits: 0,
      });

    // ── Header ──
    doc.fontSize(20).fillColor("#4F46E5").text(businessName, {
      align: "center",
    });
    doc.fontSize(14).fillColor("#666").text("Portfolio Report", {
      align: "center",
    });
    doc.fontSize(10).fillColor("#999").text(
      `Generated: ${new Date().toLocaleString("en-KE")}`,
      { align: "center" },
    );
    doc.moveDown(2);

    // ── KPIs ──
    doc.fontSize(14).fillColor("#000").text("Portfolio Overview", {
      underline: true,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");
    doc.text(`Total Loans: ${kpis.total_loans}`);
    doc.text(`Active Loans: ${kpis.active_loans}`);
    doc.text(`Completed Loans: ${kpis.completed_loans}`);
    doc.text(`Unique Borrowers: ${kpis.unique_borrowers}`);
    doc.text(`Total Disbursed: ${fmtKES(kpis.total_disbursed)}`);
    doc.text(`Total Collected: ${fmtKES(kpis.total_collected)}`);
    doc.text(`Interest Earned: ${fmtKES(kpis.interest_earned)}`);
    doc.text(`Average Loan Size: ${fmtKES(kpis.avg_loan_size)}`);
    doc.moveDown(1.5);

    // ── PAR ──
    doc.fontSize(14).fillColor("#000").text("Portfolio at Risk (PAR)", {
      underline: true,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");
    doc.text(`Total Outstanding: ${fmtKES(par.total_outstanding)}`);
    doc.text(`At-Risk Amount: ${fmtKES(par.par_amount)}`);
    doc.text(`PAR Percentage: ${par.par_percentage}%`);
    doc.text(
      `At-Risk Loans: ${par.at_risk_count} of ${par.total_active} active`,
    );
    doc.moveDown(1.5);

    // ── Aging ──
    doc.fontSize(14).fillColor("#000").text("Aging Analysis", {
      underline: true,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");
    if (aging.length === 0) {
      doc.fillColor("#999").text("No outstanding payments.");
    } else {
      aging.forEach((a) => {
        doc.fillColor("#333").text(
          `${a.bucket}: ${a.count} payments — ${fmtKES(a.amount)}`,
        );
      });
    }

    doc.end();
  } catch (error) {
    logger.error("PDF export error:", error);
    // Don't double-send if the stream already started — pdfkit will
    // have written headers by then.
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    } else {
      res.end();
    }
  }
});

// Excel portfolio report — Summary + Loans detail. Mirrors the header
// styling used by routes/reports.js exports (white-on-indigo header
// row) so all platform Excel outputs feel consistent.
router.get("/export/excel", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res.status(400).json({ error: "Tenant context required" });
    }

    const [kpis, par, aging] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid),
      analyticsService.getPortfolioAtRisk(tid),
      analyticsService.getAgingAnalysis(tid),
    ]);

    const loans = await query(
      `SELECT
         l.loan_code,
         c.first_name || ' ' || c.last_name      AS client,
         l.principal_amount, l.total_amount_due, l.status, l.start_date,
         COALESCE(p.paid, 0)                     AS paid
       FROM loans l
       JOIN clients c ON l.client_id = c.id
       LEFT JOIN (
         SELECT loan_id, SUM(amount_paid) AS paid
         FROM transactions WHERE payment_status='completed'
         GROUP BY loan_id
       ) p ON p.loan_id = l.id
       WHERE l.tenant_id = $1
       ORDER BY l.start_date DESC NULLS LAST`,
      [tid],
    );

    const workbook = new ExcelJS.Workbook();

    // ── Summary sheet ──
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [{ width: 32 }, { width: 22 }];
    summary.addRow(["Portfolio Report", ""]);
    summary.addRow(["Generated", new Date().toLocaleString("en-KE")]);
    summary.addRow([]);
    summary.addRow(["KPI", "Value"]);
    summary.addRow(["Total Loans", kpis.total_loans]);
    summary.addRow(["Active Loans", kpis.active_loans]);
    summary.addRow(["Completed Loans", kpis.completed_loans]);
    summary.addRow(["Unique Borrowers", kpis.unique_borrowers]);
    summary.addRow(["Total Disbursed (KES)", kpis.total_disbursed]);
    summary.addRow(["Total Collected (KES)", kpis.total_collected]);
    summary.addRow(["Interest Earned (KES)", kpis.interest_earned]);
    summary.addRow(["Average Loan Size (KES)", kpis.avg_loan_size]);
    summary.addRow([]);
    summary.addRow(["Portfolio at Risk", ""]);
    summary.addRow(["Total Outstanding (KES)", par.total_outstanding]);
    summary.addRow(["At-Risk Amount (KES)", par.par_amount]);
    summary.addRow(["PAR %", `${par.par_percentage}%`]);
    summary.addRow([
      "At-Risk / Active Loans",
      `${par.at_risk_count} / ${par.total_active}`,
    ]);
    summary.addRow([]);
    summary.addRow(["Aging Bucket", "Amount Outstanding (KES)"]);
    aging.forEach((a) => summary.addRow([a.bucket, a.amount]));
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.getRow(4).font = { bold: true };
    summary.getRow(12).font = { bold: true };

    // ── Loans detail ──
    const loansSheet = workbook.addWorksheet("Loans");
    loansSheet.columns = [
      { header: "Loan Code", key: "loan_code", width: 16 },
      { header: "Client", key: "client", width: 26 },
      { header: "Principal", key: "principal_amount", width: 15 },
      { header: "Total Due", key: "total_amount_due", width: 15 },
      { header: "Paid", key: "paid", width: 15 },
      { header: "Balance", key: "balance", width: 15 },
      { header: "Status", key: "status", width: 12 },
      { header: "Start Date", key: "start_date", width: 14 },
    ];
    loansSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    loansSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };
    loans.rows.forEach((l) => {
      const principal = parseFloat(l.principal_amount);
      const totalDue = parseFloat(l.total_amount_due);
      const paid = parseFloat(l.paid);
      loansSheet.addRow({
        loan_code: l.loan_code,
        client: l.client,
        principal_amount: principal.toFixed(2),
        total_amount_due: totalDue.toFixed(2),
        paid: paid.toFixed(2),
        balance: (totalDue - paid).toFixed(2),
        status: l.status,
        start_date: l.start_date
          ? new Date(l.start_date).toLocaleDateString("en-KE")
          : "",
      });
    });

    const filename = `portfolio-report-${new Date()
      .toISOString()
      .split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Excel export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate Excel" });
    } else {
      res.end();
    }
  }
});

export default router;
