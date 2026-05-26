import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET DASHBOARD SUMMARY
// ============================================================
router.get("/summary", async (req, res) => {
  try {
    // Tenant scoping: ts for plain tenant_id tables, tsL for joins
    // aliased on loans (l). Empty clause for platform admins.
    const ts = tenantClause(req, 0);
    const tsL = tenantClause(req, 0, "l.tenant_id");

    // Get all loans aggregates — DISBURSED only (active/completed/defaulted);
    // applications still in the queue don't count as portfolio or money out.
    const loansStats = await query(
      `
      SELECT
        COUNT(*) as total_loans,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_loans,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_loans,
        COUNT(CASE WHEN status = 'defaulted' THEN 1 END) as defaulted_loans,
        COALESCE(SUM(principal_amount), 0) as total_principal,
        COALESCE(SUM(total_amount_due), 0) as total_amount_due,
        COALESCE(SUM(total_interest), 0) as total_interest,
        COALESCE(SUM(CASE WHEN refund_status = 'pending' THEN overpayment_amount ELSE 0 END), 0) as total_overpayment,
        COUNT(CASE WHEN refund_status = 'pending' THEN 1 END) as pending_refunds
      FROM loans
      WHERE status IN ('active', 'completed', 'defaulted')${ts.clause}
    `,
      ts.params,
    );

    // Get total collected (sum of all payments)
    const paymentsStats = await query(
      `
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount_paid), 0) as total_collected
      FROM transactions
      WHERE payment_status = 'completed'${ts.clause}
    `,
      ts.params,
    );

    // Get clients count
    const clientsStats = await query(
      `
      SELECT
        COUNT(*) as total_clients,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_clients
      FROM clients
      WHERE 1=1${ts.clause}
    `,
      ts.params,
    );

    // Get overdue payments (covers both freshly past-due 'pending'
    // installments and those already promoted to 'overdue')
    const overdueStats = await query(
      `
      SELECT
        COUNT(*) as overdue_count,
        COUNT(DISTINCT ps.loan_id) as overdue_loans,
        COUNT(DISTINCT l.client_id) as overdue_clients,
        COALESCE(SUM(ps.amount_due - COALESCE(ps.amount_paid, 0)), 0) as overdue_amount
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      WHERE (
              ps.status = 'overdue'
              OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE)
            )
        AND ps.amount_due > COALESCE(ps.amount_paid, 0)${tsL.clause}
    `,
      tsL.params,
    );

    // Top 5 most overdue payments with client info
    const mostOverdue = await query(
      `
      SELECT
        ps.id,
        ps.loan_id,
        ps.payment_number,
        ps.due_date,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) AS amount_outstanding,
        (CURRENT_DATE - ps.due_date::date) AS days_late,
        l.loan_code,
        c.first_name,
        c.last_name,
        c.phone_number
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE (
              ps.status = 'overdue'
              OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE)
            )
        AND ps.amount_due > COALESCE(ps.amount_paid, 0)${tsL.clause}
      ORDER BY days_late DESC
      LIMIT 5
    `,
      tsL.params,
    );

    // Get upcoming payments (next 7 days)
    const upcomingStats = await query(
      `
      SELECT
        COUNT(*) as upcoming_count,
        COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0) as upcoming_amount
      FROM payment_schedules
      WHERE status = 'pending'
        AND due_date >= CURRENT_DATE
        AND due_date <= CURRENT_DATE + INTERVAL '7 days'${ts.clause}
    `,
      ts.params,
    );

    // ── Distribution data for the dashboard charts ───────────────
    // Loan-size histogram. Counts/sums cast to numbers (::int / ::float)
    // so they arrive as numbers, not strings (avoids the empty-chart bug).
    // Buckets are labelled here but re-ordered on the client (don't rely
    // on SQL ordering — the labels would sort alphabetically).
    const sizeBuckets = await query(
      `
      SELECT
        CASE
          WHEN principal_amount < 10000  THEN '<10K'
          WHEN principal_amount < 25000  THEN '10–25K'
          WHEN principal_amount < 50000  THEN '25–50K'
          WHEN principal_amount < 100000 THEN '50–100K'
          WHEN principal_amount < 250000 THEN '100–250K'
          ELSE '250K+'
        END AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM(principal_amount), 0)::float AS total
      FROM loans
      WHERE status IN ('active', 'completed', 'defaulted')${ts.clause}
      GROUP BY bucket
    `,
      ts.params,
    );

    // Payment-method split (completed transactions only) for the donut.
    const methodSplit = await query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(payment_method), ''), 'Other') AS method,
        COUNT(*)::int AS count,
        COALESCE(SUM(amount_paid), 0)::float AS total
      FROM transactions
      WHERE payment_status = 'completed'${ts.clause}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
      ts.params,
    );

    // Loan distribution by borrower age × status. Age comes from the
    // client's date_of_birth (migration 018); rows without a DOB are
    // ignored. Buckets are re-ordered on the client. Counts cast ::int.
    const ageDistribution = await query(
      `
      SELECT
        CASE
          WHEN age < 25 THEN '18–24'
          WHEN age < 35 THEN '25–34'
          WHEN age < 45 THEN '35–44'
          WHEN age < 55 THEN '45–54'
          ELSE '55+'
        END AS bucket,
        COUNT(*) FILTER (WHERE status = 'active')::int    AS active,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'defaulted')::int AS defaulted
      FROM (
        SELECT l.status,
               EXTRACT(YEAR FROM AGE(c.date_of_birth))::int AS age
        FROM loans l
        JOIN clients c ON l.client_id = c.id
        WHERE c.date_of_birth IS NOT NULL
          AND l.status IN ('active', 'completed', 'defaulted')${tsL.clause}
      ) sub
      GROUP BY bucket
    `,
      tsL.params,
    );

    const loansData = loansStats.rows[0];
    const paymentsData = paymentsStats.rows[0];
    const clientsData = clientsStats.rows[0];
    const overdueData = overdueStats.rows[0];
    const upcomingData = upcomingStats.rows[0];

    const totalDue = parseFloat(loansData.total_amount_due);
    const totalCollected = parseFloat(paymentsData.total_collected);
    const outstanding = Math.max(0, totalDue - totalCollected);
    const collectionRate =
      totalDue > 0 ? ((totalCollected / totalDue) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        // Loan metrics
        total_loans: parseInt(loansData.total_loans),
        active_loans: parseInt(loansData.active_loans),
        completed_loans: parseInt(loansData.completed_loans),
        defaulted_loans: parseInt(loansData.defaulted_loans),

        // Money metrics
        total_principal: parseFloat(loansData.total_principal),
        total_amount_due: totalDue,
        total_interest: parseFloat(loansData.total_interest),
        total_collected: totalCollected,
        outstanding_balance: outstanding,
        collection_rate: parseFloat(collectionRate),

        // Client metrics
        total_clients: parseInt(clientsData.total_clients),
        active_clients: parseInt(clientsData.active_clients),

        // Transactions
        total_transactions: parseInt(paymentsData.total_transactions),

        // Alerts
        overdue_count: parseInt(overdueData.overdue_count),
        overdue_loans: parseInt(overdueData.overdue_loans),
        overdue_clients_count: parseInt(overdueData.overdue_clients),
        overdue_amount: parseFloat(overdueData.overdue_amount),
        most_overdue: mostOverdue.rows,
        upcoming_count: parseInt(upcomingData.upcoming_count),
        upcoming_amount: parseFloat(upcomingData.upcoming_amount),
        pending_refunds: parseInt(loansData.pending_refunds),
        total_overpayment: parseFloat(loansData.total_overpayment),

        // Distribution data for the dashboard charts
        loan_size_buckets: sizeBuckets.rows,
        payment_method_split: methodSplit.rows,
        loan_age_distribution: ageDistribution.rows,
      },
    });
  } catch (error) {
    logger.error("Dashboard summary error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// ============================================================
// GET RECENT ACTIVITIES
// ============================================================
router.get("/recent-activities", async (req, res) => {
  try {
    const tsL = tenantClause(req, 0, "l.tenant_id");
    const tsT = tenantClause(req, 0, "t.tenant_id");

    // Recent loans (last 5)
    const recentLoans = await query(
      `
      SELECT
        l.id, l.loan_code, l.principal_amount, l.status, l.created_at,
        c.first_name, c.last_name, c.phone_number
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE 1=1${tsL.clause}
      ORDER BY l.created_at DESC
      LIMIT 5
    `,
      tsL.params,
    );

    // Recent payments (last 5)
    const recentPayments = await query(
      `
      SELECT
        t.id, t.transaction_code, t.amount_paid, t.payment_date, t.payment_method,
        c.first_name, c.last_name,
        l.loan_code
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE t.payment_status = 'completed'${tsT.clause}
      ORDER BY t.payment_date DESC, t.created_at DESC
      LIMIT 5
    `,
      tsT.params,
    );

    res.json({
      success: true,
      data: {
        recent_loans: recentLoans.rows,
        recent_payments: recentPayments.rows,
      },
    });
  } catch (error) {
    logger.error("Recent activities error:", error);
    res.status(500).json({ error: "Failed to fetch recent activities" });
  }
});

// ============================================================
// GET MONTHLY TRENDS (last 6 months)
// ============================================================
router.get("/monthly-trends", async (req, res) => {
  try {
    const ts = tenantClause(req, 0);

    // Loans by month — DISBURSED only, bucketed by disbursement date (not
    // application date). Applications that never made it out the door
    // aren't part of the lending portfolio.
    const loansTrend = await query(
      `
      SELECT
        TO_CHAR(disbursed_at, 'YYYY-MM') as month,
        TO_CHAR(disbursed_at, 'Mon YYYY') as month_label,
        COUNT(*) as count,
        COALESCE(SUM(principal_amount), 0) as total_amount
      FROM loans
      WHERE status IN ('active', 'completed', 'defaulted')
        AND disbursed_at IS NOT NULL
        AND disbursed_at >= CURRENT_DATE - INTERVAL '6 months'${ts.clause}
      GROUP BY TO_CHAR(disbursed_at, 'YYYY-MM'), TO_CHAR(disbursed_at, 'Mon YYYY')
      ORDER BY month ASC
    `,
      ts.params,
    );

    // Payments by month
    const paymentsTrend = await query(
      `
      SELECT
        TO_CHAR(payment_date, 'YYYY-MM') as month,
        TO_CHAR(payment_date, 'Mon YYYY') as month_label,
        COUNT(*) as count,
        COALESCE(SUM(amount_paid), 0) as total_amount
      FROM transactions
      WHERE payment_status = 'completed'
        AND payment_date >= CURRENT_DATE - INTERVAL '6 months'${ts.clause}
      GROUP BY TO_CHAR(payment_date, 'YYYY-MM'), TO_CHAR(payment_date, 'Mon YYYY')
      ORDER BY month ASC
    `,
      ts.params,
    );

    res.json({
      success: true,
      data: {
        loans_trend: loansTrend.rows,
        payments_trend: paymentsTrend.rows,
      },
    });
  } catch (error) {
    logger.error("Monthly trends error:", error);
    res.status(500).json({ error: "Failed to fetch monthly trends" });
  }
});

export default router;
