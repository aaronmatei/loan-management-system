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
import { notifyContributionReceipt } from "../services/welfareSmsService.js";
import { getPlan, upsertPlan, ensureCurrentCycles } from "../services/contributionPlanService.js";
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

// GET/PUT the recurring contribution plan (set the monthly contribution once).
router.get("/contribution-plan", async (req, res) => {
  try {
    res.json({ success: true, data: await getPlan(req.welfare.id) });
  } catch (e) {
    logger.error("contribution-plan get error:", e);
    res.status(500).json({ error: "Failed to load plan" });
  }
});
router.put("/contribution-plan", authorize("admin", "manager"), async (req, res) => {
  try {
    const b = req.body || {};
    const plan = await upsertPlan({
      welfare: req.welfare, name: b.name, amount: b.amount, dueDay: b.due_day,
      graceDays: b.grace_days, fineCalcType: b.fine_calc_type, fineAmount: b.fine_amount,
      fineRate: b.fine_rate, fineCap: b.fine_cap, active: b.active !== false, userId: req.user.id,
    });
    // Open the current period right away so it shows immediately.
    await ensureCurrentCycles(req.welfare);
    res.json({ success: true, data: plan });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("contribution-plan save error:", e);
    res.status(500).json({ error: "Failed to save plan" });
  }
});

