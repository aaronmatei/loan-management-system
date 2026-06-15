// Welfare contribution cycles + schedules. Mounted at /api/welfares/:welfareId.
// Opening a cycle generates a per-member schedule; payments allocate against a
// schedule and post into the pool as savings. Overdue schedules feed the
// penalty engine via accrueContributionPenalties.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { accrueContributionPenalties } from "../services/welfarePenaltyAccrual.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (contrib) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function poolBalance(welfareId) {
  const r = await query(
    `SELECT balance_after FROM member_pool_transactions WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfareId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// GET /cycles — list with collection rollup.
router.get("/cycles", async (req, res) => {
  try {
    const r = await query(
      `SELECT c.*,
          (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id = c.id)::int AS member_count,
          (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id = c.id AND s.status = 'paid')::int AS paid_count,
          (SELECT COALESCE(SUM(s.amount_due),0) FROM contribution_schedules s WHERE s.cycle_id = c.id) AS expected,
          (SELECT COALESCE(SUM(s.amount_paid),0) FROM contribution_schedules s WHERE s.cycle_id = c.id) AS collected
        FROM contribution_cycles c
        WHERE c.welfare_id = $1
        ORDER BY c.due_date DESC, c.id DESC`,
      [req.welfare.id],
    );
    res.json({
      success: true,
      data: r.rows.map((c) => ({ ...c, expected: Number(c.expected), collected: Number(c.collected) })),
    });
  } catch (e) {
    logger.error("cycles list error:", e);
    res.status(500).json({ error: "Failed to load cycles" });
  }
});

// POST /cycles — open a cycle and generate a schedule for every active member.
router.post("/cycles", authorize("admin", "manager"), async (req, res) => {
  try {
    const { name, amount, due_date, frequency, period_start } = req.body || {};
    if (!due_date) return res.status(400).json({ error: "Due date is required" });

    const settings = (await query(`SELECT * FROM welfare_settings WHERE tenant_id = $1`, [req.welfare.tenant_id])).rows[0];
    const amt = amount != null && amount !== "" ? parseFloat(amount)
      : settings?.contribution_amount != null ? parseFloat(settings.contribution_amount) : null;
    if (!(amt > 0)) return res.status(400).json({ error: "A positive contribution amount is required (set one here or in settings)" });
    const freq = frequency || settings?.contribution_frequency || "monthly";

    const cycle = (
      await query(
        `INSERT INTO contribution_cycles (tenant_id, welfare_id, name, frequency, amount, period_start, due_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8) RETURNING *`,
        [req.welfare.tenant_id, req.welfare.id, name || "Contribution", freq, amt, period_start || null, due_date, req.user.id],
      )
    ).rows[0];

    // One schedule per active member.
    await query(
      `INSERT INTO contribution_schedules (tenant_id, cycle_id, member_id, amount_due, due_date)
         SELECT $1, $2, m.id, $3, $4::date
           FROM members m
          WHERE m.welfare_id = $5 AND m.status = 'active'`,
      [req.welfare.tenant_id, cycle.id, amt, due_date, req.welfare.id],
    );
    const n = (await query(`SELECT COUNT(*)::int AS n FROM contribution_schedules WHERE cycle_id = $1`, [cycle.id])).rows[0].n;

    await logAudit({
      user: req.user, action: "contribution_cycle_opened", entityType: "group",
      entityId: req.welfare.id, entityCode: req.welfare.group_code,
      description: `Cycle "${cycle.name}" opened — ${n} members @ KES ${amt}`, req,
    });
    res.status(201).json({ success: true, data: { ...cycle, member_count: n } });
  } catch (e) {
    logger.error("cycle create error:", e);
    res.status(500).json({ error: "Failed to open cycle" });
  }
});

// GET /cycles/:cycleId — cycle + schedules.
router.get("/cycles/:cycleId", async (req, res) => {
  try {
    const c = (await query(`SELECT * FROM contribution_cycles WHERE id = $1 AND welfare_id = $2`, [req.params.cycleId, req.welfare.id])).rows[0];
    if (!c) return res.status(404).json({ error: "Cycle not found" });
    const schedules = await query(
      `SELECT s.*, m.first_name, m.last_name, m.member_no,
              GREATEST(s.amount_due - s.amount_paid, 0) AS balance
         FROM contribution_schedules s
         JOIN members m ON m.id = s.member_id
        WHERE s.cycle_id = $1
        ORDER BY m.first_name`,
      [c.id],
    );
    res.json({ success: true, data: { cycle: c, schedules: schedules.rows } });
  } catch (e) {
    logger.error("cycle get error:", e);
    res.status(500).json({ error: "Failed to load cycle" });
  }
});

// POST /cycles/:cycleId/close
router.post("/cycles/:cycleId/close", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await query(
      `UPDATE contribution_cycles SET status='closed', updated_at=NOW() WHERE id=$1 AND welfare_id=$2 RETURNING *`,
      [req.params.cycleId, req.welfare.id],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Cycle not found" });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("cycle close error:", e);
    res.status(500).json({ error: "Failed to close cycle" });
  }
});

// POST /cycles/:cycleId/schedules/:scheduleId/pay — record a contribution.
router.post(
  "/cycles/:cycleId/schedules/:scheduleId/pay",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const sRes = await query(
        `SELECT s.* FROM contribution_schedules s
           JOIN contribution_cycles c ON c.id = s.cycle_id
          WHERE s.id = $1 AND s.cycle_id = $2 AND c.welfare_id = $3`,
        [req.params.scheduleId, req.params.cycleId, req.welfare.id],
      );
      const s = sRes.rows[0];
      if (!s) return res.status(404).json({ error: "Schedule not found" });
      if (s.status === "paid") return res.status(400).json({ error: "Already fully paid" });

      const outstanding = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
      const amt = req.body?.amount != null && req.body.amount !== "" ? parseFloat(req.body.amount) : outstanding;
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      if (amt > outstanding) return res.status(400).json({ error: `Only KES ${outstanding.toLocaleString()} outstanding` });

      const newPaid = round2(parseFloat(s.amount_paid) + amt);
      const status = newPaid >= parseFloat(s.amount_due) ? "paid" : "partial";
      await query(`UPDATE contribution_schedules SET amount_paid=$2, status=$3, updated_at=NOW() WHERE id=$1`, [s.id, newPaid, status]);

      // Contribution grows the member's savings + the pool.
      const prev = await poolBalance(req.welfare.id);
      await query(
        `INSERT INTO member_pool_transactions
           (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, description, created_by)
         VALUES ($1,$2,$3,'contribution',$4,1,$5,$6,$7)`,
        [req.welfare.tenant_id, req.welfare.id, s.member_id, amt, round2(prev + amt), `Contribution (cycle #${s.cycle_id})`, req.user.id],
      );
      res.json({ success: true, status, pool_balance: round2(prev + amt), outstanding: round2(parseFloat(s.amount_due) - newPaid) });
    } catch (e) {
      logger.error("schedule pay error:", e);
      res.status(500).json({ error: "Failed to record contribution" });
    }
  },
);

// POST /cycles/:cycleId/assess-late — run late-contribution penalty accrual.
router.post("/cycles/:cycleId/assess-late", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await accrueContributionPenalties(req.welfare.tenant_id);
    res.json({ success: true, ...r });
  } catch (e) {
    logger.error("assess-late error:", e);
    res.status(500).json({ error: "Failed to assess late penalties" });
  }
});

export default router;
