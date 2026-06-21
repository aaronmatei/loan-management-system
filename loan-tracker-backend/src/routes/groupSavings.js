// Group savings + joint-liability coverage (Phase 5b). Dual-mounted on
// /api/groups so paths read /api/groups/:id/savings...
//
// The group's own fund: members contribute, the group withdraws, and savings
// can be applied to cover a member's outstanding loan (joint liability). The
// ledger is append-only with a running balance_after; coverage reuses the
// normal recordLoanPayment path so capital_pool + schedules stay correct.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { recordLoanPayment } from "../services/paymentService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

import { round2 } from "../utils/round2.js";

async function loadGroup(req, id) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [
    id,
    ...tc.params,
  ]);
  return r.rows[0] || null;
}

async function currentBalance(groupId) {
  const r = await query(
    `SELECT balance_after FROM group_savings_transactions
      WHERE group_id = $1 ORDER BY id DESC LIMIT 1`,
    [groupId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// Insert a savings ledger row, maintaining the running balance.
async function postSaving({ group, clientId, type, amount, direction, loanId, txnDate, description, userId }) {
  const prev = await currentBalance(group.id);
  const balanceAfter = round2(prev + direction * amount);
  const r = await query(
    `INSERT INTO group_savings_transactions
       (tenant_id, group_id, client_id, type, amount, direction, balance_after, loan_id, txn_date, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),$10,$11)
     RETURNING *`,
    [
      group.tenant_id,
      group.id,
      clientId || null,
      type,
      amount,
      direction,
      balanceAfter,
      loanId || null,
      txnDate || null,
      description || null,
      userId,
    ],
  );
  return r.rows[0];
}

// GET /api/groups/:id/savings — balance + per-member balances + ledger.
router.get("/:id/savings", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const balance = await currentBalance(group.id);
    const perMember = await query(
      `SELECT s.client_id, c.first_name, c.last_name, c.client_code,
              SUM(s.direction * s.amount) AS balance
         FROM group_savings_transactions s
         LEFT JOIN clients c ON c.id = s.client_id
        WHERE s.group_id = $1 AND s.client_id IS NOT NULL
        GROUP BY s.client_id, c.first_name, c.last_name, c.client_code
        ORDER BY balance DESC`,
      [group.id],
    );
    const ledger = await query(
      `SELECT s.*, c.first_name, c.last_name, l.loan_code
         FROM group_savings_transactions s
         LEFT JOIN clients c ON c.id = s.client_id
         LEFT JOIN loans l ON l.id = s.loan_id
        WHERE s.group_id = $1
        ORDER BY s.id DESC
        LIMIT 200`,
      [group.id],
    );
    res.json({
      success: true,
      data: {
        balance,
        members: perMember.rows.map((m) => ({ ...m, balance: Number(m.balance) })),
        transactions: ledger.rows,
      },
    });
  } catch (e) {
    logger.error("group savings get error:", e);
    res.status(500).json({ error: "Failed to load group savings" });
  }
});

// POST /api/groups/:id/savings/contribution
router.post(
  "/:id/savings/contribution",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { client_id, amount, txn_date, notes } = req.body || {};
      const amt = parseFloat(amount);
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });

      if (client_id) {
        const m = await query(
          `SELECT 1 FROM group_members WHERE group_id = $1 AND client_id = $2`,
          [group.id, client_id],
        );
        if (!m.rows.length) {
          return res.status(400).json({ error: "That client is not a member of this group" });
        }
      }

      const row = await postSaving({
        group,
        clientId: client_id,
        type: "contribution",
        amount: amt,
        direction: 1,
        txnDate: txn_date,
        description: notes,
        userId: req.user.id,
      });
      await logAudit({
        user: req.user,
        action: "group_savings_contribution",
        entityType: "group",
        entityId: group.id,
        entityCode: group.group_code,
        description: `Savings contribution KES ${amt} to "${group.name}"`,
        req,
      });
      res.status(201).json({ success: true, data: row, balance: Number(row.balance_after) });
    } catch (e) {
      logger.error("group savings contribution error:", e);
      res.status(500).json({ error: "Failed to record contribution" });
    }
  },
);

