// Loan waivers: forgiveness of part of what a borrower owes.
// Workflow:
//   Admin records         → status='approved' instantly, allocation runs
//   Manager/Officer asks  → status='pending', awaits admin review
//   Admin approves        → status='approved', allocation runs
//   Admin rejects         → status='rejected'
//   Admin reverses        → status='reversed', allocation undone
//
// Customer SMS/Email goes out on approve + on reverse via the
// notificationDispatcher (same plumbing as payments and disbursement).

import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import notificationDispatcher from "../services/notificationDispatcher.js";
import { applyWaiver, reverseWaiver } from "../services/waiverService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Principal isn't waivable — that's capital loss; the UI no longer
// offers it. "mixed" was an auto-split fallback before applyWaiver
// honoured the declared type; it's removed too. Both labels stay
// supported on historical loan_waivers rows (validation only fires
// at request creation).
const VALID_TYPES = ["penalty", "interest"];

// Helper — fire the customer notification asynchronously. Same
// pattern other routes use: best-effort, never blocks the response.
function notifyWaiver(loan, waiver, eventVariant) {
  (async () => {
    try {
      const c = await query(
        `SELECT phone_number, first_name, last_name, email
           FROM clients WHERE id = $1`,
        [loan.client_id],
      );
      const cust = c.rows[0];
      if (!cust) return;
      await notificationDispatcher.notify(eventVariant, {
        tenantId: loan.tenant_id,
        customer: { ...cust, client_id: loan.client_id },
        data: {
          loan_id: loan.id,
          loan_code: loan.loan_code,
          amount: waiver.amount,
          reason: waiver.reason,
        },
      });
    } catch (err) {
      logger.error(`notify(${eventVariant}) error:`, err);
    }
  })();
}

// ============================================================
// POST /loans/:id/waivers — record (admin) or request (others)
// ============================================================
router.post(
  "/:id/waivers",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { type, amount, reason, notes } = req.body || {};

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({
          error: `type must be one of ${VALID_TYPES.join(", ")}`,
        });
      }
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res
          .status(400)
          .json({ error: "Amount must be a positive number" });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: "Reason is required" });
      }

      const lT = tenantClause(req, 1);
      const lr = await query(
        `SELECT * FROM loans WHERE id = $1${lT.clause}`,
        [id, ...lT.params],
      );
      if (lr.rows.length === 0) {
        return res.status(404).json({ error: "Loan not found" });
      }
      const loan = lr.rows[0];
      if (!["active", "defaulted", "suspended"].includes(loan.status)) {
        return res.status(400).json({
          error: `Cannot waive on a ${loan.status} loan`,
        });
      }

      const isAdmin = req.user.role === "admin";
      const status = isAdmin ? "approved" : "pending";

      // Allocation only runs if admin records directly (or if admin
      // approves a pending request — that path is the /approve route).
      let allocation = null;
      if (isAdmin) {
        try {
          allocation = await applyWaiver(
            loan.id,
            loan.tenant_id,
            amt,
            type,
          );
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }

      const w = await query(
        `INSERT INTO loan_waivers (
            loan_id, tenant_id, type, amount, reason, notes,
            status, requested_by, requested_at,
            approved_by, approved_at, allocation
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, NOW(),
            $9, $10, $11
          )
          RETURNING *`,
        [
          loan.id,
          loan.tenant_id,
          type,
          amt,
          reason.trim(),
          notes || null,
          status,
          req.user.id,
          isAdmin ? req.user.id : null,
          isAdmin ? new Date() : null,
          allocation ? JSON.stringify(allocation) : null,
        ],
      );
      const waiver = w.rows[0];

      await logAudit({
        user: req.user,
        action: isAdmin ? "waiver_approved" : "waiver_requested",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: isAdmin
          ? `Waived KES ${amt.toLocaleString()} on ${loan.loan_code} (${type}) — ${reason.trim()}`
          : `Requested KES ${amt.toLocaleString()} waiver on ${loan.loan_code} (${type}) — ${reason.trim()}`,
        newValues: { waiver_id: waiver.id, type, amount: amt, status },
        req,
      });

      if (isAdmin) notifyWaiver(loan, waiver, "loan_waived");

      res.status(201).json({ success: true, data: waiver });
    } catch (err) {
      logger.error("Create waiver error:", err);
      res.status(500).json({ error: "Failed to record waiver" });
    }
  },
);

