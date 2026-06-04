// Promise to Pay — collections-side commitments.
//
// Borrower verbally agrees to pay an amount by a specific date; admin logs
// it on the loan so it appears in a follow-up queue. "Broken" status is
// derived on read (pending + promised_date < today) so we don't need a
// nightly job to flip rows — keeps the SQL model tiny.
//
// Mount routes:
//   POST /api/loans/:id/promises         — log a new promise on a loan
//   GET  /api/loans/:id/promises         — list promises for a loan
//   GET  /api/promises                   — tenant-wide list, filtered by status
//   GET  /api/promises/summary           — counts by derived status for tiles
//   PUT  /api/promises/:pid/kept         — mark as fulfilled
//   PUT  /api/promises/:pid/cancel       — cancel with a reason
//
// All routes verifyToken + tenant-scoped. Capture/resolve/cancel actions are
// admin/manager/loan_officer; viewing is anyone with a token.

import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Derived status SQL fragment — applies to a row aliased as `p`.
//   pending + promised_date < today  →  broken
//   pending + promised_date >= today →  pending
//   partial / kept / cancelled       →  themselves
//
// 'partial' is stored explicitly by reconcilePromisesForLoan when a
// payment arrives that's smaller than the promised amount. It does
// NOT decay to 'broken' on date pass — the borrower made effort, so
// it stays in its own bucket out of the failure queue.
const DERIVED_STATUS = `
  CASE
    WHEN p.status = 'pending' AND p.promised_date < CURRENT_DATE THEN 'broken'
    ELSE p.status
  END
`;

