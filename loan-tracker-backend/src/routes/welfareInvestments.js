// Welfare investments (e.g. Money Market Funds). The admin records the amount
// invested and updates the current balance; income = current − invested.
// Mounted at /api/welfares/:welfareId/investments. See migration 100.
import express from "express";
import { query } from "../config/database.js";
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

const num = (v) => (v === "" || v == null ? 0 : parseFloat(v));
const decorate = (r) => ({ ...r, amount_invested: Number(r.amount_invested), current_balance: Number(r.current_balance), income: Math.round((Number(r.current_balance) - Number(r.amount_invested)) * 100) / 100 });

// GET /investments — list with per-row income + totals.
router.get("/", async (req, res) => {
  try {
    const rows = (await query(`SELECT * FROM welfare_investments WHERE welfare_id = $1 ORDER BY created_at DESC`, [req.welfare.id])).rows.map(decorate);
    const totals = rows.reduce((a, r) => ({ invested: a.invested + r.amount_invested, current: a.current + r.current_balance, income: a.income + r.income }), { invested: 0, current: 0, income: 0 });
    res.json({ success: true, data: { investments: rows, totals } });
  } catch (e) {
    logger.error("welfare investments list error:", e);
    res.status(500).json({ error: "Failed to load investments" });
  }
});

// POST /investments — record a new investment.
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    const r = await query(
      `INSERT INTO welfare_investments (tenant_id, welfare_id, name, amount_invested, current_balance, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.welfare.tenant_id, req.welfare.id, name, num(req.body?.amount_invested), num(req.body?.current_balance), req.body?.notes?.trim() || null, req.user.id],
    );
    await logAudit({ user: req.user, action: "created", entityType: "welfare_investment", entityId: r.rows[0].id, entityCode: name, description: `Added investment: ${name}`, req });
    res.status(201).json({ success: true, data: decorate(r.rows[0]) });
  } catch (e) {
    logger.error("welfare investment create error:", e);
    res.status(500).json({ error: "Failed to add investment" });
  }
});

// PUT /investments/:id — update amount invested / current balance / name.
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const cur = (await query(`SELECT * FROM welfare_investments WHERE id = $1 AND welfare_id = $2`, [req.params.id, req.welfare.id])).rows[0];
    if (!cur) return res.status(404).json({ error: "Investment not found" });
    const r = await query(
      `UPDATE welfare_investments
          SET name = $2, amount_invested = $3, current_balance = $4, notes = $5, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [cur.id,
        req.body?.name !== undefined ? String(req.body.name).trim() || cur.name : cur.name,
        req.body?.amount_invested !== undefined ? num(req.body.amount_invested) : Number(cur.amount_invested),
        req.body?.current_balance !== undefined ? num(req.body.current_balance) : Number(cur.current_balance),
        req.body?.notes !== undefined ? (req.body.notes?.trim() || null) : cur.notes],
    );
    await logAudit({ user: req.user, action: "updated", entityType: "welfare_investment", entityId: cur.id, entityCode: r.rows[0].name, description: `Updated investment: ${r.rows[0].name}`, req });
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
