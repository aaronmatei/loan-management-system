import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET DASHBOARD SUMMARY
// ============================================================
router.get("/summary", async (req, res) => {
  try {
    // Get all loans aggregates
    const loansStats = await query(`
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
    `);

    // Get total collected (sum of all payments)
    const paymentsStats = await query(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount_paid), 0) as total_collected
      FROM transactions
      WHERE payment_status = 'completed'
    `);

    // Get clients count
    const clientsStats = await query(`
      SELECT 
        COUNT(*) as total_clients,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_clients
      FROM clients
    `);

    // Get overdue payments (covers both freshly past-due 'pending'
    // installments and those already promoted to 'overdue')
    const overdueStats = await query(`
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
        AND ps.amount_due > COALESCE(ps.amount_paid, 0)
    `);

    // Top 5 most overdue payments with client info
    const mostOverdue = await query(`
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
        AND ps.amount_due > COALESCE(ps.amount_paid, 0)
      ORDER BY days_late DESC
      LIMIT 5
    `);

    // Get upcoming payments (next 7 days)
    const upcomingStats = await query(`
      SELECT 
        COUNT(*) as upcoming_count,
        COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0) as upcoming_amount
      FROM payment_schedules
      WHERE status = 'pending' 
        AND due_date >= CURRENT_DATE 
        AND due_date <= CURRENT_DATE + INTERVAL '7 days'
    `);

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
    // Recent loans (last 5)
    const recentLoans = await query(`
      SELECT 
        l.id, l.loan_code, l.principal_amount, l.status, l.created_at,
        c.first_name, c.last_name, c.phone_number
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      ORDER BY l.created_at DESC
      LIMIT 5
    `);

    // Recent payments (last 5)
    const recentPayments = await query(`
      SELECT 
        t.id, t.transaction_code, t.amount_paid, t.payment_date, t.payment_method,
        c.first_name, c.last_name,
        l.loan_code
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      JOIN loans l ON t.loan_id = l.id
      WHERE t.payment_status = 'completed'
      ORDER BY t.payment_date DESC, t.created_at DESC
      LIMIT 5
    `);

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
    // Loans by month
    const loansTrend = await query(`
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        TO_CHAR(created_at, 'Mon YYYY') as month_label,
        COUNT(*) as count,
        COALESCE(SUM(principal_amount), 0) as total_amount
      FROM loans
      WHERE created_at >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM'), TO_CHAR(created_at, 'Mon YYYY')
      ORDER BY month ASC
    `);

    // Payments by month
    const paymentsTrend = await query(`
      SELECT 
        TO_CHAR(payment_date, 'YYYY-MM') as month,
        TO_CHAR(payment_date, 'Mon YYYY') as month_label,
        COUNT(*) as count,
        COALESCE(SUM(amount_paid), 0) as total_amount
      FROM transactions
      WHERE payment_status = 'completed'
        AND payment_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY TO_CHAR(payment_date, 'YYYY-MM'), TO_CHAR(payment_date, 'Mon YYYY')
      ORDER BY month ASC
    `);

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
