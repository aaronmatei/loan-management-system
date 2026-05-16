import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { runOverdueCheck } from "../utils/overdueChecker.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET ALL OVERDUE PAYMENTS (with client + loan info)
//   Optional filter: ?min_days=7  -> only 7+ days overdue
// ============================================================
router.get("/", async (req, res) => {
  try {
    const minDays = parseInt(req.query.min_days, 10) || 0;

    const params = [];
    let minDaysFilter = "";
    if (minDays > 0) {
      params.push(minDays);
      minDaysFilter = ` AND (CURRENT_DATE - ps.due_date::date) >= $${params.length}`;
    }

    const result = await query(
      `
      SELECT
        ps.id,
        ps.loan_id,
        ps.payment_number,
        ps.due_date,
        ps.amount_due,
        ps.amount_paid,
        ps.status,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) AS amount_outstanding,
        (CURRENT_DATE - ps.due_date::date) AS days_late,
        (SELECT COUNT(*) FROM payment_schedules ps2 WHERE ps2.loan_id = l.id)
          AS total_payments,
        l.loan_code,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.client_code
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE (
              ps.status = 'overdue'
              OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE)
            )
        AND ps.amount_due > COALESCE(ps.amount_paid, 0)
        ${minDaysFilter}
      ORDER BY days_late DESC
      `,
      params,
    );

    const rows = result.rows;
    const totalAmount = rows.reduce(
      (sum, r) => sum + parseFloat(r.amount_outstanding),
      0,
    );
    const affectedLoans = new Set(rows.map((r) => r.loan_id)).size;
    const averageDays = rows.length
      ? Math.round(
          rows.reduce((sum, r) => sum + parseInt(r.days_late, 10), 0) /
            rows.length,
        )
      : 0;

    res.json({
      success: true,
      data: rows,
      summary: {
        total_overdue: rows.length,
        total_amount: totalAmount,
        affected_loans: affectedLoans,
        average_days_overdue: averageDays,
      },
    });
  } catch (error) {
    logger.error("Get overdue payments error:", error);
    res.status(500).json({ error: "Failed to fetch overdue payments" });
  }
});

// ============================================================
// MANUALLY TRIGGER OVERDUE CHECK (admin only)
// ============================================================
router.post("/check", authorize("admin"), async (req, res) => {
  try {
    const markedCount = await runOverdueCheck();

    logger.info(
      `✓ Manual overdue check by ${req.user?.email}: ${markedCount} marked`,
    );

    res.json({
      success: true,
      message: `Overdue check complete. ${markedCount} payment(s) marked as overdue.`,
      marked_overdue: markedCount,
    });
  } catch (error) {
    logger.error("Manual overdue check error:", error);
    res.status(500).json({ error: "Failed to run overdue check" });
  }
});

export default router;
