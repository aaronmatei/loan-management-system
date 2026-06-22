// Welfare investments (e.g. Money Market Funds). The chama records the amount
// invested, updates the interest earned (monthly), and withdraws. Income = total
// interest earned (independent of withdrawals). Each action posts to a ledger
// (welfare_investment_transactions); cached aggregates live on the row.
// Mounted at /api/welfares/:welfareId/investments. See migrations 100 + 101.
import express from "express";
import { query, withTransaction } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
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
    logger.error("welfare resolve (investments) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === "" || v == null ? 0 : parseFloat(v));
// income = interest earned (NOT current − invested, which would treat a
// withdrawal as a loss).
const decorate = (r) => ({
  ...r,
  amount_invested: Number(r.amount_invested), current_balance: Number(r.current_balance),
  interest_earned: Number(r.interest_earned), withdrawn: Number(r.withdrawn),
  income: Number(r.interest_earned),
});
const loadInvestment = (welfareId, id) =>
  query(`SELECT i.* FROM welfare_investments i JOIN groups g ON g.id=i.welfare_id WHERE i.id=$1 AND i.welfare_id=$2`, [id, welfareId]).then((r) => r.rows[0] || null);

// GET /investments — list with per-row figures + totals.
router.get("/", async (req, res) => {
  try {
    const rows = (await query(`SELECT * FROM welfare_investments WHERE welfare_id = $1 ORDER BY created_at DESC`, [req.welfare.id])).rows.map(decorate);
    const totals = rows.reduce((a, r) => ({ invested: a.invested + r.amount_invested, current: a.current + r.current_balance, income: a.income + r.income, withdrawn: a.withdrawn + r.withdrawn }), { invested: 0, current: 0, income: 0, withdrawn: 0 });
    res.json({ success: true, data: { investments: rows, totals } });
  } catch (e) {
    logger.error("welfare investments list error:", e);
    res.status(500).json({ error: "Failed to load investments" });
  }
});

// GET /investments/:id/transactions — the ledger for one investment.
router.get("/:id/transactions", async (req, res) => {
  try {
    const inv = await loadInvestment(req.welfare.id, req.params.id);
    if (!inv) return res.status(404).json({ error: "Investment not found" });
    const r = await query(`SELECT id, type, amount, balance_after, note, txn_date FROM welfare_investment_transactions WHERE investment_id=$1 ORDER BY id DESC`, [inv.id]);
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("investment txns error:", e);
    res.status(500).json({ error: "Failed to load transactions" });
  }
});

// Append a ledger row + update the cached aggregates atomically.
async function postTxn(client, inv, { type, amount, note, txnDate, userId, fields }) {
  const r = await client.query(`UPDATE welfare_investments SET ${fields}, updated_at=NOW() WHERE id=$1 RETURNING *`, [inv.id]);
  const updated = r.rows[0];
  await client.query(
    `INSERT INTO welfare_investment_transactions (tenant_id, investment_id, type, amount, balance_after, note, txn_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8)`,
    [inv.tenant_id, inv.id, type, round2(amount), Number(updated.current_balance), note || null, txnDate || null, userId],
  );
  return updated;
}

// POST /investments — record a new investment (initial deposit + any interest
// already earned if current balance > amount invested).
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const invested = round2(num(req.body?.amount_invested));
    const current = req.body?.current_balance != null && req.body.current_balance !== "" ? round2(num(req.body.current_balance)) : invested;
    const interest = round2(current - invested);
    const inv = await withTransaction(async (client) => {
      const created = (await client.query(
        `INSERT INTO welfare_investments (tenant_id, welfare_id, name, amount_invested, current_balance, interest_earned, withdrawn, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8) RETURNING *`,
        [req.welfare.tenant_id, req.welfare.id, name, invested, current, interest, req.body?.notes?.trim() || null, req.user.id],
      )).rows[0];
      if (invested > 0) await client.query(`INSERT INTO welfare_investment_transactions (tenant_id, investment_id, type, amount, balance_after, note, created_by) VALUES ($1,$2,'deposit',$3,$3,'Initial investment',$4)`, [req.welfare.tenant_id, created.id, invested, req.user.id]);
      if (interest !== 0) await client.query(`INSERT INTO welfare_investment_transactions (tenant_id, investment_id, type, amount, balance_after, note, created_by) VALUES ($1,$2,'interest',$3,$4,'Interest to date',$5)`, [req.welfare.tenant_id, created.id, interest, current, req.user.id]);
      return created;
    });
    await logAudit({ user: req.user, action: "created", entityType: "welfare_investment", entityId: inv.id, entityCode: name, description: `Added investment: ${name}`, req });
    res.status(201).json({ success: true, data: decorate(inv) });
  } catch (e) {
    logger.error("welfare investment create error:", e);
    res.status(500).json({ error: "Failed to add investment" });
  }
});

