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
import { getPlan, listActivePlans, getPlanById, createPlan, editPlan, ensureCurrentCycle, ensureCurrentCycles, ensureYearCycles, periodFor, periodsForYear } from "../services/contributionPlanService.js";
import { poolKeyForPlan, benefitPoolBalance, postBenefitPool, recordPayout, poolPayouts } from "../services/welfareBenefitPoolService.js";
import { poolBalance as savingsPoolBalance, postPool } from "../services/welfarePoolService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);
import { round2 } from "../utils/round2.js";

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

// ── named contributions (plans) ────────────────────────────────────────────
// A welfare runs SEVERAL named contributions at once (e.g. "Monthly" and
// "Quarterly"). Each is its own plan and auto-opens its own cycles; the list
// here is what the Contributions tab shows — click one to drill into it.
const planBody = (b) => ({
  name: b.name, frequency: b.frequency || "monthly", amount: b.amount, dueDay: b.due_day, dueMonth: b.due_month,
  graceDays: b.grace_days, fineCalcType: b.fine_calc_type, fineAmount: b.fine_amount, fineRate: b.fine_rate, fineCap: b.fine_cap,
  poolKind: b.pool_kind === "benefit" ? "benefit" : "savings",
});

router.get("/contribution-plans", async (req, res) => {
  try {
    try { await ensureCurrentCycles(req.welfare); } catch { /* non-fatal */ }
    const today = new Date().toISOString().slice(0, 10);
    const plans = await listActivePlans(req.welfare.id);
    const memberCount = (await query(`SELECT COUNT(*)::int n FROM members WHERE welfare_id=$1 AND status='active'`, [req.welfare.id])).rows[0].n;
    const rollup = `(SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id)::int member_count,
        (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='paid')::int paid_count,
        (SELECT COALESCE(SUM(s.amount_due),0) FROM contribution_schedules s WHERE s.cycle_id=c.id) expected,
        (SELECT COALESCE(SUM(s.amount_paid),0) FROM contribution_schedules s WHERE s.cycle_id=c.id) collected`;
    const out = [];
    for (const p of plans) {
      const cur = periodFor(p, new Date());
      const c = (await query(`SELECT c.*, ${rollup} FROM contribution_cycles c WHERE c.plan_id=$1 AND c.period_key=$2 LIMIT 1`, [p.id, cur.period_key])).rows[0];
      const ytd = (await query(`SELECT COALESCE(SUM(s.amount_paid),0) v FROM contribution_schedules s JOIN contribution_cycles c ON c.id=s.cycle_id WHERE c.plan_id=$1 AND EXTRACT(YEAR FROM c.due_date)=EXTRACT(YEAR FROM CURRENT_DATE)`, [p.id])).rows[0].v;
      const poolKey = poolKeyForPlan(p);
      const poolBalance = p.pool_kind === "benefit" ? await benefitPoolBalance(req.welfare.id, poolKey) : await savingsPoolBalance(req.welfare.id);
      out.push({
        ...p, ytd_collected: Number(ytd), pool_key: poolKey, pool_balance: poolBalance,
        current: c
          ? { cycle_id: c.id, name: c.name, due_date: new Date(c.due_date).toISOString().slice(0, 10), status: c.status, member_count: c.member_count, paid_count: c.paid_count, expected: Number(c.expected), collected: Number(c.collected) }
          : { cycle_id: null, name: cur.name, due_date: cur.due_date, status: cur.due_date > today ? "upcoming" : "unopened", member_count: memberCount, paid_count: 0, expected: Number(p.amount) * memberCount, collected: 0 },
      });
    }
    const oneoffPoolBalance = await benefitPoolBalance(req.welfare.id, "oneoff");
    const oneoffs = (await query(
      `SELECT c.id, c.name, c.due_date, c.status, c.pool_key, c.amount, c.beneficiary_member_id, m.first_name AS ben_first, m.last_name AS ben_last, ${rollup}
         FROM contribution_cycles c LEFT JOIN members m ON m.id=c.beneficiary_member_id
        WHERE c.welfare_id=$1 AND c.plan_id IS NULL ORDER BY c.due_date DESC`, [req.welfare.id]))
      .rows.map((c) => ({ ...c, due_date: new Date(c.due_date).toISOString().slice(0, 10), expected: Number(c.expected), collected: Number(c.collected), pool_balance: c.pool_key === "oneoff" ? oneoffPoolBalance : null }));
    res.json({ success: true, data: { plans: out, oneoffs, oneoff_pool_balance: oneoffPoolBalance } });
  } catch (e) {
    logger.error("contribution-plans list error:", e);
    res.status(500).json({ error: "Failed to load contributions" });
  }
});