// POST /api/groups/:id/savings/withdrawal
router.post(
  "/:id/savings/withdrawal",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { client_id, amount, txn_date, notes } = req.body || {};
      const amt = parseFloat(amount);
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      const balance = await currentBalance(group.id);
      if (amt > balance) {
        return res.status(400).json({ error: `Only KES ${balance.toLocaleString()} in group savings` });
      }
      const row = await postSaving({
        group,
        clientId: client_id,
        type: "withdrawal",
        amount: amt,
        direction: -1,
        txnDate: txn_date,
        description: notes,
        userId: req.user.id,
      });
      await logAudit({
        user: req.user,
        action: "group_savings_withdrawal",
        entityType: "group",
        entityId: group.id,
        entityCode: group.group_code,
        description: `Savings withdrawal KES ${amt} from "${group.name}"`,
        req,
      });
      res.status(201).json({ success: true, data: row, balance: Number(row.balance_after) });
    } catch (e) {
      logger.error("group savings withdrawal error:", e);
      res.status(500).json({ error: "Failed to record withdrawal" });
    }
  },
);

// POST /api/groups/:id/savings/cover-loan — apply group savings to a member's
// outstanding loan (joint liability). Reuses recordLoanPayment so the capital
// pool + schedules update exactly as a normal repayment.
router.post(
  "/:id/savings/cover-loan",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { loan_id, amount } = req.body || {};
      if (!loan_id) return res.status(400).json({ error: "loan_id is required" });

      const loanRes = await query(
        `SELECT * FROM loans WHERE id = $1 AND group_id = $2 AND tenant_id = $3`,
        [loan_id, group.id, group.tenant_id],
      );
      const loan = loanRes.rows[0];
      if (!loan) return res.status(404).json({ error: "Loan not found in this group" });
      if (!["active", "defaulted"].includes(loan.status)) {
        return res.status(400).json({
          error: `Can't cover a ${loan.status} loan`,
        });
      }

      const paidRes = await query(
        `SELECT COALESCE(SUM(amount_paid - COALESCE(penalty_portion,0) - COALESCE(overpayment_portion,0)),0) AS paid
           FROM transactions WHERE loan_id = $1 AND payment_status = 'completed'`,
        [loan.id],
      );
      const outstanding = round2(
        parseFloat(loan.total_amount_due) - parseFloat(paidRes.rows[0].paid),
      );
      const amt = amount != null && amount !== "" ? parseFloat(amount) : outstanding;
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      if (amt > outstanding) {
        return res.status(400).json({
          error: `Loan only owes KES ${outstanding.toLocaleString()}`,
        });
      }
      const balance = await currentBalance(group.id);
      if (amt > balance) {
        return res.status(400).json({
          error: `Only KES ${balance.toLocaleString()} in group savings`,
        });
      }

      // A defaulted loan is recovered: reactivate so the tested payment path
      // can apply the cash (it will re-complete if fully cleared).
      if (loan.status === "defaulted") {
        await query(`UPDATE loans SET status='active', updated_at=NOW() WHERE id=$1`, [loan.id]);
      }

      const result = await recordLoanPayment({
        loanId: loan.id,
        amountPaid: amt,
        paymentDate: new Date().toISOString().split("T")[0],
        paymentMethod: "Group Savings",
        notes: `Joint-liability coverage from ${group.name} savings`,
        actor: req.user,
        tenantId: group.tenant_id,
        auditReq: req,
      });

      const row = await postSaving({
        group,
        clientId: loan.client_id,
        type: "liability_coverage",
        amount: amt,
        direction: -1,
        loanId: loan.id,
        description: `Covered ${loan.loan_code} from group savings`,
        userId: req.user.id,
      });

      await logAudit({
        user: req.user,
        action: "group_savings_coverage",
        entityType: "loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Group "${group.name}" covered KES ${amt} of ${loan.loan_code} from savings`,
        req,
      });

      res.json({
        success: true,
        balance: Number(row.balance_after),
        loan_status: result?.data?.loan_status,
        data: row,
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      logger.error("group savings cover-loan error:", e);
      res.status(500).json({ error: "Failed to cover loan from savings" });
    }
  },
);

export default router;
