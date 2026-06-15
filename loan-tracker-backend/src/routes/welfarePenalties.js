// Welfare/chama settings + penalty engine. Mounted at /api/welfares/:welfareId.
// Each chama configures its own penalty rules; assessments are the payable
// ledger, and paying one posts into the welfare pool as income.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import {
  computePenaltyAmount,
  PENALTY_TRIGGERS,
  PENALTY_CALC_TYPES,
} from "../utils/penaltyEngine.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Resolve + tenant-check the welfare on every request.
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [
      req.params.welfareId,
      ...tc.params,
    ]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (penalties) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function loadMember(welfareId, id) {
  const r = await query(`SELECT * FROM members WHERE id = $1 AND welfare_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}

async function poolBalance(welfareId) {
  const r = await query(
    `SELECT balance_after FROM member_pool_transactions
      WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfareId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// ---------------- SETTINGS ----------------

router.get("/settings", async (req, res) => {
  try {
    const r = await query(`SELECT * FROM welfare_settings WHERE tenant_id = $1`, [req.welfare.tenant_id]);
    res.json({ success: true, data: r.rows[0] || null });
  } catch (e) {
    logger.error("welfare settings get error:", e);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.put("/settings", authorize("admin", "manager"), async (req, res) => {
  try {
    const { contribution_frequency, contribution_amount, contribution_grace_days, attendance_grace_minutes } = req.body || {};
    const freq = ["weekly", "biweekly", "monthly"].includes(contribution_frequency) ? contribution_frequency : "monthly";
    const r = await query(
      `INSERT INTO welfare_settings
         (tenant_id, contribution_frequency, contribution_amount, contribution_grace_days, attendance_grace_minutes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         contribution_frequency = EXCLUDED.contribution_frequency,
         contribution_amount = EXCLUDED.contribution_amount,
         contribution_grace_days = EXCLUDED.contribution_grace_days,
         attendance_grace_minutes = EXCLUDED.attendance_grace_minutes,
         updated_at = NOW()
       RETURNING *`,
      [
        req.welfare.tenant_id, freq,
        contribution_amount != null && contribution_amount !== "" ? parseFloat(contribution_amount) : null,
        parseInt(contribution_grace_days, 10) || 0,
        parseInt(attendance_grace_minutes, 10) || 0,
      ],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare settings update error:", e);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// ---------------- PENALTY RULES ----------------

router.get("/penalty-rules", async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM penalty_rules WHERE tenant_id = $1 ORDER BY trigger, id`,
      [req.welfare.tenant_id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("penalty rules list error:", e);
    res.status(500).json({ error: "Failed to load penalty rules" });
  }
});

function validateRule(body) {
  if (!PENALTY_TRIGGERS.includes(body.trigger)) return "Invalid trigger";
  if (!PENALTY_CALC_TYPES.includes(body.calc_type)) return "Invalid calculation type";
  const usesAmount = body.calc_type === "fixed" || body.calc_type === "daily_fixed";
  if (usesAmount && !(parseFloat(body.amount) > 0)) return "Amount must be positive";
  if (!usesAmount && !(parseFloat(body.rate) > 0)) return "Rate must be positive";
  return null;
}

router.post("/penalty-rules", authorize("admin", "manager"), async (req, res) => {
  try {
    const err = validateRule(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const { trigger, calc_type, amount, rate, cap, notes } = req.body;
    const r = await query(
      `INSERT INTO penalty_rules (tenant_id, trigger, calc_type, amount, rate, cap, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.welfare.tenant_id, trigger, calc_type,
        amount != null && amount !== "" ? parseFloat(amount) : null,
        rate != null && rate !== "" ? parseFloat(rate) : null,
        cap != null && cap !== "" ? parseFloat(cap) : null,
        notes || null, req.user.id,
      ],
    );
    await logAudit({
      user: req.user, action: "penalty_rule_created", entityType: "penalty_rule",
      entityId: r.rows[0].id, description: `Penalty rule ${trigger}/${calc_type}`, req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("penalty rule create error:", e);
    res.status(500).json({ error: "Failed to create rule" });
  }
});

router.put("/penalty-rules/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const err = validateRule(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const { trigger, calc_type, amount, rate, cap, notes, active } = req.body;
    const r = await query(
      `UPDATE penalty_rules SET
          trigger=$3, calc_type=$4, amount=$5, rate=$6, cap=$7, notes=$8,
          active=COALESCE($9, active), updated_at=NOW()
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id, req.welfare.tenant_id, trigger, calc_type,
        amount != null && amount !== "" ? parseFloat(amount) : null,
        rate != null && rate !== "" ? parseFloat(rate) : null,
        cap != null && cap !== "" ? parseFloat(cap) : null,
        notes || null, typeof active === "boolean" ? active : null,
      ],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Rule not found" });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("penalty rule update error:", e);
    res.status(500).json({ error: "Failed to update rule" });
  }
});

router.delete("/penalty-rules/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await query(`DELETE FROM penalty_rules WHERE id=$1 AND tenant_id=$2 RETURNING id`, [
      req.params.id, req.welfare.tenant_id,
    ]);
    if (!r.rows.length) return res.status(404).json({ error: "Rule not found" });
    res.json({ success: true });
  } catch (e) {
    logger.error("penalty rule delete error:", e);
    res.status(500).json({ error: "Failed to delete rule" });
  }
});

// ---------------- ASSESSMENTS ----------------

router.get("/penalties", async (req, res) => {
  try {
    const params = [req.welfare.tenant_id];
    let where = "a.tenant_id = $1";
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND a.status = $${params.length}`;
    }
    if (req.query.member_id) {
      params.push(req.query.member_id);
      where += ` AND a.member_id = $${params.length}`;
    }
    const r = await query(
      `SELECT a.*, m.first_name, m.last_name, m.member_no
         FROM penalty_assessments a
         LEFT JOIN members m ON m.id = a.member_id
        WHERE ${where}
        ORDER BY a.assessed_at DESC
        LIMIT 500`,
      params,
    );
    const totals = await query(
      `SELECT COALESCE(SUM(amount - paid_amount),0) AS outstanding
         FROM penalty_assessments WHERE tenant_id=$1 AND status='outstanding'`,
      [req.welfare.tenant_id],
    );
    res.json({ success: true, data: r.rows, outstanding_total: Number(totals.rows[0].outstanding) });
  } catch (e) {
    logger.error("penalties list error:", e);
    res.status(500).json({ error: "Failed to load penalties" });
  }
});

// POST /penalties — assess a penalty against a member. Amount can be given
// directly, or computed from a rule (+ basis/days_late).
router.post("/penalties", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const { member_id, rule_id, amount, basis, days_late, description } = req.body || {};
    const member = await loadMember(req.welfare.id, member_id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    let rule = null;
    if (rule_id) {
      const rr = await query(`SELECT * FROM penalty_rules WHERE id=$1 AND tenant_id=$2`, [rule_id, req.welfare.tenant_id]);
      rule = rr.rows[0] || null;
      if (!rule) return res.status(404).json({ error: "Rule not found" });
    }

    let amt = amount != null && amount !== "" ? parseFloat(amount) : null;
    if (amt == null && rule) {
      amt = computePenaltyAmount(rule, { basis, daysLate: days_late });
    }
    if (!(amt > 0)) return res.status(400).json({ error: "A positive amount (or a rule that yields one) is required" });

    const r = await query(
      `INSERT INTO penalty_assessments
         (tenant_id, member_id, rule_id, trigger, source_type, amount, description, created_by)
       VALUES ($1,$2,$3,$4,'manual',$5,$6,$7) RETURNING *`,
      [
        req.welfare.tenant_id, member.id, rule ? rule.id : null,
        rule ? rule.trigger : req.body.trigger || "manual",
        round2(amt), description || null, req.user.id,
      ],
    );
    await logAudit({
      user: req.user, action: "penalty_assessed", entityType: "member", entityId: member.id,
      entityCode: member.member_no, description: `Penalty KES ${round2(amt)} on ${member.first_name} ${member.last_name}`, req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("penalty assess error:", e);
    res.status(500).json({ error: "Failed to assess penalty" });
  }
});

router.post("/penalties/:id/waive", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await query(
      `UPDATE penalty_assessments SET status='waived'
        WHERE id=$1 AND tenant_id=$2 AND status='outstanding' RETURNING *`,
      [req.params.id, req.welfare.tenant_id],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Outstanding penalty not found" });
    await logAudit({
      user: req.user, action: "penalty_waived", entityType: "penalty_assessment",
      entityId: r.rows[0].id, description: `Penalty waived`, req,
    });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("penalty waive error:", e);
    res.status(500).json({ error: "Failed to waive penalty" });
  }
});

// POST /penalties/:id/pay — record payment; the cash grows the welfare pool.
router.post("/penalties/:id/pay", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const aRes = await query(
      `SELECT * FROM penalty_assessments WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.welfare.tenant_id],
    );
    const a = aRes.rows[0];
    if (!a) return res.status(404).json({ error: "Penalty not found" });
    if (a.status !== "outstanding") return res.status(400).json({ error: `Penalty is ${a.status}` });

    const outstanding = round2(parseFloat(a.amount) - parseFloat(a.paid_amount));
    const amt = req.body?.amount != null && req.body.amount !== "" ? parseFloat(req.body.amount) : outstanding;
    if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
    if (amt > outstanding) return res.status(400).json({ error: `Only KES ${outstanding.toLocaleString()} outstanding` });

    const newPaid = round2(parseFloat(a.paid_amount) + amt);
    const status = newPaid >= parseFloat(a.amount) ? "paid" : "outstanding";
    await query(`UPDATE penalty_assessments SET paid_amount=$2, status=$3 WHERE id=$1`, [a.id, newPaid, status]);

    // Penalty income grows the pool (not the member's savings).
    const prev = await poolBalance(req.welfare.id);
    await query(
      `INSERT INTO member_pool_transactions
         (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, description, created_by)
       VALUES ($1,$2,$3,'penalty',$4,1,$5,$6,$7)`,
      [
        req.welfare.tenant_id, req.welfare.id, a.member_id, amt, round2(prev + amt),
        `Penalty payment (assessment #${a.id})`, req.user.id,
      ],
    );
    await logAudit({
      user: req.user, action: "penalty_paid", entityType: "penalty_assessment",
      entityId: a.id, description: `Penalty payment KES ${amt}`, req,
    });
    res.json({ success: true, status, pool_balance: round2(prev + amt), outstanding: round2(parseFloat(a.amount) - newPaid) });
  } catch (e) {
    logger.error("penalty pay error:", e);
    res.status(500).json({ error: "Failed to record penalty payment" });
  }
});

export default router;
