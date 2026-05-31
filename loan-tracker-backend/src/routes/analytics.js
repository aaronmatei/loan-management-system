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

// ── Period helper. Reads ?from=YYYY-MM-DD&to=YYYY-MM-DD off the
// request and returns the SQL fragments most charts need:
//   periodParams  — [from, to] when present, else []
//   off           — number of leading positional params (0 or 2)
//   loanDisb(col) — ` AND <col>::date BETWEEN $1 AND $2`  (or "")
//   txn(col)      — same shape but framed as a payment-date window
//   created(col)  — same shape for created_at columns
//   trunc         — `day` if window ≤ 31 days, else `month`
//   labelFmt/keyFmt — TO_CHAR formats matching trunc
function parsePeriod(req) {
  const { from, to } = req.query;
  const hasPeriod = !!(from && to);
  const dayDiff = hasPeriod
    ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
    : null;
  const trunc = hasPeriod && dayDiff <= 31 ? "day" : "month";
  return {
    hasPeriod,
    periodParams: hasPeriod ? [from, to] : [],
    off: hasPeriod ? 2 : 0,
    loanDisb: (col = "disbursed_at") =>
      hasPeriod ? ` AND ${col}::date BETWEEN $1 AND $2` : "",
    txn: (col = "payment_date") =>
      hasPeriod ? ` AND ${col}::date BETWEEN $1 AND $2` : "",
    created: (col = "created_at") =>
      hasPeriod ? ` AND ${col}::date BETWEEN $1 AND $2` : "",
    trunc,
    labelFmt: trunc === "day" ? "Mon DD" : "Mon YYYY",
    keyFmt: trunc === "day" ? "YYYY-MM-DD" : "YYYY-MM",
  };
}

// Render the selected period as a human label for PDF/Excel headers.
//  - "January 2024"               if from/to lines up with a single month
//  - "12 Jan 2024 – 28 Feb 2024"  for arbitrary ranges
//  - "Last 6 months"              when only `months` is given
function buildPeriodLabel({ from, to, months }) {
  if (from && to) {
    const f = new Date(from);
    const t = new Date(to);
    if (
      !Number.isNaN(f.getTime()) &&
      !Number.isNaN(t.getTime()) &&
      f.getFullYear() === t.getFullYear() &&
      f.getMonth() === t.getMonth() &&
      f.getDate() === 1
    ) {
      return f.toLocaleDateString("en-KE", { month: "long", year: "numeric" });
    }
    const opts = { day: "numeric", month: "short", year: "numeric" };
    return `${f.toLocaleDateString("en-KE", opts)} – ${t.toLocaleDateString("en-KE", opts)}`;
  }
  return `Last ${months} months`;
}

