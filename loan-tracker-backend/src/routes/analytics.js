import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
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
    const result = await query(`
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
        GROUP BY 1
      ),
      coll AS (
        SELECT DATE_TRUNC('month', payment_date) AS m,
               SUM(amount_paid) AS collected,
               COUNT(*) AS txns
        FROM transactions
        WHERE payment_status = 'completed'
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
    `);
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
    const result = await query(`
      SELECT status,
             COUNT(*)::int AS count,
             COALESCE(SUM(principal_amount), 0) AS total_value
      FROM loans
      GROUP BY status
      ORDER BY count DESC
    `);
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
      WHERE (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id) > 0
      ORDER BY ${orderBy} DESC
      LIMIT $1`,
      [safeLimit],
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
    const result = await query(`
      SELECT
        COALESCE(c.county, 'Unknown') AS county,
        COUNT(DISTINCT c.id) AS client_count,
        COUNT(DISTINCT l.id) AS loan_count,
        COALESCE(SUM(l.principal_amount), 0) AS total_disbursed
      FROM clients c
      LEFT JOIN loans l ON c.id = l.client_id
      GROUP BY c.county
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY client_count DESC
      LIMIT 15
    `);
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
    const result = await query(`
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
      GROUP BY range, sort_order
      ORDER BY sort_order
    `);
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
    const result = await query(`
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
      LEFT JOIN loans l ON DATE_TRUNC('month', l.start_date) <= m.month
      GROUP BY m.month
      ORDER BY m.month ASC
    `);
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
    const result = await query(`
      SELECT payment_method,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount_paid), 0) AS total_amount
      FROM transactions
      WHERE payment_status = 'completed'
      GROUP BY payment_method
      ORDER BY count DESC
    `);
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
    const kpis = await query(`
      SELECT
        (SELECT COUNT(*) FROM clients WHERE status = 'active') AS active_clients,
        (SELECT COUNT(*) FROM loans WHERE status = 'active') AS active_loans,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans WHERE status = 'active') AS active_portfolio,

        (SELECT COALESCE(SUM(amount_paid), 0) FROM transactions
          WHERE payment_status = 'completed'
            AND payment_date >= CURRENT_DATE - INTERVAL '30 days') AS collections_30d,
        (SELECT COALESCE(SUM(principal_amount), 0) FROM loans
          WHERE start_date >= CURRENT_DATE - INTERVAL '30 days') AS disbursements_30d,

        (SELECT COUNT(*) FROM loans WHERE status = 'defaulted') AS total_defaulted,
        (SELECT COUNT(*) FROM payment_schedules WHERE status = 'overdue') AS overdue_count,
        (SELECT COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0)
          FROM payment_schedules WHERE status = 'overdue') AS total_overdue_amount,

        (SELECT COUNT(*) FROM clients WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') AS new_clients_30d,
        (SELECT COUNT(*) FROM loans WHERE start_date >= CURRENT_DATE - INTERVAL '30 days') AS new_loans_30d,

        (SELECT COALESCE(AVG(principal_amount), 0) FROM loans WHERE status = 'active') AS avg_loan_size,
        (SELECT COALESCE(AVG(interest_rate * 12), 0) FROM loans WHERE status = 'active') AS avg_interest_rate
    `);
    res.json({ success: true, data: kpis.rows[0] });
  } catch (error) {
    logger.error("KPIs error:", error);
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

export default router;