router.post("/contribution-plans", authorize("admin", "manager"), async (req, res) => {
  try {
    const plan = await createPlan({ welfare: req.welfare, userId: req.user.id, ...planBody(req.body || {}) });
    try { await ensureCurrentCycle({ welfare: req.welfare, plan }); } catch { /* non-fatal */ }
    res.status(201).json({ success: true, data: plan });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("contribution-plan create error:", e);
    res.status(500).json({ error: "Failed to create contribution" });
  }
});

router.put("/contribution-plans/:planId", authorize("admin", "manager"), async (req, res) => {
  try {
    const plan = await editPlan({ welfare: req.welfare, planId: req.params.planId, ...planBody(req.body || {}) });
    try { await ensureCurrentCycle({ welfare: req.welfare, plan }); } catch { /* non-fatal */ }
    res.json({ success: true, data: plan });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("contribution-plan edit error:", e);
    res.status(500).json({ error: "Failed to save contribution" });
  }
});

// A payout can be handed out at a gathering — create (or reuse) the linked
// meeting (under Meetings) so attendance can be marked there, with its own
// late/absent fines. Returns the meeting id, or null.
async function gatheringMeetingId(welfare, b, userId) {
  if (b.meeting_id) return parseInt(b.meeting_id, 10);
  if (!b.gathering_title) return null;
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const m = (await query(
    `INSERT INTO group_meetings (tenant_id, group_id, title, meeting_date, fine_late, fine_absent, status, created_by)
     VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,'scheduled',$7) RETURNING id`,
    [welfare.tenant_id, welfare.id, b.gathering_title, b.gathering_date || b.txn_date || null, num(b.gathering_fine_late), num(b.gathering_fine_absent), userId || null],
  )).rows[0];
  return m.id;
}

// POST /contribution-plans/:planId/payouts — disburse a lump sum from a benefit
// pool to a member beneficiary (e.g. the quarterly dowry).
router.post("/contribution-plans/:planId/payouts", authorize("admin", "manager"), async (req, res) => {
  try {
    const plan = await getPlanById(req.welfare.id, req.params.planId);
    if (!plan) return res.status(404).json({ error: "Contribution not found" });
    if (plan.pool_kind !== "benefit") return res.status(400).json({ error: "Only benefit pools pay out — this is a savings contribution" });
    const b = req.body || {};
    const meetingId = await gatheringMeetingId(req.welfare, b, req.user.id);
    const out = await recordPayout({ welfare: req.welfare, poolKey: poolKeyForPlan(plan), beneficiaryId: b.beneficiary_member_id, amount: b.amount, meetingId, txnDate: b.txn_date, description: b.description || `Payout — ${plan.name}`, userId: req.user.id });
    await logAudit({ user: req.user, action: "contribution_payout", entityType: "group", entityId: req.welfare.id, entityCode: req.welfare.group_code, description: `Payout KES ${b.amount} from ${plan.name}`, req });
    res.status(201).json({ success: true, data: { ...out, meeting_id: meetingId } });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("contribution payout error:", e);
    res.status(500).json({ error: "Failed to record payout" });
  }
});

