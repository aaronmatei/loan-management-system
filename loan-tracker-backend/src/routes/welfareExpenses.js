// Welfare expenses — money spent OUT of the monthly-contribution (savings) pool
// for group running costs. Recorded as a 'expense' member_pool_transactions row
// (direction -1), so it reduces the pool balance (and thus the surplus/profit)
// but NOT member savings. Mounted at /api/welfares/:welfareId.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { poolBalance, postPool } from "../services/welfarePoolService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (expenses) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /expenses — list + total + current pool balance.
router.get("/expenses", async (req, res) => {
  try {
    const rows = (await query(
      `SELECT id, amount, txn_date, description, created_at FROM member_pool_transactions
        WHERE welfare_id=$1 AND type='expense' ORDER BY txn_date DESC, id DESC LIMIT 300`,
      [req.welfare.id],
    )).rows;
    const total = (await query(`SELECT COALESCE(SUM(amount),0) t FROM member_pool_transactions WHERE welfare_id=$1 AND type='expense'`, [req.welfare.id])).rows[0].t;
    res.json({ success: true, data: rows.map((r) => ({ ...r, amount: Number(r.amount) })), total: Number(total), pool_balance: await poolBalance(req.welfare.id) });
  } catch (e) {
    logger.error("expenses list error:", e);
    res.status(500).json({ error: "Failed to load expenses" });
  }
});

// POST /expenses — record a spend out of the savings pool.
router.post("/expenses", authorize("admin", "manager"), async (req, res) => {
  try {
    const { amount, description, txn_date } = req.body || {};
    const amt = parseFloat(amount);
    if (!(amt > 0)) return res.status(400).json({ error: "Enter a positive amount" });
    if (!description || !String(description).trim()) return res.status(400).json({ error: "Describe what the expense was for" });
    const bal = await poolBalance(req.welfare.id);
    if (amt > bal) return res.status(400).json({ error: `The pool only holds KES ${bal.toLocaleString()} — can't spend KES ${amt.toLocaleString()}` });

    const tx = await postPool({
      welfare: req.welfare, memberId: null, type: "expense", amount: amt, direction: -1,
      txnDate: txn_date, description: String(description).trim(), userId: req.user.id,
    });
    await logAudit({ user: req.user, action: "welfare_expense_recorded", entityType: "group", entityId: req.welfare.id, entityCode: req.welfare.group_code, description: `Expense KES ${amt}: ${description}`, req });
    res.status(201).json({ success: true, data: { ...tx, amount: Number(tx.amount) } });
  } catch (e) {
    logger.error("expense create error:", e);
    res.status(500).json({ error: "Failed to record expense" });
  }
});

export default router;