// POST /investments/:id/interest — record interest earned (the monthly update).
router.post("/:id/interest", authorize("admin", "manager"), async (req, res) => {
  try {
    const inv = await loadInvestment(req.welfare.id, req.params.id);
    if (!inv) return res.status(404).json({ error: "Investment not found" });
    const amount = round2(num(req.body?.amount));
    if (!(amount !== 0)) return res.status(400).json({ error: "Enter the interest amount" });
    const updated = await withTransaction((client) => postTxn(client, inv, {
      type: "interest", amount, note: req.body?.note, txnDate: req.body?.txn_date, userId: req.user.id,
      fields: `interest_earned = interest_earned + ${amount}, current_balance = current_balance + ${amount}`,
    }));
    await logAudit({ user: req.user, action: "investment_interest", entityType: "welfare_investment", entityId: inv.id, entityCode: inv.name, description: `Interest ${amount} on ${inv.name}`, req });
    res.json({ success: true, data: decorate(updated) });
  } catch (e) {
    logger.error("investment interest error:", e);
    res.status(500).json({ error: "Failed to record interest" });
  }
});

// POST /investments/:id/withdraw — take money out (reduces current balance, not income).
router.post("/:id/withdraw", authorize("admin", "manager"), async (req, res) => {
  try {
    const inv = await loadInvestment(req.welfare.id, req.params.id);
    if (!inv) return res.status(404).json({ error: "Investment not found" });
    const amount = round2(num(req.body?.amount));
    if (!(amount > 0)) return res.status(400).json({ error: "Enter the withdrawal amount" });
    if (amount > Number(inv.current_balance)) return res.status(400).json({ error: `Only KES ${Number(inv.current_balance).toLocaleString()} available` });
    const updated = await withTransaction((client) => postTxn(client, inv, {
      type: "withdrawal", amount, note: req.body?.note, txnDate: req.body?.txn_date, userId: req.user.id,
      fields: `withdrawn = withdrawn + ${amount}, current_balance = current_balance - ${amount}`,
    }));
    await logAudit({ user: req.user, action: "investment_withdrawal", entityType: "welfare_investment", entityId: inv.id, entityCode: inv.name, description: `Withdrew ${amount} from ${inv.name}`, req });
    res.json({ success: true, data: decorate(updated) });
  } catch (e) {
    logger.error("investment withdraw error:", e);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

// POST /investments/:id/deposit — invest more principal.
router.post("/:id/deposit", authorize("admin", "manager"), async (req, res) => {
  try {
    const inv = await loadInvestment(req.welfare.id, req.params.id);
    if (!inv) return res.status(404).json({ error: "Investment not found" });
    const amount = round2(num(req.body?.amount));
    if (!(amount > 0)) return res.status(400).json({ error: "Enter the deposit amount" });
    const updated = await withTransaction((client) => postTxn(client, inv, {
      type: "deposit", amount, note: req.body?.note, txnDate: req.body?.txn_date, userId: req.user.id,
      fields: `amount_invested = amount_invested + ${amount}, current_balance = current_balance + ${amount}`,
    }));
    res.json({ success: true, data: decorate(updated) });
  } catch (e) {
    logger.error("investment deposit error:", e);
    res.status(500).json({ error: "Failed to deposit" });
  }
});

// PUT /investments/:id — rename / notes.
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const inv = await loadInvestment(req.welfare.id, req.params.id);
    if (!inv) return res.status(404).json({ error: "Investment not found" });
    const r = await query(
      `UPDATE welfare_investments SET name=$2, notes=$3, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [inv.id, req.body?.name !== undefined ? String(req.body.name).trim() || inv.name : inv.name, req.body?.notes !== undefined ? (req.body.notes?.trim() || null) : inv.notes],
    );
    res.json({ success: true, data: decorate(r.rows[0]) });
  } catch (e) {
    logger.error("welfare investment update error:", e);
    res.status(500).json({ error: "Failed to update investment" });
  }
});

// DELETE /investments/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await query(`DELETE FROM welfare_investments WHERE id = $1 AND welfare_id = $2 RETURNING name`, [req.params.id, req.welfare.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Investment not found" });
    await logAudit({ user: req.user, action: "deleted", entityType: "welfare_investment", entityId: Number(req.params.id), entityCode: r.rows[0].name, description: `Deleted investment: ${r.rows[0].name}`, req });
    res.json({ success: true });
  } catch (e) {
    logger.error("welfare investment delete error:", e);
    res.status(500).json({ error: "Failed to delete investment" });
  }
});

export default router;