// GET /cycles?year=YYYY — lazily auto-opens the current period from the plan,
// then lists that year's cycles with collection rollups.
router.get("/cycles", async (req, res) => {
  try {
    try { await ensureCurrentCycles(req.welfare); } catch { /* non-fatal */ }
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const r = await query(
      `SELECT c.*,
          (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id = c.id)::int AS member_count,
          (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id = c.id AND s.status = 'paid')::int AS paid_count,
          (SELECT COALESCE(SUM(s.amount_due),0) FROM contribution_schedules s WHERE s.cycle_id = c.id) AS expected,
          (SELECT COALESCE(SUM(s.amount_paid),0) FROM contribution_schedules s WHERE s.cycle_id = c.id) AS collected
        FROM contribution_cycles c
        WHERE c.welfare_id = $1 AND EXTRACT(YEAR FROM c.due_date) = $2
        ORDER BY c.due_date DESC, c.id DESC`,
      [req.welfare.id, year],
    );
    res.json({
      success: true,
      year,
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

    // Per-cycle fine rule — from the body, defaulting to the welfare's plan.
    const b = req.body || {};
    const plan = await getPlan(req.welfare.id, freq);
    const num = (v, d) => (v === "" || v == null ? d : parseFloat(v));
    const fine = {
      grace_days: b.grace_days != null && b.grace_days !== "" ? parseInt(b.grace_days, 10) : plan?.grace_days ?? null,
      calc_type: b.fine_calc_type || plan?.fine_calc_type || null,
      amount: num(b.fine_amount, plan?.fine_amount ?? null),
      rate: num(b.fine_rate, plan?.fine_rate ?? null),
      cap: num(b.fine_cap, plan?.fine_cap ?? null),
    };

    const cycle = (
      await query(
        `INSERT INTO contribution_cycles
           (tenant_id, welfare_id, name, frequency, amount, period_start, due_date, created_by,
            grace_days, fine_calc_type, fine_amount, fine_rate, fine_cap)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [req.welfare.tenant_id, req.welfare.id, name || "Contribution", freq, amt, period_start || null, due_date, req.user.id,
          fine.grace_days, fine.calc_type, fine.amount, fine.rate, fine.cap],
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n) => String(n).padStart(2, "0");

// Per-member timeliness for one (schedule, cycle) — mirrors the cycle detail.
function cellFor(s, dueStr, grace, today) {
  if (!s) return { status: dueStr > today ? "upcoming" : "none" };
  const graceDate = new Date(new Date(dueStr).getTime() + grace * 86400000).toISOString().slice(0, 10);
  const paid = Number(s.amount_paid);
  if (s.status === "paid") {
    const at = s.paid_at ? new Date(s.paid_at).toISOString().slice(0, 10) : null;
    return { status: "paid", paid, on_time: at ? at <= graceDate : null, late_days: at ? Math.max(0, Math.round((new Date(at) - new Date(graceDate)) / 86400000)) : 0 };
  }
  const overdue = today > graceDate ? Math.round((new Date(today) - new Date(graceDate)) / 86400000) : 0;
  return { status: paid > 0 ? "partial" : "pending", paid, days_late: overdue };
}

// GET /contributions/overview?year=YYYY — the whole year (Jan–Dec): each month's
// cycle if opened, else projected from the plan, PLUS a per-member matrix.
router.get("/contributions/overview", async (req, res) => {
  try {
    try { await ensureCurrentCycles(req.welfare); } catch { /* non-fatal */ }
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);
    const plan = await getPlan(req.welfare.id);
    const dueDay = Math.min(plan?.due_day || 10, 28);
    const settingsGrace = (await query(`SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id=$1`, [req.welfare.tenant_id])).rows[0]?.contribution_grace_days || 0;

    const members = (await query(`SELECT id, first_name, last_name, member_no FROM members WHERE welfare_id=$1 AND status='active' ORDER BY first_name, id`, [req.welfare.id])).rows;
    const cycles = (await query(`SELECT * FROM contribution_cycles WHERE welfare_id=$1 AND EXTRACT(YEAR FROM due_date)=$2 ORDER BY due_date`, [req.welfare.id, year])).rows;
    const cycleIds = cycles.map((c) => c.id);
    const schedules = cycleIds.length
      ? (await query(`SELECT * FROM contribution_schedules WHERE cycle_id = ANY($1::int[])`, [cycleIds])).rows
      : [];

    const cycleByMonth = {};
    for (const c of cycles) cycleByMonth[new Date(c.due_date).getMonth() + 1] = c;
    const schedBy = {};
    for (const s of schedules) schedBy[`${s.cycle_id}:${s.member_id}`] = s;

    const months = [];
    const matrix = {}; // member_id -> { month -> cell }
    for (const mem of members) matrix[mem.id] = {};
    for (let m = 1; m <= 12; m++) {
      const c = cycleByMonth[m];
      const due = c ? new Date(c.due_date).toISOString().slice(0, 10) : `${year}-${pad2(m)}-${pad2(dueDay)}`;
      const grace = c ? (c.grace_days != null ? c.grace_days : settingsGrace) : (plan?.grace_days ?? settingsGrace);
      if (c) {
        const cs = schedules.filter((s) => s.cycle_id === c.id);
        months.push({
          month: m, name: MONTHS[m - 1], due_date: due, cycle_id: c.id, opened: true, label: c.name, status: c.status,
          expected: cs.reduce((a, s) => a + Number(s.amount_due), 0),
          collected: cs.reduce((a, s) => a + Number(s.amount_paid), 0),
          paid_count: cs.filter((s) => s.status === "paid").length, member_count: cs.length,
        });
      } else {
        months.push({
          month: m, name: MONTHS[m - 1], due_date: due, cycle_id: null, opened: false,
          status: due > today ? "upcoming" : "unopened",
          expected: plan ? Number(plan.amount) * members.length : 0, collected: 0, paid_count: 0, member_count: members.length,
        });
      }
      for (const mem of members) matrix[mem.id][m] = cellFor(c ? schedBy[`${c.id}:${mem.id}`] : null, due, grace, today);
    }
    const membersOut = members.map((mem) => ({
      ...mem,
      total_paid: Object.values(matrix[mem.id]).reduce((a, cell) => a + (cell.paid || 0), 0),
      months: matrix[mem.id],
    }));
    res.json({ success: true, data: { year, plan, months, members: membersOut } });
  } catch (e) {
    logger.error("contributions overview error:", e);
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// GET /cycles/:cycleId — cycle + schedules.
router.get("/cycles/:cycleId", async (req, res) => {
  try {
    const c = (await query(`SELECT * FROM contribution_cycles WHERE id = $1 AND welfare_id = $2`, [req.params.cycleId, req.welfare.id])).rows[0];
    if (!c) return res.status(404).json({ error: "Cycle not found" });
    // Grace: the cycle's own, else the welfare default.
    const settingsGrace = (await query(`SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id = $1`, [req.welfare.tenant_id])).rows[0]?.contribution_grace_days || 0;
    const grace = c.grace_days != null ? c.grace_days : settingsGrace;
    // days_overdue: how late an UNPAID/partial member is now (0 if within grace
    // or paid). paid_on_time / paid_late_days: timeliness for those who've paid.
    const schedules = await query(
      `SELECT s.*, m.first_name, m.last_name, m.member_no,
              GREATEST(s.amount_due - s.amount_paid, 0) AS balance,
              CASE WHEN s.status = 'paid' THEN 0
                   ELSE GREATEST(0, CURRENT_DATE - (s.due_date + ($2 * INTERVAL '1 day'))::date) END AS days_overdue,
              CASE WHEN s.status = 'paid' AND s.paid_at IS NOT NULL
                   THEN s.paid_at::date <= (s.due_date + ($2 * INTERVAL '1 day'))::date END AS paid_on_time,
              CASE WHEN s.status = 'paid' AND s.paid_at IS NOT NULL
                   THEN GREATEST(0, s.paid_at::date - (s.due_date + ($2 * INTERVAL '1 day'))::date) ELSE 0 END AS paid_late_days
         FROM contribution_schedules s
         JOIN members m ON m.id = s.member_id
        WHERE s.cycle_id = $1
        ORDER BY m.first_name`,
      [c.id, grace],
    );
    res.json({ success: true, data: { cycle: { ...c, effective_grace: grace }, schedules: schedules.rows } });
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
      await query(
        `UPDATE contribution_schedules
            SET amount_paid=$2, status=$3,
                paid_at = CASE WHEN $4 AND paid_at IS NULL THEN NOW() ELSE paid_at END,
                updated_at=NOW()
          WHERE id=$1`,
        [s.id, newPaid, status, status === "paid"],
      );

      // Contribution grows the member's savings + the pool.
      const prev = await poolBalance(req.welfare.id);
      await query(
        `INSERT INTO member_pool_transactions
           (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, description, created_by)
         VALUES ($1,$2,$3,'contribution',$4,1,$5,$6,$7)`,
        [req.welfare.tenant_id, req.welfare.id, s.member_id, amt, round2(prev + amt), `Contribution (cycle #${s.cycle_id})`, req.user.id],
      );
      // Best-effort receipt SMS (no-op when SMS is disabled).
      notifyContributionReceipt({ welfare: req.welfare, memberId: s.member_id, amount: amt, sentBy: req.user.id });

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