// ============================================================
// GET /loans/:id/waivers — list for a loan
// ============================================================
router.get("/:id/waivers", async (req, res) => {
  try {
    const { id } = req.params;
    const t = tenantClause(req, 1);
    const r = await query(
      `SELECT w.*,
              ru.first_name || ' ' || ru.last_name AS requested_by_name,
              au.first_name || ' ' || au.last_name AS approved_by_name,
              rju.first_name || ' ' || rju.last_name AS rejected_by_name,
              rvu.first_name || ' ' || rvu.last_name AS reversed_by_name
         FROM loan_waivers w
         LEFT JOIN users ru  ON ru.id  = w.requested_by
         LEFT JOIN users au  ON au.id  = w.approved_by
         LEFT JOIN users rju ON rju.id = w.rejected_by
         LEFT JOIN users rvu ON rvu.id = w.reversed_by
        WHERE w.loan_id = $1${t.clause}
        ORDER BY w.requested_at DESC`,
      [id, ...t.params],
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List waivers error:", err);
    res.status(500).json({ error: "Failed to load waivers" });
  }
});

// ============================================================
// GET /waivers/history — tenant-wide waiver history filtered by
// status. ?status=approved|rejected|reversed|all (default: all
// non-pending). Joins the same loan + client + reviewer context the
// pending queue uses so the UI can render one consistent row layout.
// ============================================================
router.get(
  "/history",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const ALLOWED = ["approved", "rejected", "reversed", "all"];
      const requested = String(req.query.status || "all").toLowerCase();
      const status = ALLOWED.includes(requested) ? requested : "all";

      const t = tenantClause(req, 0, "w.tenant_id");
      const statusClause =
        status === "all"
          ? `AND w.status IN ('approved','rejected','reversed')`
          : `AND w.status = '${status}'`;

      const r = await query(
        `SELECT w.*,
                l.loan_code, l.principal_amount, l.total_amount_due, l.status AS loan_status,
                c.first_name, c.last_name, c.phone_number, c.client_code,
                ru.first_name  || ' ' || ru.last_name  AS requested_by_name,
                au.first_name  || ' ' || au.last_name  AS approved_by_name,
                rju.first_name || ' ' || rju.last_name AS rejected_by_name,
                rvu.first_name || ' ' || rvu.last_name AS reversed_by_name
           FROM loan_waivers w
           JOIN loans   l ON l.id = w.loan_id
           JOIN clients c ON c.id = l.client_id
           LEFT JOIN users ru  ON ru.id  = w.requested_by
           LEFT JOIN users au  ON au.id  = w.approved_by
           LEFT JOIN users rju ON rju.id = w.rejected_by
           LEFT JOIN users rvu ON rvu.id = w.reversed_by
          WHERE 1=1${t.clause} ${statusClause}
          ORDER BY COALESCE(w.reversed_at, w.approved_at, w.rejected_at, w.requested_at) DESC`,
        t.params,
      );

      // Roll-up totals so the UI can show "12 approved · KES 47,500" etc.
      const totals = await query(
        `SELECT status,
                COUNT(*)::int AS count,
                COALESCE(SUM(amount), 0)::float AS total_amount
           FROM loan_waivers w
          WHERE 1=1${t.clause}
          GROUP BY status`,
        t.params,
      );

      res.json({ success: true, data: r.rows, totals: totals.rows });
    } catch (err) {
      logger.error("List waiver history error:", err);
      res.status(500).json({ error: "Failed to load waiver history" });
    }
  },
);