// POST /cycles/:cycleId/payout — disburse a one-off (emergency) to its beneficiary.
router.post("/cycles/:cycleId/payout", authorize("admin", "manager"), async (req, res) => {
  try {
    const c = (await query(`SELECT * FROM contribution_cycles WHERE id=$1 AND welfare_id=$2`, [req.params.cycleId, req.welfare.id])).rows[0];
    if (!c) return res.status(404).json({ error: "Not found" });
    if (!c.pool_key || c.pool_key === "savings") return res.status(400).json({ error: "Only benefit pools pay out" });
    const b = req.body || {};
    const meetingId = await gatheringMeetingId(req.welfare, b, req.user.id);
    const out = await recordPayout({ welfare: req.welfare, poolKey: c.pool_key, beneficiaryId: b.beneficiary_member_id || c.beneficiary_member_id, amount: b.amount, cycleId: c.id, meetingId, txnDate: b.txn_date, description: b.description || `Emergency payout — ${c.name}`, userId: req.user.id });
    res.status(201).json({ success: true, data: { ...out, meeting_id: meetingId } });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("cycle payout error:", e);
    res.status(500).json({ error: "Failed to record payout" });
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

    // The late fine is defined inline on the one-off.
    const b = req.body || {};
    const num = (v) => (v === "" || v == null ? null : parseFloat(v));
    const grace = b.grace_days != null && b.grace_days !== "" ? parseInt(b.grace_days, 10) : 0;

    // A one-off WITH a beneficiary is a benefit collection (emergency) → its own
    // shared 'oneoff' pool; otherwise it's a plain savings collection.
    const beneficiaryId = b.beneficiary_member_id ? parseInt(b.beneficiary_member_id, 10) : null;
    const poolKey = beneficiaryId || b.pool_kind === "benefit" ? "oneoff" : "savings";

    // An emergency pays its beneficiary AT CREATION — only if the pool covers it
    // (same rule as the events engine: pool balance ≥ payout, else refuse).
    const payoutAmt = beneficiaryId && b.payout_amount != null && b.payout_amount !== "" ? round2(parseFloat(b.payout_amount)) : 0;
    if (payoutAmt > 0) {
      const poolBal = await benefitPoolBalance(req.welfare.id, "oneoff");
      if (payoutAmt > poolBal) {
        const shortfall = round2(payoutAmt - poolBal);
        return res.status(400).json({ error: `The emergency pool only holds KES ${poolBal.toLocaleString()} — not enough to pay KES ${payoutAmt.toLocaleString()}. Collect KES ${shortfall.toLocaleString()} more first.` });
      }
    }

    const cycle = (
      await query(
        `INSERT INTO contribution_cycles
           (tenant_id, welfare_id, name, frequency, amount, period_start, due_date, created_by,
            grace_days, fine_calc_type, fine_amount, fine_rate, fine_cap, pool_key, beneficiary_member_id)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [req.welfare.tenant_id, req.welfare.id, name || "Contribution", freq, amt, period_start || null, due_date, req.user.id,
          grace, b.fine_calc_type || null, num(b.fine_amount), num(b.fine_rate), num(b.fine_cap), poolKey, beneficiaryId],
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

    // Disburse the benefit to the beneficiary now (pool already verified above).
    if (payoutAmt > 0) {
      await recordPayout({ welfare: req.welfare, poolKey: "oneoff", beneficiaryId, amount: payoutAmt, cycleId: cycle.id, txnDate: due_date, description: `Emergency payout — ${cycle.name}`, userId: req.user.id });
    }

    await logAudit({
      user: req.user, action: "contribution_cycle_opened", entityType: "group",
      entityId: req.welfare.id, entityCode: req.welfare.group_code,
      description: `Cycle "${cycle.name}" opened — ${n} members @ KES ${amt}${payoutAmt > 0 ? `; paid KES ${payoutAmt}` : ""}`, req,
    });
    res.status(201).json({ success: true, data: { ...cycle, member_count: n, payout: payoutAmt || null } });
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

// Build the year matrix for ONE contribution: each period (this plan's schedule
// for the year) with its cycle if opened, else projected, PLUS a per-member
// timeliness matrix aligned to those periods.
async function buildPlanOverview(welfare, plan, year) {
  const today = new Date().toISOString().slice(0, 10);
  const settingsGrace = (await query(`SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id=$1`, [welfare.tenant_id])).rows[0]?.contribution_grace_days || 0;
  const members = (await query(`SELECT id, first_name, last_name, member_no FROM members WHERE welfare_id=$1 AND status='active' ORDER BY first_name, id`, [welfare.id])).rows;
  const cycles = (await query(`SELECT * FROM contribution_cycles WHERE plan_id=$1 AND EXTRACT(YEAR FROM due_date)=$2 ORDER BY due_date`, [plan.id, year])).rows;
  const cycleIds = cycles.map((c) => c.id);
  const schedules = cycleIds.length ? (await query(`SELECT * FROM contribution_schedules WHERE cycle_id = ANY($1::int[])`, [cycleIds])).rows : [];
  const schedBy = {};
  for (const s of schedules) schedBy[`${s.cycle_id}:${s.member_id}`] = s;

  // This plan's schedule for the year, matched to opened cycles by period_key.
  const used = new Set();
  const entries = periodsForYear(plan, year).map((p) => {
    const c = cycles.find((cc) => cc.period_key === p.period_key);
    if (c) used.add(c.id);
    return { p, c };
  });
  for (const c of cycles) if (!used.has(c.id)) entries.push({ p: { period_key: c.period_key || `c${c.id}`, due_date: new Date(c.due_date).toISOString().slice(0, 10), name: c.name, short: MONTHS[new Date(c.due_date).getMonth()].slice(0, 3) }, c });
  entries.sort((a, b) => new Date(a.p.due_date) - new Date(b.p.due_date));

  const periods = entries.map(({ p, c }) => {
    if (c) {
      const cs = schedules.filter((s) => s.cycle_id === c.id);
      return {
        key: p.period_key, name: c.name || p.name, short: p.short, due_date: new Date(c.due_date).toISOString().slice(0, 10),
        cycle_id: c.id, opened: true, status: c.status,
        expected: cs.reduce((a, s) => a + Number(s.amount_due), 0), collected: cs.reduce((a, s) => a + Number(s.amount_paid), 0),
        paid_count: cs.filter((s) => s.status === "paid").length, member_count: cs.length,
      };
    }
    return {
      key: p.period_key, name: p.name, short: p.short, due_date: p.due_date, cycle_id: null, opened: false,
      status: p.due_date > today ? "upcoming" : "unopened",
      expected: Number(plan.amount) * members.length, collected: 0, paid_count: 0, member_count: members.length,
    };
  });

  // Late fines raised against each member for this contribution's cycles.
  const fineByMember = {};
  if (cycleIds.length) {
    (await query(
      `SELECT s.member_id, COALESCE(SUM(pa.amount),0) AS fined, COALESCE(SUM(pa.amount - pa.paid_amount),0) AS outstanding
         FROM penalty_assessments pa JOIN contribution_schedules s ON s.id = pa.source_id
        WHERE pa.source_type='contribution_schedule' AND s.cycle_id = ANY($1::int[])
        GROUP BY s.member_id`,
      [cycleIds],
    )).rows.forEach((r) => { fineByMember[r.member_id] = { fined: Number(r.fined), outstanding: Number(r.outstanding) }; });
  }

  const membersOut = members.map((mem) => {
    const cells = entries.map(({ p, c }) => {
      const grace = c ? (c.grace_days != null ? c.grace_days : settingsGrace) : (plan.grace_days ?? settingsGrace);
      return cellFor(c ? schedBy[`${c.id}:${mem.id}`] : null, p.due_date, grace, today);
    });
    return {
      ...mem, cells, total_paid: cells.reduce((a, cell) => a + (cell.paid || 0), 0),
      fines: fineByMember[mem.id]?.fined || 0, fines_outstanding: fineByMember[mem.id]?.outstanding || 0,
    };
  });
  // Pool: monthly = the savings pool; benefit = its own ledger + payouts.
  const poolKey = poolKeyForPlan(plan);
  const pool = plan.pool_kind === "benefit"
    ? { key: poolKey, kind: "benefit", balance: await benefitPoolBalance(welfare.id, poolKey), payouts: await poolPayouts(welfare.id, poolKey) }
    : { key: "savings", kind: "savings", balance: await savingsPoolBalance(welfare.id), payouts: [] };
  return { year, plan, pool, periods, members: membersOut };
}

// GET /contribution-plans/:planId/overview?year= — one contribution's year matrix.
router.get("/contribution-plans/:planId/overview", async (req, res) => {
  try {
    const plan = await getPlanById(req.welfare.id, req.params.planId);
    if (!plan) return res.status(404).json({ error: "Contribution not found" });
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    // Quarterly: open every quarter of the year so members can prepay the whole
    // year at once; other frequencies just open the current period.
    try {
      if (plan.frequency === "quarterly") await ensureYearCycles(req.welfare, plan, year);
      else await ensureCurrentCycle({ welfare: req.welfare, plan });
    } catch { /* non-fatal */ }
    res.json({ success: true, data: await buildPlanOverview(req.welfare, plan, year) });
  } catch (e) {
    logger.error("contribution overview error:", e);
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
              COALESCE((SELECT SUM(pa.amount) FROM penalty_assessments pa WHERE pa.source_type='contribution_schedule' AND pa.source_id=s.id),0) AS fine,
              COALESCE((SELECT SUM(pa.amount - pa.paid_amount) FROM penalty_assessments pa WHERE pa.source_type='contribution_schedule' AND pa.source_id=s.id AND pa.status='outstanding'),0) AS fine_outstanding,
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
    // For a benefit one-off (emergency): what the beneficiary received (the
    // payout handed out for THIS emergency), what members have collected toward
    // it, and the remaining deficit to be collected.
    const received = Number((await query(`SELECT COALESCE(SUM(amount),0) v FROM benefit_pool_ledger WHERE cycle_id=$1 AND type='payout'`, [c.id])).rows[0].v);
    const collected = schedules.rows.reduce((a, s) => a + Number(s.amount_paid), 0);
    const deficit = Math.max(0, Math.round((received - collected) * 100) / 100);
    res.json({ success: true, data: { cycle: { ...c, effective_grace: grace, received, collected, deficit }, schedules: schedules.rows } });
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
        `SELECT s.*, c.pool_key, c.name AS cycle_name FROM contribution_schedules s
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

      // Route the cash to the cycle's pool. Savings (monthly) grows member equity
      // in the savings pool; benefit pools (quarterly/emergency) get their own ledger.
      let poolAfter;
      if (s.pool_key && s.pool_key !== "savings") {
        const led = await postBenefitPool({ welfare: req.welfare, poolKey: s.pool_key, memberId: s.member_id, type: "contribution", cycleId: s.cycle_id, amount: amt, direction: 1, description: `Contribution — ${s.cycle_name}`, userId: req.user.id });
        poolAfter = Number(led.balance_after);
      } else {
        const tx = await postPool({ welfare: req.welfare, memberId: s.member_id, type: "contribution", amount: amt, direction: 1, description: `Contribution (cycle #${s.cycle_id})`, userId: req.user.id });
        poolAfter = Number(tx.balance_after);
      }
      // Best-effort receipt SMS (no-op when SMS is disabled).
      notifyContributionReceipt({ welfare: req.welfare, memberId: s.member_id, amount: amt, sentBy: req.user.id });

      res.json({ success: true, status, pool_balance: poolAfter, outstanding: round2(parseFloat(s.amount_due) - newPaid) });
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