// ============================================================
// Monthly revenue trends (last 12 months)
// Disbursed (from loans) and collected (from transactions) are
// aggregated SEPARATELY then joined to the month series. Joining
// loans×transactions directly (as the spec did) fans out and
// multiplies principal by the transaction count.
// ============================================================
router.get("/revenue-trends", async (req, res) => {
  try {
    const p = parsePeriod(req);
    const t = tenantClause(req, p.off);
    // Bucket axis = day buckets across the window when ≤ 31d, else
    // monthly. When no period given, fall back to the original
    // last-12-months series.
    const seriesStart = p.hasPeriod
      ? `DATE_TRUNC('${p.trunc}', $1::date)`
      : `DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')`;
    const seriesEnd = p.hasPeriod
      ? `DATE_TRUNC('${p.trunc}', $2::date)`
      : `DATE_TRUNC('month', CURRENT_DATE)`;
    const step = `'1 ${p.trunc}'::interval`;
    const disbRange = p.hasPeriod
      ? `AND start_date::date BETWEEN $1 AND $2`
      : "";
    const collRange = p.hasPeriod
      ? `AND payment_date::date BETWEEN $1 AND $2`
      : "";
    const result = await query(
      `
      WITH buckets AS (
        SELECT generate_series(${seriesStart}, ${seriesEnd}, ${step}) AS bucket
      ),
      disb AS (
        SELECT DATE_TRUNC('${p.trunc}', start_date) AS m,
               SUM(principal_amount) AS disbursed,
               COUNT(*) AS new_loans
        FROM loans
        WHERE 1=1 ${disbRange}${t.clause}
        GROUP BY 1
      ),
      coll AS (
        SELECT DATE_TRUNC('${p.trunc}', payment_date) AS m,
               SUM(amount_paid) AS collected,
               COUNT(*) AS txns
        FROM transactions
        WHERE payment_status = 'completed' ${collRange}${t.clause}
        GROUP BY 1
      )
      SELECT
        TO_CHAR(b.bucket, '${p.labelFmt}') AS label,
        b.bucket AS date,
        COALESCE(d.disbursed, 0) AS disbursed,
        COALESCE(c.collected, 0) AS collected,
        COALESCE(d.new_loans, 0) AS new_loans,
        COALESCE(c.txns, 0) AS transactions_count
      FROM buckets b
      LEFT JOIN disb d ON d.m = b.bucket
      LEFT JOIN coll c ON c.m = b.bucket
      ORDER BY b.bucket ASC
    `,
      [...p.periodParams, ...t.params],
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
    const p = parsePeriod(req);
    const t = tenantClause(req, p.off);
    const result = await query(
      `
      SELECT status,
             COUNT(*)::int AS count,
             COALESCE(SUM(principal_amount), 0) AS total_value
      FROM loans
      WHERE 1=1${p.loanDisb("start_date")}${t.clause}
      GROUP BY status
      ORDER BY count DESC
    `,
      [...p.periodParams, ...t.params],
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
    const p = parsePeriod(req);

    // Whitelist — never interpolate raw input into SQL
    const orderBy =
      metric === "paid"
        ? "total_paid"
        : metric === "loans"
          ? "loan_count"
          : "total_borrowed";
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    // Param order: [limit, from?, to?, ...tenant]
    const limitPos = 1;
    const periodOff = limitPos + p.periodParams.length;
    const tc = tenantClause(req, periodOff, "c.tenant_id");

    // Period predicates inside the correlated subqueries — placeholders
    // for from/to land at $2 and $3 when present.
    const loanPeriod = p.hasPeriod
      ? `AND l.start_date::date BETWEEN $2 AND $3`
      : "";
    const txnPeriod = p.hasPeriod
      ? `AND t.payment_date::date BETWEEN $2 AND $3`
      : "";

    const result = await query(
      `SELECT
        c.id, c.first_name, c.last_name, c.client_code, c.phone_number,
        (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id ${loanPeriod})
          AS loan_count,
        (SELECT COALESCE(SUM(l.principal_amount), 0)
           FROM loans l WHERE l.client_id = c.id ${loanPeriod}) AS total_borrowed,
        (SELECT COALESCE(SUM(t.amount_paid), 0)
           FROM transactions t
           JOIN loans l ON t.loan_id = l.id
           WHERE l.client_id = c.id
             AND t.payment_status = 'completed' ${txnPeriod}) AS total_paid
      FROM clients c
      WHERE (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id ${loanPeriod}) > 0${tc.clause}
      ORDER BY ${orderBy} DESC
      LIMIT $1`,
      [safeLimit, ...p.periodParams, ...tc.params],
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
    const p = parsePeriod(req);
    const tc = tenantClause(req, p.off, "c.tenant_id");
    // Period scopes loan rows in the LEFT JOIN; client rows still
    // appear even if they had no loans in the window.
    const loanJoinPeriod = p.hasPeriod
      ? ` AND l.start_date::date BETWEEN $1 AND $2`
      : "";
    const result = await query(
      `
      SELECT
        COALESCE(c.county, 'Unknown') AS county,
        COUNT(DISTINCT c.id) AS client_count,
        COUNT(DISTINCT l.id) AS loan_count,
        COALESCE(SUM(l.principal_amount), 0) AS total_disbursed
      FROM clients c
      LEFT JOIN loans l ON c.id = l.client_id${loanJoinPeriod}
      WHERE 1=1${tc.clause}
      GROUP BY c.county
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY client_count DESC
      LIMIT 15
    `,
      [...p.periodParams, ...tc.params],
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
    const p = parsePeriod(req);
    const t = tenantClause(req, p.off);
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
      WHERE 1=1${p.loanDisb("start_date")}${t.clause}
      GROUP BY range, sort_order
      ORDER BY sort_order
    `,
      [...p.periodParams, ...t.params],
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
    const p = parsePeriod(req);
    const t = tenantClause(req, p.off, "l.tenant_id");
    const seriesStart = p.hasPeriod
      ? `DATE_TRUNC('${p.trunc}', $1::date)`
      : `DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')`;
    const seriesEnd = p.hasPeriod
      ? `DATE_TRUNC('${p.trunc}', $2::date)`
      : `DATE_TRUNC('month', CURRENT_DATE)`;
    const result = await query(
      `
      WITH buckets AS (
        SELECT generate_series(${seriesStart}, ${seriesEnd}, '1 ${p.trunc}'::interval) AS bucket
      )
      SELECT
        TO_CHAR(b.bucket, '${p.labelFmt}') AS label,
        COUNT(CASE
          WHEN DATE_TRUNC('${p.trunc}', l.start_date) <= b.bucket
           AND l.status IN ('active', 'completed', 'defaulted')
          THEN l.id END) AS total_loans,
        COUNT(CASE
          WHEN DATE_TRUNC('${p.trunc}', l.start_date) <= b.bucket
           AND l.status = 'defaulted'
          THEN l.id END) AS defaulted_loans
      FROM buckets b
      LEFT JOIN loans l ON DATE_TRUNC('${p.trunc}', l.start_date) <= b.bucket${t.clause}
      GROUP BY b.bucket
      ORDER BY b.bucket ASC
    `,
      [...p.periodParams, ...t.params],
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
    const p = parsePeriod(req);
    const t = tenantClause(req, p.off);
    const result = await query(
      `
      SELECT payment_method,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount_paid), 0) AS total_amount
      FROM transactions
      WHERE payment_status = 'completed'${p.txn()}${t.clause}
      GROUP BY payment_method
      ORDER BY count DESC
    `,
      [...p.periodParams, ...t.params],
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
    //
    // Period-scoped KPIs:
    //   Snapshot KPIs (active_*, total_defaulted, overdue_*, avg_*)
    //   freeze on loans whose start_date ≤ to with their CURRENT status.
    //   The "_30d" tiles are reused for the period window — labels on
    //   the frontend now read "this period" instead of "30 days".
    const p = parsePeriod(req);
    const k = tenantClause(req, p.off);
    const c = k.clause;
    // Snapshot-up-to-end clauses
    // Snapshot "by end of period" uses disbursed_at — the date the
    // cash actually left the lender. Using start_date here was wrong
    // because start_date defaults to disbursed_at + 1 month (first
    // installment date), so a loan disbursed 29 May would be excluded
    // from a May snapshot even though it's already on the books.
    const dispBy = p.hasPeriod ? ` AND disbursed_at::date <= $2` : "";
    const createdBy = p.hasPeriod ? ` AND created_at::date <= $2` : "";
    // Activity-within clauses — "new loans in period" / "disbursements
    // in period" also key off disbursed_at for the same reason.
    const startWithin = p.hasPeriod
      ? ` AND disbursed_at::date BETWEEN $1 AND $2`
      : ` AND disbursed_at >= CURRENT_DATE - INTERVAL '30 days'`;
    const payWithin = p.hasPeriod
      ? ` AND payment_date::date BETWEEN $1 AND $2`
      : ` AND payment_date >= CURRENT_DATE - INTERVAL '30 days'`;
    const createdWithin = p.hasPeriod
      ? ` AND created_at::date BETWEEN $1 AND $2`
      : ` AND created_at >= CURRENT_DATE - INTERVAL '30 days'`;

    const kpis = await query(
      `
      SELECT
        (SELECT COUNT(*) FROM clients WHERE status = 'active'${createdBy}${c}) AS active_clients,
        (SELECT COUNT(*) FROM loans WHERE status = 'active'${dispBy}${c}) AS active_loans,
        (SELECT COALESCE(SUM(total_amount_due), 0) FROM loans WHERE status = 'active'${dispBy}${c}) AS active_portfolio,

        (SELECT COALESCE(SUM(amount_paid), 0) FROM transactions
          WHERE payment_status = 'completed'${payWithin}${c}) AS collections_30d,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans
          WHERE 1=1${startWithin}${c}) AS disbursements_30d,

        (SELECT COUNT(*) FROM loans WHERE status = 'defaulted'${dispBy}${c}) AS total_defaulted,
        (SELECT COUNT(*) FROM payment_schedules WHERE status = 'overdue'${c}) AS overdue_count,
        (SELECT COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0)
          FROM payment_schedules WHERE status = 'overdue'${c}) AS total_overdue_amount,

        (SELECT COUNT(*) FROM clients WHERE 1=1${createdWithin}${c}) AS new_clients_30d,
        (SELECT COUNT(*) FROM loans WHERE 1=1${startWithin}${c}) AS new_loans_30d,

        (SELECT COALESCE(AVG(principal_amount), 0) FROM loans WHERE status = 'active'${dispBy}${c}) AS avg_loan_size,
        (SELECT COALESCE(AVG(interest_rate * 12), 0) FROM loans WHERE status = 'active'${dispBy}${c}) AS avg_interest_rate
    `,
      [...p.periodParams, ...k.params],
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
      snapshot,
      collectionTrend,
      disbursementTrend,
      aging,
      officers,
      statusDist,
      expenseStats,
      cashFlow,
    ] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid, from, to),
      analyticsService.getPortfolioAtRisk(tid),
      analyticsService.getOverdueDefaultedSnapshot(tid),
      analyticsService.getCollectionTrend(tid, months, from, to),
      analyticsService.getDisbursementTrend(tid, months, from, to),
      analyticsService.getAgingAnalysis(tid),
      analyticsService.getLoanOfficerPerformance(tid),
      analyticsService.getLoanStatusDistribution(tid),
      analyticsService.getExpenseStats(tid, from, to),
      analyticsService.getIncomeVsExpensesTrend(tid, months),
    ]);

    res.json({
      success: true,
      data: {
        kpis,
        par,
        snapshot,
        collectionTrend,
        disbursementTrend,
        aging,
        officers,
        statusDist,
        expenseStats,
        cashFlow,
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

// Platform report (PDF) — overview KPIs + tenant leaderboard. Platform-admin
// only; mirrors the tenant /export/pdf pattern but with platform-wide data.
router.get("/platform/export/pdf", async (req, res) => {
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

    const fmtKES = (n) =>
      "KES " +
      parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
    const filename = `platform-report-${new Date().toISOString().split("T")[0]}.pdf`;
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(20).fillColor("#0086cc").text("LoanFix Platform Report", {
      align: "center",
    });
    doc
      .fontSize(10)
      .fillColor("#999")
      .text(`Generated: ${new Date().toLocaleString("en-KE")}`, {
        align: "center",
      });
    doc.moveDown(2);

    doc.fontSize(14).fillColor("#000").text("Platform Overview", {
      underline: true,
    });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");
    doc.text(`Total Tenants: ${kpis.tenants.total_tenants}`);
    doc.text(`Active Tenants: ${kpis.tenants.active_tenants}`);
    doc.text(`Suspended Tenants: ${kpis.tenants.suspended_tenants}`);
    doc.text(`New This Month: ${kpis.tenants.new_this_month}`);
    doc.text(`Total Revenue (fees): ${fmtKES(kpis.revenue.total_revenue)}`);
    doc.text(`Outstanding (unpaid invoices): ${fmtKES(kpis.revenue.outstanding)}`);
    doc.text(`Platform Loans: ${kpis.platform_loans.total_loans}`);
    doc.text(`Total Disbursed: ${fmtKES(kpis.platform_loans.total_disbursed)}`);
    doc.moveDown(1.5);

    doc.fontSize(14).fillColor("#000").text(
      "Tenant Leaderboard (by disbursement)",
      { underline: true },
    );
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#333");
    if (leaderboard.length === 0) {
      doc.text("No tenant activity yet.");
    } else {
      leaderboard.forEach((t, i) => {
        doc.text(
          `${i + 1}. ${t.business_name} — ${t.loans} loans · ${fmtKES(
            t.disbursed,
          )} disbursed · ${fmtKES(t.fees_paid)} fees`,
        );
      });
    }

    doc.end();
  } catch (error) {
    logger.error("Platform PDF export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate report" });
    }
  }
});

// Platform report (Excel) — Summary + Leaderboard + Revenue trend sheets.
router.get("/platform/export/excel", async (req, res) => {
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

    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Summary");
    s.columns = [{ width: 32 }, { width: 22 }];
    s.addRow(["LoanFix Platform Report", ""]);
    s.addRow(["Generated", new Date().toLocaleString("en-KE")]);
    s.addRow([]);
    s.addRow(["Metric", "Value"]);
    s.addRow(["Total Tenants", kpis.tenants.total_tenants]);
    s.addRow(["Active Tenants", kpis.tenants.active_tenants]);
    s.addRow(["Suspended Tenants", kpis.tenants.suspended_tenants]);
    s.addRow(["New This Month", kpis.tenants.new_this_month]);
    s.addRow(["Total Revenue (KES)", kpis.revenue.total_revenue]);
    s.addRow(["Outstanding (KES)", kpis.revenue.outstanding]);
    s.addRow(["Platform Loans", kpis.platform_loans.total_loans]);
    s.addRow(["Total Disbursed (KES)", kpis.platform_loans.total_disbursed]);
    s.getRow(1).font = { bold: true, size: 14 };
    s.getRow(4).font = { bold: true };

    const lb = wb.addWorksheet("Leaderboard");
    lb.columns = [
      { header: "#", key: "rank", width: 6 },
      { header: "Tenant", key: "name", width: 28 },
      { header: "Status", key: "status", width: 12 },
      { header: "Loans", key: "loans", width: 10 },
      { header: "Disbursed (KES)", key: "disbursed", width: 18 },
      { header: "Fees Paid (KES)", key: "fees", width: 18 },
    ];
    lb.getRow(1).font = { bold: true };
    leaderboard.forEach((t, i) =>
      lb.addRow({
        rank: i + 1,
        name: t.business_name,
        status: t.status,
        loans: t.loans,
        disbursed: t.disbursed,
        fees: t.fees_paid,
      }),
    );

    const rev = wb.addWorksheet("Revenue Trend");
    rev.columns = [
      { header: "Month", key: "month", width: 16 },
      { header: "Revenue (KES)", key: "revenue", width: 18 },
    ];
    rev.getRow(1).font = { bold: true };
    revenueTrend.forEach((r) =>
      rev.addRow({ month: r.month, revenue: r.revenue }),
    );

    const filename = `platform-report-${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Platform Excel export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate report" });
    }
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

    const { from, to } = req.query;
    const months = Math.min(
      Math.max(parseInt(req.query.months, 10) || 6, 1),
      24,
    );
    const periodLabel = buildPeriodLabel({ from, to, months });
    const isMonthMode = Boolean(from && to);

    // Snapshot sections (PAR / Aging) only make sense in "recent months"
    // mode — they describe today's state, not a historical month.
    // expenseStats is fetched in every mode so the Expenses / Net
    // Profit lines below match what the on-screen Reports page shows.
    const [kpis, par, aging, expenseStats] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid, from, to),
      isMonthMode ? null : analyticsService.getPortfolioAtRisk(tid),
      isMonthMode ? null : analyticsService.getAgingAnalysis(tid),
      analyticsService.getExpenseStats(tid, from, to),
    ]);

    // Income = interest + fines + processing fees (cash only — these
    // counters only tick when cash actually comes in). Net Profit =
    // income − expenses − principal_written_off. The cash-flow lens:
    // a waiver's income share is already absent from interest_earned
    // and fines_collected (the borrower paid less cash, those tiles
    // ticked less), so re-subtracting it as "waivers_applied" would
    // double-count the loss. The only real economic loss not already
    // reflected in lower cash income is the principal share of
    // amount_due waivers — that's principal_written_off_by_ratio.
    // See capital.js for the worked example. waivers_applied is
    // still surfaced on the report for transparency but doesn't move
    // the bottom line a second time.
    const interestEarned = parseFloat(kpis.interest_earned) || 0;
    const finesCollected = parseFloat(kpis.fines_collected) || 0;
    const processingFees = parseFloat(kpis.processing_fees) || 0;
    const waiversWindow = parseFloat(kpis.waivers_applied) || 0;
    const waiversInterest = parseFloat(kpis.waivers_interest) || 0;
    const waiversPenalty = parseFloat(kpis.waivers_penalty) || 0;
    const waiversPrincipal = parseFloat(kpis.waivers_principal) || 0;
    const principalWrittenOff =
      parseFloat(kpis.principal_written_off_by_ratio) || 0;
    const incomeWindow = interestEarned + finesCollected + processingFees;
    const expensesWindow = parseFloat(expenseStats?.total_in_window || 0);
    const netProfit = incomeWindow - expensesWindow - principalWrittenOff;

    const tr = await query(
      "SELECT business_name FROM tenants WHERE id = $1",
      [tid],
    );
    const businessName = tr.rows[0]?.business_name || "Portfolio Report";

    const periodSlug = isMonthMode
      ? `${from}_to_${to}`
      : `last-${months}-months`;
    const filename = `portfolio-report-${periodSlug}.pdf`;
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
    doc.fontSize(11).fillColor("#444").text(periodLabel, { align: "center" });
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
    doc.text(`Interest from Loans: ${fmtKES(interestEarned)}`);
    doc.text(`Fines Collected: ${fmtKES(finesCollected)}`);
    doc.text(`Processing Fees: ${fmtKES(processingFees)}`);
    doc.text(`Income (interest + fines + fees): ${fmtKES(incomeWindow)}`);
    doc.text(`Expenses: ${fmtKES(expensesWindow)}`);
    doc.text(`Waivers Applied: ${fmtKES(waiversWindow)}`);
    if (waiversInterest > 0)
      doc.text(`  ↳ Interest waived: ${fmtKES(waiversInterest)}`);
    if (waiversPenalty > 0)
      doc.text(`  ↳ Penalty waived: ${fmtKES(waiversPenalty)}`);
    if (waiversPrincipal > 0)
      doc.text(`  ↳ Principal waived (historical): ${fmtKES(waiversPrincipal)}`);
    doc.text(
      `Net Profit (income − expenses − waivers): ${netProfit >= 0 ? "+" : ""}${fmtKES(netProfit)}`,
    );
    doc.text(`Average Loan Size: ${fmtKES(kpis.avg_loan_size)}`);
    doc.moveDown(1.5);

    if (!isMonthMode && par) {
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
      if (!aging || aging.length === 0) {
        doc.fillColor("#999").text("No outstanding payments.");
      } else {
        aging.forEach((a) => {
          doc.fillColor("#333").text(
            `${a.bucket}: ${a.count} payments — ${fmtKES(a.amount)}`,
          );
        });
      }
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

    const { from, to } = req.query;
    const months = Math.min(
      Math.max(parseInt(req.query.months, 10) || 6, 1),
      24,
    );
    const periodLabel = buildPeriodLabel({ from, to, months });
    const isMonthMode = Boolean(from && to);

    const [kpis, par, aging, expenseStats] = await Promise.all([
      analyticsService.getTenantPortfolioKPIs(tid, from, to),
      isMonthMode ? null : analyticsService.getPortfolioAtRisk(tid),
      isMonthMode ? null : analyticsService.getAgingAnalysis(tid),
      analyticsService.getExpenseStats(tid, from, to),
    ]);

    // Same income / net-profit derivations as the PDF export and the
    // on-screen Reports page — cash-flow lens, see capital.js for why
    // we subtract principal_written_off rather than waivers_applied.
    const interestEarned = parseFloat(kpis.interest_earned) || 0;
    const finesCollected = parseFloat(kpis.fines_collected) || 0;
    const processingFees = parseFloat(kpis.processing_fees) || 0;
    const waiversWindow = parseFloat(kpis.waivers_applied) || 0;
    const waiversInterest = parseFloat(kpis.waivers_interest) || 0;
    const waiversPenalty = parseFloat(kpis.waivers_penalty) || 0;
    const waiversPrincipal = parseFloat(kpis.waivers_principal) || 0;
    const principalWrittenOff =
      parseFloat(kpis.principal_written_off_by_ratio) || 0;
    const incomeWindow = interestEarned + finesCollected + processingFees;
    const expensesWindow = parseFloat(expenseStats?.total_in_window || 0);
    const netProfit = incomeWindow - expensesWindow - principalWrittenOff;

    // Loans detail. In month mode, restrict to loans disbursed within
    // the window so the sheet reflects ONLY the selected period.
    const loanFilters = isMonthMode
      ? `AND l.status IN ('active','completed','defaulted')
         AND l.disbursed_at IS NOT NULL
         AND l.disbursed_at::date >= $2::date
         AND l.disbursed_at::date <= $3::date`
      : "";
    const loans = await query(
      `SELECT
         l.loan_code,
         c.first_name || ' ' || c.last_name      AS client,
         l.disbursed_at,
         l.principal_amount,
         l.total_interest,
         l.total_amount_due,
         l.status,
         l.start_date,
         l.overpayment_amount,
         l.refund_status,
         COALESCE(p.paid, 0)                     AS paid,
         COALESCE(p.fines_paid, 0)               AS fines_paid
       FROM loans l
       JOIN clients c ON l.client_id = c.id
       LEFT JOIN (
         SELECT loan_id,
                SUM(amount_paid) AS paid,
                SUM(COALESCE(penalty_portion, 0)) AS fines_paid
         FROM transactions WHERE payment_status='completed'
         GROUP BY loan_id
       ) p ON p.loan_id = l.id
       WHERE l.tenant_id = $1
         ${loanFilters}
       ORDER BY l.start_date DESC NULLS LAST`,
      isMonthMode ? [tid, from, to] : [tid],
    );

    const workbook = new ExcelJS.Workbook();

    // ── Summary sheet ──
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [{ width: 32 }, { width: 22 }];
    summary.addRow(["Portfolio Report", ""]);
    summary.addRow(["Period", periodLabel]);
    summary.addRow(["Generated", new Date().toLocaleString("en-KE")]);
    summary.addRow([]);
    summary.addRow(["KPI", "Value"]);
    summary.addRow(["Total Loans", kpis.total_loans]);
    summary.addRow(["Active Loans", kpis.active_loans]);
    summary.addRow(["Completed Loans", kpis.completed_loans]);
    summary.addRow(["Unique Borrowers", kpis.unique_borrowers]);
    summary.addRow(["Total Disbursed (KES)", kpis.total_disbursed]);
    summary.addRow(["Total Collected (KES)", kpis.total_collected]);
    summary.addRow(["Interest from Loans (KES)", interestEarned]);
    summary.addRow(["Fines Collected (KES)", finesCollected]);
    summary.addRow(["Processing Fees (KES)", processingFees]);
    summary.addRow(["Income — interest + fines + fees (KES)", incomeWindow]);
    summary.addRow(["Expenses (KES)", expensesWindow]);
    summary.addRow(["Waivers Applied (KES)", waiversWindow]);
    if (waiversInterest > 0)
      summary.addRow(["  Waivers — Interest (KES)", waiversInterest]);
    if (waiversPenalty > 0)
      summary.addRow(["  Waivers — Penalty (KES)", waiversPenalty]);
    if (waiversPrincipal > 0)
      summary.addRow([
        "  Waivers — Principal (historical) (KES)",
        waiversPrincipal,
      ]);
    summary.addRow(["Net Profit — income − expenses − waivers (KES)", netProfit]);
    summary.addRow(["Average Loan Size (KES)", kpis.avg_loan_size]);
    if (!isMonthMode && par) {
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
      (aging || []).forEach((a) => summary.addRow([a.bucket, a.amount]));
    }
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.getRow(5).font = { bold: true };

    // ── Loans detail — mirrors the on-screen Loans table columns
    // (Loan Code · Client · Disbursed · Principal · Interest · Total
    // to Pay · Paid · Fines · Balance · Refund Due · Status). Values
    // are written as numbers so users can still pivot / sum.
    const loansSheet = workbook.addWorksheet("Loans");
    loansSheet.columns = [
      { header: "Loan Code", key: "loan_code", width: 16 },
      { header: "Client", key: "client", width: 26 },
      { header: "Disbursed", key: "disbursed_at", width: 14 },
      { header: "Principal", key: "principal_amount", width: 14 },
      { header: "Interest", key: "total_interest", width: 14 },
      { header: "Total to Pay", key: "total_amount_due", width: 15 },
      { header: "Paid", key: "paid", width: 14 },
      { header: "Fines", key: "fines_paid", width: 14 },
      { header: "Balance", key: "balance", width: 14 },
      { header: "Refund Due", key: "refund_due", width: 16 },
      { header: "Status", key: "status", width: 12 },
    ];
    loansSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    loansSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };
    loans.rows.forEach((l) => {
      const principal = parseFloat(l.principal_amount) || 0;
      const interest = parseFloat(l.total_interest) || 0;
      const totalDue = parseFloat(l.total_amount_due) || 0;
      const paid = parseFloat(l.paid) || 0;
      const finesPaid = parseFloat(l.fines_paid) || 0;
      const overpayment = parseFloat(l.overpayment_amount) || 0;
      const refundDue =
        overpayment > 0
          ? `${overpayment.toFixed(2)} (${l.refund_status === "refunded" ? "refunded" : "pending"})`
          : "";
      loansSheet.addRow({
        loan_code: l.loan_code,
        client: l.client,
        disbursed_at: l.disbursed_at
          ? new Date(l.disbursed_at).toLocaleDateString("en-KE")
          : "",
        principal_amount: principal,
        total_interest: interest,
        total_amount_due: totalDue,
        paid,
        fines_paid: finesPaid,
        balance: Math.max(totalDue - paid, 0),
        refund_due: refundDue,
        status: l.status,
      });
    });

    const periodSlug = isMonthMode
      ? `${from}_to_${to}`
      : `last-${months}-months`;
    const filename = `portfolio-report-${periodSlug}.xlsx`;
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