// ============================================================
// GET /waivers/pending — admin queue across all loans
// ============================================================
router.get("/pending", authorize("admin"), async (req, res) => {
  try {
    const t = tenantClause(req, 0, "w.tenant_id");
    const r = await query(
      `SELECT w.*,
              l.loan_code, l.principal_amount, l.total_amount_due, l.status AS loan_status,
              c.first_name, c.last_name, c.phone_number, c.client_code,
              ru.first_name || ' ' || ru.last_name AS requested_by_name
         FROM loan_waivers w
         JOIN loans   l ON l.id = w.loan_id
         JOIN clients c ON c.id = l.client_id
         LEFT JOIN users ru ON ru.id = w.requested_by
        WHERE w.status = 'pending'${t.clause}
        ORDER BY w.requested_at DESC`,
      t.params,
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    logger.error("List pending waivers error:", err);
    res.status(500).json({ error: "Failed to load pending waivers" });
  }
});

// ============================================================
// PUT /waivers/:wId/approve — admin signs off on a pending request
// ============================================================
router.put("/:wId/approve", authorize("admin"), async (req, res) => {
  try {
    const { wId } = req.params;
    const t = tenantClause(req, 1);
    const wr = await query(
      `SELECT * FROM loan_waivers WHERE id = $1${t.clause}`,
      [wId, ...t.params],
    );
    if (wr.rows.length === 0) {
      return res.status(404).json({ error: "Waiver not found" });
    }
    const w = wr.rows[0];
    if (w.status !== "pending") {
      return res
        .status(400)
        .json({ error: `Cannot approve a ${w.status} waiver` });
    }

    const lr = await query(`SELECT * FROM loans WHERE id = $1`, [w.loan_id]);
    const loan = lr.rows[0];
    if (!loan || !["active", "defaulted", "suspended"].includes(loan.status)) {
      return res
        .status(400)
        .json({ error: "Loan is no longer waivable" });
    }

    let allocation;
    try {
      allocation = await applyWaiver(
        loan.id,
        loan.tenant_id,
        parseFloat(w.amount),
        w.type,
      );
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const updated = await query(
      `UPDATE loan_waivers
          SET status = 'approved',
              approved_by = $1,
              approved_at = NOW(),
              allocation  = $2,
              updated_at  = NOW()
        WHERE id = $3
        RETURNING *`,
      [req.user.id, JSON.stringify(allocation), wId],
    );

    await logAudit({
      user: req.user,
      action: "waiver_approved",
      entityType: "loan",
      entityId: loan.id,
      entityCode: loan.loan_code,
      description: `Approved KES ${parseFloat(w.amount).toLocaleString()} waiver on ${loan.loan_code} (${w.type})`,
      oldValues: { status: "pending" },
      newValues: { status: "approved", waiver_id: w.id },
      req,
    });

    notifyWaiver(loan, updated.rows[0], "loan_waived");
    res.json({ success: true, data: updated.rows[0] });
  } catch (err) {
    logger.error("Approve waiver error:", err);
    res.status(500).json({ error: "Failed to approve waiver" });
  }
});

// ============================================================
// PUT /waivers/:wId/reject — admin rejects a pending request
// ============================================================
router.put("/:wId/reject", authorize("admin"), async (req, res) => {
  try {
    const { wId } = req.params;
    const { rejection_reason } = req.body || {};
    if (!rejection_reason || !rejection_reason.trim()) {
      return res
        .status(400)
        .json({ error: "rejection_reason is required" });
    }

    const t = tenantClause(req, 1);
    const wr = await query(
      `SELECT * FROM loan_waivers WHERE id = $1${t.clause}`,
      [wId, ...t.params],
    );
    if (wr.rows.length === 0) {
      return res.status(404).json({ error: "Waiver not found" });
    }
    if (wr.rows[0].status !== "pending") {
      return res
        .status(400)
        .json({ error: `Cannot reject a ${wr.rows[0].status} waiver` });
    }

    const lr = await query(`SELECT * FROM loans WHERE id = $1`, [
      wr.rows[0].loan_id,
    ]);

    const r = await query(
      `UPDATE loan_waivers
          SET status = 'rejected',
              rejected_by = $1, rejected_at = NOW(),
              rejection_reason = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [req.user.id, rejection_reason.trim(), wId],
    );

    await logAudit({
      user: req.user,
      action: "waiver_rejected",
      entityType: "loan",
      entityId: lr.rows[0]?.id,
      entityCode: lr.rows[0]?.loan_code,
      description: `Rejected KES ${parseFloat(
        wr.rows[0].amount,
      ).toLocaleString()} waiver request — ${rejection_reason.trim()}`,
      newValues: { waiver_id: wId, status: "rejected" },
      req,
    });

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Reject waiver error:", err);
    res.status(500).json({ error: "Failed to reject waiver" });
  }
});

// ============================================================
// POST /waivers/:wId/reverse — admin undoes an approved waiver
// ============================================================
router.post("/:wId/reverse", authorize("admin"), async (req, res) => {
  try {
    const { wId } = req.params;
    const { reversal_reason } = req.body || {};
    if (!reversal_reason || !reversal_reason.trim()) {
      return res
        .status(400)
        .json({ error: "reversal_reason is required" });
    }

    const t = tenantClause(req, 1);
    const wr = await query(
      `SELECT * FROM loan_waivers WHERE id = $1${t.clause}`,
      [wId, ...t.params],
    );
    if (wr.rows.length === 0) {
      return res.status(404).json({ error: "Waiver not found" });
    }
    const w = wr.rows[0];
    if (w.status !== "approved") {
      return res
        .status(400)
        .json({ error: `Cannot reverse a ${w.status} waiver` });
    }

    const lr = await query(`SELECT * FROM loans WHERE id = $1`, [w.loan_id]);
    await reverseWaiver(w.loan_id, w.tenant_id, w.allocation);

    const r = await query(
      `UPDATE loan_waivers
          SET status = 'reversed',
              reversed_by = $1, reversed_at = NOW(),
              reversal_reason = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [req.user.id, reversal_reason.trim(), wId],
    );

    await logAudit({
      user: req.user,
      action: "waiver_reversed",
      entityType: "loan",
      entityId: lr.rows[0]?.id,
      entityCode: lr.rows[0]?.loan_code,
      description: `Reversed KES ${parseFloat(w.amount).toLocaleString()} waiver — ${reversal_reason.trim()}`,
      newValues: { waiver_id: wId, status: "reversed" },
      req,
    });

    if (lr.rows[0]) notifyWaiver(lr.rows[0], r.rows[0], "loan_waiver_reversed");

    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    logger.error("Reverse waiver error:", err);
    res.status(500).json({ error: "Failed to reverse waiver" });
  }
});

export default router;
