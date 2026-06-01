// Reconciliation — daily balancing surface for cashiers.
//
// Two views, both tenant-scoped:
//
//   GET /api/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD
//     Every cash transaction in the window, with how it split between
//     penalty / amount_due / overpayment, plus the derived principal +
//     interest share of amount_due (by contract ratio). Plus a per-
//     method roll-up (Cash, M-Pesa, Bank, Cheque, Other) so the
//     cashier can balance against the till.
//
//   GET /api/reconciliation/overpayments
//     Loans with refund_status='pending' — the borrower paid more than
//     they owed and the lender owes them a refund. Same data the
//     Loans-list "Refund Due" column shows, in a focused queue with
//     totals.
//
// Default window when ?from / ?to are omitted = today (the cashier's
// "end-of-shift" view).

import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// ============================================================
// GET /reconciliation — transactions in a window + by-method roll-up
// ============================================================
router.get("/", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : today;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : today;

    // Transaction rows. The principal_portion / interest_portion are
    // derived inline from (amount_due paid) × the loan's contract
    // ratio — same lens analyticsService uses everywhere else, so the
    // numbers reconcile across the app.
    const t = tenantClause(req, 2, "t.tenant_id");
    const txnSql = `
      SELECT
        t.id,
        t.transaction_code,
        t.payment_date,
        t.payment_method,
        t.payment_reference,
        t.amount_paid,
        COALESCE(t.penalty_portion, 0)     AS penalty_portion,
        COALESCE(t.overpayment_portion, 0) AS overpayment_portion,
        (t.amount_paid
          - COALESCE(t.penalty_portion, 0)
          - COALESCE(t.overpayment_portion, 0))                       AS toward_amount_due,
        (t.amount_paid
          - COALESCE(t.penalty_portion, 0)
          - COALESCE(t.overpayment_portion, 0))
          * (l.principal_amount / NULLIF(l.total_amount_due, 0))      AS principal_portion,
        (t.amount_paid
          - COALESCE(t.penalty_portion, 0)
          - COALESCE(t.overpayment_portion, 0))
          * (l.total_interest / NULLIF(l.total_amount_due, 0))        AS interest_portion,
        t.payment_status,
        l.id            AS loan_id,
        l.loan_code,
        c.id            AS client_id,
        c.first_name,
        c.last_name,
        c.client_code,
        c.phone_number
      FROM transactions t
      JOIN loans l ON l.id = t.loan_id
      JOIN clients c ON c.id = l.client_id
      WHERE t.payment_date::date BETWEEN $1 AND $2
        AND t.payment_status = 'completed'${t.clause}
      ORDER BY t.payment_date DESC, t.id DESC
      LIMIT 5000
    `;
    const txns = await query(txnSql, [from, to, ...t.params]);

    // Per-method roll-up. Same window + tenant scope. Normalise the
    // method casing so "mpesa" / "MPESA" / null all bucket sensibly.
    const sumSql = `
      SELECT
        COALESCE(NULLIF(LOWER(TRIM(t.payment_method)), ''), 'other') AS method,
        COUNT(*)::int                                                AS count,
        COALESCE(SUM(t.amount_paid), 0)::float                       AS gross,
        COALESCE(SUM(COALESCE(t.penalty_portion, 0)), 0)::float      AS penalty,
        COALESCE(SUM(COALESCE(t.overpayment_portion, 0)), 0)::float  AS overpayment,
        COALESCE(SUM(
          t.amount_paid
          - COALESCE(t.penalty_portion, 0)
          - COALESCE(t.overpayment_portion, 0)
        ), 0)::float                                                 AS toward_amount_due
      FROM transactions t
      WHERE t.payment_date::date BETWEEN $1 AND $2
        AND t.payment_status = 'completed'${t.clause}
      GROUP BY method
      ORDER BY gross DESC
    `;
    const byMethod = await query(sumSql, [from, to, ...t.params]);

    // Overall totals (same window, no method grouping).
    const totalsRow = byMethod.rows.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        gross: acc.gross + r.gross,
        penalty: acc.penalty + r.penalty,
        overpayment: acc.overpayment + r.overpayment,
        toward_amount_due: acc.toward_amount_due + r.toward_amount_due,
      }),
      { count: 0, gross: 0, penalty: 0, overpayment: 0, toward_amount_due: 0 },
    );

    res.json({
      success: true,
      data: {
        from,
        to,
        transactions: txns.rows,
        by_method: byMethod.rows,
        totals: totalsRow,
      },
    });
  } catch (err) {
    logger.error("Reconciliation list error:", err);
    res.status(500).json({ error: "Failed to load reconciliation" });
  }
});

// ============================================================
// GET /reconciliation/overpayments — refund queue
// ============================================================
router.get("/overpayments", async (req, res) => {
  try {
    const t = tenantClause(req, 0, "l.tenant_id");
    // Only loans flagged as having a pending refund AND a non-zero
    // overpayment_amount. refund_status='refunded' falls out.
    const r = await query(
      `SELECT
         l.id,
         l.loan_code,
         l.principal_amount,
         l.total_amount_due,
         l.overpayment_amount,
         l.refund_status,
         l.updated_at,
         c.first_name, c.last_name, c.phone_number, c.client_code
       FROM loans l
       JOIN clients c ON c.id = l.client_id
       WHERE l.refund_status = 'pending'
         AND COALESCE(l.overpayment_amount, 0) > 0${t.clause}
       ORDER BY l.overpayment_amount DESC, l.updated_at DESC
       LIMIT 1000`,
      t.params,
    );

    const total = r.rows.reduce(
      (s, row) => s + parseFloat(row.overpayment_amount || 0),
      0,
    );

    res.json({
      success: true,
      data: {
        loans: r.rows,
        total_pending: total,
        count: r.rows.length,
      },
    });
  } catch (err) {
    logger.error("Reconciliation overpayments error:", err);
    res.status(500).json({ error: "Failed to load overpayments" });
  }
});

export default router;
