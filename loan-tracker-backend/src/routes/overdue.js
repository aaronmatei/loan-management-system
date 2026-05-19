import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { runOverdueCheck } from "../utils/overdueChecker.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// An installment counts as overdue when it is flagged 'overdue', or it is
// still 'pending' but its due date has passed, and money is still owed. We
// exclude schedules on completed loans.
const OVERDUE_WHERE = `
  (
    ps.status = 'overdue'
    OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE)
  )
  AND ps.amount_due > COALESCE(ps.amount_paid, 0)
  AND l.status != 'completed'
`;

// ============================================================
// GET ALL OVERDUE PAYMENTS (with client + loan info)
//   ?min_days   only N+ days late
//   ?max_days   only up to N days late
//   ?search     client name / phone / loan code / client code
//   ?page       page number (default 1)
//   ?limit      items per page (default 10000 for client-side paging)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const minDays = parseInt(req.query.min_days, 10);
    const maxDays = parseInt(req.query.max_days, 10);
    const search = (req.query.search || "").trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10000, 1);
    const offset = (page - 1) * limit;

    // Shared filter clause + params, reused by the data, count and
    // summary queries so every number stays consistent.
    const filterParams = [];
    let filters = "";

    if (Number.isFinite(minDays) && minDays > 0) {
      filterParams.push(minDays);
      filters += ` AND (CURRENT_DATE - ps.due_date::date) >= $${filterParams.length}`;
    }

    if (Number.isFinite(maxDays) && maxDays >= 0) {
      filterParams.push(maxDays);
      filters += ` AND (CURRENT_DATE - ps.due_date::date) <= $${filterParams.length}`;
    }

    if (search) {
      filterParams.push(`%${search}%`);
      const p = `$${filterParams.length}`;
      filters += ` AND (
        c.first_name ILIKE ${p}
        OR c.last_name ILIKE ${p}
        OR (c.first_name || ' ' || c.last_name) ILIKE ${p}
        OR c.phone_number ILIKE ${p}
        OR l.loan_code ILIKE ${p}
        OR c.client_code ILIKE ${p}
      )`;
    }

    // Tenant scope — appended to the shared filter so the data, count
    // and summary queries all stay consistent.
    const ovt = tenantClause(req, filterParams.length, "l.tenant_id");
    if (ovt.clause) {
      filters += ovt.clause;
      filterParams.push(...ovt.params);
    }

    // --- Page of rows -----------------------------------------------------
    const dataParams = [...filterParams, limit, offset];
    const result = await query(
      `
      SELECT
        ps.id AS schedule_id,
        ps.id,
        ps.loan_id,
        ps.payment_number,
        ps.due_date,
        ps.amount_due,
        ps.amount_paid,
        ps.status,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) AS balance_due,
        (ps.amount_due - COALESCE(ps.amount_paid, 0)) AS amount_outstanding,
        (CURRENT_DATE - ps.due_date::date) AS days_late,
        l.loan_code,
        l.principal_amount AS loan_principal,
        l.status AS loan_status,
        l.loan_duration_months AS total_payments_in_loan,
        (SELECT COUNT(*) FROM payment_schedules ps2 WHERE ps2.loan_id = l.id)
          AS total_payments,
        c.id AS client_id,
        c.client_code,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      JOIN clients c ON l.client_id = c.id
      WHERE ${OVERDUE_WHERE}
        ${filters}
      ORDER BY days_late DESC
      LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
      `,
      dataParams,
    );

    // --- Summary over the WHOLE filtered set (not just this page) ---------
    const summaryResult = await query(
      `
      SELECT
        COUNT(*) AS total_overdue_count,
        COALESCE(SUM(bal), 0) AS total_overdue_amount,
        COUNT(DISTINCT loan_id) AS affected_loans_count,
        COUNT(DISTINCT client_id) AS affected_clients_count,
        COUNT(*) FILTER (WHERE d BETWEEN 1 AND 7) AS d1_count,
        COALESCE(SUM(bal) FILTER (WHERE d BETWEEN 1 AND 7), 0) AS d1_amount,
        COUNT(*) FILTER (WHERE d BETWEEN 8 AND 30) AS d8_count,
        COALESCE(SUM(bal) FILTER (WHERE d BETWEEN 8 AND 30), 0) AS d8_amount,
        COUNT(*) FILTER (WHERE d BETWEEN 31 AND 90) AS d31_count,
        COALESCE(SUM(bal) FILTER (WHERE d BETWEEN 31 AND 90), 0) AS d31_amount,
        COUNT(*) FILTER (WHERE d > 90) AS d90_count,
        COALESCE(SUM(bal) FILTER (WHERE d > 90), 0) AS d90_amount
      FROM (
        SELECT
          ps.loan_id,
          c.id AS client_id,
          (ps.amount_due - COALESCE(ps.amount_paid, 0)) AS bal,
          (CURRENT_DATE - ps.due_date::date) AS d
        FROM payment_schedules ps
        JOIN loans l ON ps.loan_id = l.id
        JOIN clients c ON l.client_id = c.id
        WHERE ${OVERDUE_WHERE}
          ${filters}
      ) sub
      `,
      filterParams,
    );

    const s = summaryResult.rows[0];
    const total = parseInt(s.total_overdue_count, 10);

    res.json({
      success: true,
      data: result.rows,
      total,
      page,
      limit,
      summary: {
        total_overdue_count: total,
        total_overdue_amount: parseFloat(s.total_overdue_amount),
        affected_loans_count: parseInt(s.affected_loans_count, 10),
        affected_clients_count: parseInt(s.affected_clients_count, 10),
        severity_breakdown: {
          days_1_to_7: {
            count: parseInt(s.d1_count, 10),
            amount: parseFloat(s.d1_amount),
          },
          days_8_to_30: {
            count: parseInt(s.d8_count, 10),
            amount: parseFloat(s.d8_amount),
          },
          days_31_to_90: {
            count: parseInt(s.d31_count, 10),
            amount: parseFloat(s.d31_amount),
          },
          days_over_90: {
            count: parseInt(s.d90_count, 10),
            amount: parseFloat(s.d90_amount),
          },
        },
        // Kept for backward compatibility with earlier callers
        total_overdue: total,
        total_amount: parseFloat(s.total_overdue_amount),
        affected_loans: parseInt(s.affected_loans_count, 10),
      },
    });
  } catch (error) {
    logger.error("Get overdue payments error:", error);
    res.status(500).json({ error: "Failed to fetch overdue payments" });
  }
});

// ============================================================
// RECALCULATE OVERDUE STATUS
//   Promotes past-due 'pending' installments to 'overdue' and
//   refreshes days_late for everything already overdue.
// ============================================================
router.post("/refresh", async (req, res) => {
  try {
    const updatedCount = await runOverdueCheck();

    logger.info(
      `✓ Overdue refresh by ${req.user?.email}: ${updatedCount} newly marked`,
    );

    res.json({
      success: true,
      message: `Refreshed ${updatedCount} overdue payments`,
      updated_count: updatedCount,
    });
  } catch (error) {
    logger.error("Overdue refresh error:", error);
    res.status(500).json({ error: "Failed to refresh overdue payments" });
  }
});

// ============================================================
// MANUALLY TRIGGER OVERDUE CHECK (admin only) — legacy alias
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