// =============================================================
// POST /loans/:id/promises — log a new promise
// =============================================================
router.post(
  "/:id/promises",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, promised_date, notes } = req.body;

      const numAmount = parseFloat(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res
          .status(400)
          .json({ error: "Amount must be a positive number" });
      }
      if (!promised_date || !/^\d{4}-\d{2}-\d{2}$/.test(promised_date)) {
        return res
          .status(400)
          .json({ error: "promised_date must be YYYY-MM-DD" });
      }

      // Confirm the loan belongs to this tenant + isn't closed.
      const lt = tenantClause(req, 1);
      const lr = await query(
        `SELECT id, status FROM loans WHERE id = $1${lt.clause}`,
        [id, ...lt.params],
      );
      if (lr.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      if (["completed", "rejected"].includes(lr.rows[0].status)) {
        return res.status(400).json({
          error: `Cannot log a promise on a ${lr.rows[0].status} loan`,
        });
      }

      const tid = tenantId(req);
      const r = await query(
        `INSERT INTO promises_to_pay
           (tenant_id, loan_id, amount, promised_date, notes, captured_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tid, id, numAmount, promised_date, notes || null, req.user.id],
      );
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (err) {
      logger.error("Create promise error:", err);
      res.status(500).json({ error: "Failed to log promise" });
    }
  },
);

// =============================================================
// GET /loans/:id/promises — per-loan history
// =============================================================
router.get("/:id/promises", async (req, res) => {
  try {
    const { id } = req.params;
    const t = tenantClause(req, 1, "p.tenant_id");
    const r = await query(
      `SELECT p.*, ${DERIVED_STATUS} AS derived_status,
              cb.first_name || ' ' || cb.last_name AS captured_by_name,
              rb.first_name || ' ' || rb.last_name AS resolved_by_name,
              COALESCE((
                SELECT SUM(
                  t.amount_paid
                  - COALESCE(t.overpayment_portion, 0)
                )
                  FROM transactions t
                 WHERE t.loan_id = p.loan_id
                   AND t.payment_status = 'completed'
                   AND t.created_at >= p.made_at
              ), 0)::float AS paid_since
         FROM promises_to_pay p
         LEFT JOIN users cb ON cb.id = p.captured_by
         LEFT JOIN users rb ON rb.id = p.resolved_by
        WHERE p.loan_id = $1${t.clause}
        ORDER BY p.promised_date DESC, p.id DESC`,
      [id, ...t.params],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List promises (per loan) error:", err);
    res.status(500).json({ error: "Failed to load promises" });
  }
});

// =============================================================
// GET /promises — tenant-wide list
//   ?status=all|pending|partial|broken|kept|cancelled  (default: all)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (filter by promised_date window)
// =============================================================
router.get("/", async (req, res) => {
  try {
    const status = (req.query.status || "all").toLowerCase();
    const validStatuses = ["all", "pending", "partial", "broken", "kept", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }

    const params = [];
    let where = "WHERE 1=1";

    const t = tenantClause(req, params.length, "p.tenant_id");
    if (t.clause) {
      where += t.clause;
      params.push(...t.params);
    }

    if (status !== "all") {
      params.push(status);
      where += ` AND ${DERIVED_STATUS} = $${params.length}`;
    }

    const { from, to } = req.query;
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(from);
      where += ` AND p.promised_date >= $${params.length}`;
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(to);
      where += ` AND p.promised_date <= $${params.length}`;
    }

    // paid_since: cumulative cash on the loan from completed
    // transactions with created_at >= promise.made_at, net of penalty
    // and refunded overpayment. Mirrors reconcilePromisesForLoan's
    // metric so what we display on the UI matches the threshold the
    // auto-transition actually crossed. Surface it here so the Partial
    // tab can render "KES X paid of Y · KES Z remaining" without the
    // frontend having to refetch transactions per row.
    const r = await query(
      `SELECT p.*, ${DERIVED_STATUS} AS derived_status,
              l.loan_code, l.status AS loan_status,
              c.first_name, c.last_name, c.phone_number, c.client_code,
              cb.first_name || ' ' || cb.last_name AS captured_by_name,
              rb.first_name || ' ' || rb.last_name AS resolved_by_name,
              COALESCE((
                SELECT SUM(
                  t.amount_paid
                  - COALESCE(t.overpayment_portion, 0)
                )
                  FROM transactions t
                 WHERE t.loan_id = p.loan_id
                   AND t.payment_status = 'completed'
                   AND t.created_at >= p.made_at
              ), 0)::float AS paid_since
         FROM promises_to_pay p
         JOIN loans l ON l.id = p.loan_id
         JOIN clients c ON c.id = l.client_id
         LEFT JOIN users cb ON cb.id = p.captured_by
         LEFT JOIN users rb ON rb.id = p.resolved_by
         ${where}
        ORDER BY p.promised_date ASC, p.id DESC
        LIMIT 1000`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List promises (tenant-wide) error:", err);
    res.status(500).json({ error: "Failed to load promises" });
  }
});

// =============================================================
// GET /promises/summary — derived-status counts for tiles
// =============================================================
router.get("/summary", async (req, res) => {
  try {
    const t = tenantClause(req, 0, "p.tenant_id");
    const r = await query(
      `SELECT
         COUNT(*) FILTER (WHERE ${DERIVED_STATUS} = 'pending')::int   AS pending_count,
         COUNT(*) FILTER (WHERE ${DERIVED_STATUS} = 'partial')::int   AS partial_count,
         COUNT(*) FILTER (WHERE ${DERIVED_STATUS} = 'broken')::int    AS broken_count,
         COUNT(*) FILTER (WHERE ${DERIVED_STATUS} = 'kept')::int      AS kept_count,
         COUNT(*) FILTER (WHERE ${DERIVED_STATUS} = 'cancelled')::int AS cancelled_count,
         COALESCE(SUM(amount) FILTER (WHERE ${DERIVED_STATUS} = 'pending'), 0)::float AS pending_amount,
         COALESCE(SUM(amount) FILTER (WHERE ${DERIVED_STATUS} = 'partial'), 0)::float AS partial_amount,
         COALESCE(SUM(amount) FILTER (WHERE ${DERIVED_STATUS} = 'broken'), 0)::float  AS broken_amount
       FROM promises_to_pay p
       WHERE 1=1${t.clause}`,
      t.params,
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Promises summary error:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

// =============================================================
// PUT /promises/:pid/kept — mark as fulfilled
// =============================================================
router.put(
  "/:pid/kept",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const { pid } = req.params;
      // Params before t.params: $1 = pid, $2 = req.user.id.
      // tenantClause(offset=2) places tid at $3 — without this the
      // clause was binding tenant_id against $2 (req.user.id), the
      // UPDATE matched zero rows for every non-platform-admin, and the
      // route returned 404/500 instead of doing its job.
      const t = tenantClause(req, 2, "tenant_id");
      // Manual override: works on pending OR partial — an admin may
      // want to mark a partially-paid promise as kept (e.g. the rest
      // came through off-system) without waiting for another payment
      // to land and auto-promote it.
      const r = await query(
        `UPDATE promises_to_pay
            SET status      = 'kept',
                resolved_at = NOW(),
                resolved_by = $2,
                updated_at  = NOW()
          WHERE id = $1 AND status IN ('pending', 'partial')${t.clause}
          RETURNING *`,
        [pid, req.user.id, ...t.params],
      );
      if (r.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Promise not found or already resolved" });
      }
      res.json({ success: true, data: r.rows[0] });
    } catch (err) {
      logger.error("Mark promise kept error:", err);
      res.status(500).json({ error: "Failed to update promise" });
    }
  },
);

// =============================================================
// PUT /promises/:pid/cancel — cancel with a reason
// =============================================================
router.put(
  "/:pid/cancel",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const { pid } = req.params;
      const reason = (req.body?.cancelled_reason || "").trim();
      if (!reason) {
        return res
          .status(400)
          .json({ error: "cancelled_reason is required" });
      }
      // Params before t.params: $1 = pid, $2 = reason, $3 = req.user.id.
      // tenantClause(offset=3) places tid at $4. The previous offset of
      // 2 collided with $3 (req.user.id), so non-platform-admin users
      // could never cancel a promise — the UPDATE matched zero rows.
      const t = tenantClause(req, 3, "tenant_id");
      // Cancel works on pending or partial (an admin may cancel a
      // partially-fulfilled promise that the borrower has since
      // disowned).
      const r = await query(
        `UPDATE promises_to_pay
            SET status           = 'cancelled',
                cancelled_reason = $2,
                resolved_at      = NOW(),
                resolved_by      = $3,
                updated_at       = NOW()
          WHERE id = $1 AND status IN ('pending', 'partial')${t.clause}
          RETURNING *`,
        [pid, reason, req.user.id, ...t.params],
      );
      if (r.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Promise not found or already resolved" });
      }
      res.json({ success: true, data: r.rows[0] });
    } catch (err) {
      logger.error("Cancel promise error:", err);
      res.status(500).json({ error: "Failed to cancel promise" });
    }
  },
);

export default router;
