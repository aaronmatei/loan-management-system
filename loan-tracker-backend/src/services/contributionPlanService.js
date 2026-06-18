// Recurring contribution plans: set the monthly contribution once (amount, due
// day, fine rule) and the period's cycle auto-opens — lazily when the admin
// opens the Contributions tab, and via the daily cron. Each opened cycle copies
// the plan's fine rule so fines are configured per-cycle (defaulted from the plan).
import { query } from "../config/database.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const httpErr = (status, message) => Object.assign(new Error(message), { status });

export async function getPlan(welfareId, frequency = "monthly") {
  const r = await query(
    `SELECT * FROM contribution_plans WHERE welfare_id = $1 AND frequency = $2 AND active = true ORDER BY id DESC LIMIT 1`,
    [welfareId, frequency],
  );
  return r.rows[0] || null;
}

// Create or update the (one active) plan for a welfare + frequency.
export async function upsertPlan({ welfare, frequency = "monthly", name, amount, dueDay, graceDays, fineCalcType, fineAmount, fineRate, fineCap, active = true, userId }) {
  const amt = parseFloat(amount);
  if (!(amt > 0)) throw httpErr(400, "A positive amount is required");
  const day = Math.min(Math.max(parseInt(dueDay, 10) || 1, 1), 31);
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const existing = await getPlan(welfare.id, frequency);
  const vals = [name || "Monthly contribution", amt, day, parseInt(graceDays, 10) || 0, fineCalcType || null, num(fineAmount), num(fineRate), num(fineCap), !!active];
  if (existing) {
    const r = await query(
      `UPDATE contribution_plans
          SET name=$2, amount=$3, due_day=$4, grace_days=$5, fine_calc_type=$6, fine_amount=$7, fine_rate=$8, fine_cap=$9, active=$10, updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [existing.id, ...vals],
    );
    return r.rows[0];
  }
  const r = await query(
    `INSERT INTO contribution_plans (tenant_id, welfare_id, name, frequency, amount, due_day, grace_days, fine_calc_type, fine_amount, fine_rate, fine_cap, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [welfare.tenant_id, welfare.id, vals[0], frequency, vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8], userId || null],
  );
  return r.rows[0];
}

// The plan's current period (monthly) relative to `ref`.
function monthlyPeriod(plan, ref) {
  const y = ref.getFullYear();
  const m = ref.getMonth(); // 0-based
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const day = Math.min(plan.due_day || 10, daysInMonth);
  const mm = String(m + 1).padStart(2, "0");
  return {
    period_key: `${y}-${mm}`,
    period_start: `${y}-${mm}-01`,
    due_date: `${y}-${mm}-${String(day).padStart(2, "0")}`,
    name: `${MONTHS[m]} ${y}`,
  };
}

// Ensure the plan's current-period cycle exists (idempotent). Returns it.
export async function ensureCurrentCycle({ welfare, plan, ref = new Date() }) {
  if (!plan || !plan.active || plan.frequency !== "monthly") return null;
  const p = monthlyPeriod(plan, ref);
  const find = async () =>
    (await query(`SELECT * FROM contribution_cycles WHERE plan_id=$1 AND period_key=$2`, [plan.id, p.period_key])).rows[0];

  const existing = await find();
  if (existing) return existing;

  let cycle;
  try {
    cycle = (
      await query(
        `INSERT INTO contribution_cycles
           (tenant_id, welfare_id, name, frequency, amount, period_start, due_date, category, plan_id, period_key,
            grace_days, fine_calc_type, fine_amount, fine_rate, fine_cap, created_by)
         VALUES ($1,$2,$3,'monthly',$4,$5::date,$6::date,'savings',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [welfare.tenant_id, welfare.id, p.name, plan.amount, p.period_start, p.due_date, plan.id, p.period_key,
          plan.grace_days, plan.fine_calc_type, plan.fine_amount, plan.fine_rate, plan.fine_cap, plan.created_by || null],
      )
    ).rows[0];
  } catch (e) {
    if (e.code === "23505") return await find(); // raced — another opener won
    throw e;
  }
  await query(
    `INSERT INTO contribution_schedules (tenant_id, cycle_id, member_id, amount_due, due_date)
       SELECT $1, $2, m.id, $3, $4::date FROM members m WHERE m.welfare_id = $5 AND m.status = 'active'`,
    [welfare.tenant_id, cycle.id, plan.amount, p.due_date, welfare.id],
  );
  return cycle;
}

// Open the current cycle for every active plan of a welfare.
export async function ensureCurrentCycles(welfare, ref = new Date()) {
  const plans = (await query(`SELECT * FROM contribution_plans WHERE welfare_id = $1 AND active = true`, [welfare.id])).rows;
  const opened = [];
  for (const plan of plans) {
    const c = await ensureCurrentCycle({ welfare, plan, ref });
    if (c) opened.push(c);
  }
  return opened;
}

// Daily cron entry point — every active welfare.
export async function openDueCyclesForAllWelfares(ref = new Date()) {
  const welfares = (
    await query(`SELECT g.id, g.tenant_id, g.group_code FROM groups g JOIN tenants t ON t.id = g.tenant_id WHERE t.kind = 'welfare' AND t.status = 'active'`)
  ).rows;
  let opened = 0;
  for (const w of welfares) {
    try { opened += (await ensureCurrentCycles(w, ref)).length; } catch { /* one chama failing shouldn't stop the rest */ }
  }
  return { welfares: welfares.length, opened };
}
