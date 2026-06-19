// Recurring contribution plans: set the monthly contribution once (amount, due
// day, fine rule) and the period's cycle auto-opens — lazily when the admin
// opens the Contributions tab, and via the daily cron. Each opened cycle copies
// the plan's fine rule so fines are configured per-cycle (defaulted from the plan).
import { query } from "../config/database.js";
import { poolKeyForPlan } from "./welfareBenefitPoolService.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const httpErr = (status, message) => Object.assign(new Error(message), { status });

export async function getPlan(welfareId, frequency = "monthly") {
  const r = await query(
    `SELECT * FROM contribution_plans WHERE welfare_id = $1 AND frequency = $2 AND active = true ORDER BY id DESC LIMIT 1`,
    [welfareId, frequency],
  );
  return r.rows[0] || null;
}

// The welfare's single active plan, whatever its frequency.
export async function getActivePlan(welfareId) {
  const r = await query(`SELECT * FROM contribution_plans WHERE welfare_id = $1 AND active = true ORDER BY id DESC LIMIT 1`, [welfareId]);
  return r.rows[0] || null;
}

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];

// All active named contributions for a welfare (it runs several at once).
export async function listActivePlans(welfareId) {
  return (await query(`SELECT * FROM contribution_plans WHERE welfare_id=$1 AND active=true ORDER BY id`, [welfareId])).rows;
}
export async function getPlanById(welfareId, planId) {
  return (await query(`SELECT * FROM contribution_plans WHERE id=$1 AND welfare_id=$2`, [planId, welfareId])).rows[0] || null;
}

// Normalise + validate a plan's fields. The late fine is defined INLINE on the
// contribution (charge type + amount/rate/cap + grace) — no shared rules.
function planFields({ frequency = "monthly", name, amount, dueDay, dueMonth, graceDays, fineCalcType, fineAmount, fineRate, fineCap, poolKind }) {
  if (!FREQUENCIES.includes(frequency)) throw httpErr(400, "Unsupported frequency");
  const amt = parseFloat(amount);
  if (!(amt > 0)) throw httpErr(400, "A positive amount is required");
  const nm = (name || "").trim();
  if (!nm) throw httpErr(400, "Give the contribution a name");
  // due_day means weekday (1=Mon..7=Sun) for weekly/biweekly, else day-of-month.
  const maxDay = ["weekly", "biweekly"].includes(frequency) ? 7 : 31;
  const day = Math.min(Math.max(parseInt(dueDay, 10) || 1, 1), maxDay);
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  return {
    name: nm, frequency, amount: amt, due_day: day,
    due_month: frequency === "yearly" ? Math.min(Math.max(parseInt(dueMonth, 10) || 12, 1), 12) : null,
    grace_days: parseInt(graceDays, 10) || 0,
    fine_calc_type: fineCalcType || null, fine_amount: num(fineAmount), fine_rate: num(fineRate), fine_cap: num(fineCap),
    pool_kind: poolKind === "benefit" ? "benefit" : "savings",
  };
}
const dupErr = (name) => httpErr(409, `A contribution named "${name}" already exists`);

export async function createPlan({ welfare, userId, ...rest }) {
  const f = planFields(rest);
  try {
    const r = await query(
      `INSERT INTO contribution_plans (tenant_id, welfare_id, name, frequency, amount, due_day, due_month, grace_days, fine_calc_type, fine_amount, fine_rate, fine_cap, pool_kind, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14) RETURNING *`,
      [welfare.tenant_id, welfare.id, f.name, f.frequency, f.amount, f.due_day, f.due_month, f.grace_days, f.fine_calc_type, f.fine_amount, f.fine_rate, f.fine_cap, f.pool_kind, userId || null],
    );
    return r.rows[0];
  } catch (e) { if (e.code === "23505") throw dupErr(f.name); throw e; }
}
export async function editPlan({ welfare, planId, ...rest }) {
  const existing = await getPlanById(welfare.id, planId);
  if (!existing) throw httpErr(404, "Contribution not found");
  // pool_kind can't flip once a pool has activity, so keep the existing kind.
  const f = planFields({ frequency: existing.frequency, poolKind: existing.pool_kind, ...rest });
  try {
    const r = await query(
      `UPDATE contribution_plans SET name=$2, frequency=$3, amount=$4, due_day=$5, due_month=$6, grace_days=$7, fine_calc_type=$8, fine_amount=$9, fine_rate=$10, fine_cap=$11, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [planId, f.name, f.frequency, f.amount, f.due_day, f.due_month, f.grace_days, f.fine_calc_type, f.fine_amount, f.fine_rate, f.fine_cap],
    );
    return r.rows[0];
  } catch (e) { if (e.code === "23505") throw dupErr(f.name); throw e; }
}

// ── period math, per frequency ─────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (b, n) => new Date(b.getFullYear(), b.getMonth(), b.getDate() + n);
const dim = (y, m0) => new Date(y, m0 + 1, 0).getDate();
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7)); // Monday-start week
const anchorMonday = (y) => mondayOf(new Date(y, 0, 4)); // Monday of ISO week 1
const weekIndex = (d, y) => Math.round((mondayOf(d) - anchorMonday(y)) / (7 * 86400000));

function monthlyPeriod(plan, ref) {
  const y = ref.getFullYear(), m = ref.getMonth();
  const day = Math.min(plan.due_day || 10, dim(y, m));
  return { period_key: `${y}-${pad(m + 1)}`, period_start: `${y}-${pad(m + 1)}-01`, due_date: `${y}-${pad(m + 1)}-${pad(day)}`, name: `${MONTHS[m]} ${y}`, short: MONTH_ABBR[m] };
}
function quarterlyPeriod(plan, ref) {
  const y = ref.getFullYear(), q = Math.floor(ref.getMonth() / 3), m3 = q * 3 + 2;
  const day = Math.min(plan.due_day || 10, dim(y, m3));
  return { period_key: `${y}-Q${q + 1}`, period_start: `${y}-${pad(q * 3 + 1)}-01`, due_date: `${y}-${pad(m3 + 1)}-${pad(day)}`, name: `Q${q + 1} ${y}`, short: `Q${q + 1}` };
}
function yearlyPeriod(plan, ref) {
  const y = ref.getFullYear(), m = (plan.due_month || 12) - 1;
  const day = Math.min(plan.due_day || 1, dim(y, m));
  return { period_key: `${y}-Y`, period_start: `${y}-01-01`, due_date: `${y}-${pad(m + 1)}-${pad(day)}`, name: `${y}`, short: `${y}` };
}
function weeklyPeriod(plan, ref) {
  const y = ref.getFullYear();
  const wi = weekIndex(ref, y);
  const due = addDays(mondayOf(ref), (plan.due_day || 1) - 1); // 1=Mon..7=Sun
  return { period_key: `${y}-W${pad(wi + 1)}`, period_start: ymd(mondayOf(ref)), due_date: ymd(due), name: `Week ${wi + 1}, ${y}`, short: `W${wi + 1}` };
}
function biweeklyPeriod(plan, ref) {
  const y = ref.getFullYear();
  const block = Math.floor(weekIndex(ref, y) / 2);
  const due = addDays(anchorMonday(y), (block * 2 + 1) * 7 + (plan.due_day || 1) - 1); // 2nd week's weekday
  return { period_key: `${y}-B${pad(block + 1)}`, period_start: ymd(addDays(anchorMonday(y), block * 2 * 7)), due_date: ymd(due), name: `Period ${block + 1}, ${y}`, short: `P${block + 1}` };
}
export function periodFor(plan, ref) {
  if (!plan) return monthlyPeriod({ due_day: 1 }, ref);
  switch (plan.frequency) {
    case "weekly": return weeklyPeriod(plan, ref);
    case "biweekly": return biweeklyPeriod(plan, ref);
    case "quarterly": return quarterlyPeriod(plan, ref);
    case "yearly": return yearlyPeriod(plan, ref);
    default: return monthlyPeriod(plan, ref);
  }
}

// Enumerate the periods of `year` for the overview, in order.
export function periodsForYear(plan, year) {
  const f = plan?.frequency || "monthly";
  if (f === "monthly" || !plan) { const p = plan || { due_day: 1 }; return Array.from({ length: 12 }, (_, m) => monthlyPeriod(p, new Date(year, m, 15))); }
  if (f === "quarterly") return Array.from({ length: 4 }, (_, q) => quarterlyPeriod(plan, new Date(year, q * 3 + 1, 15)));
  if (f === "yearly") return [yearlyPeriod(plan, new Date(year, 5, 15))];
  const out = [], seen = new Set();
  for (let d = new Date(year, 0, 1); d <= new Date(year, 11, 31); d = addDays(d, f === "weekly" ? 7 : 14)) {
    const p = periodFor(plan, d);
    if (!seen.has(p.period_key) && new Date(p.due_date).getFullYear() === year) { seen.add(p.period_key); out.push(p); }
  }
  return out;
}

// Ensure the plan's current-period cycle exists (idempotent). Returns it.
export async function ensureCurrentCycle({ welfare, plan, ref = new Date() }) {
  if (!plan || !plan.active) return null;
  const p = periodFor(plan, ref);
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
            grace_days, penalty_rule_id, fine_calc_type, fine_amount, fine_rate, fine_cap, pool_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,'savings',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [welfare.tenant_id, welfare.id, p.name, plan.frequency, plan.amount, p.period_start, p.due_date, plan.id, p.period_key,
          plan.grace_days, plan.penalty_rule_id, plan.fine_calc_type, plan.fine_amount, plan.fine_rate, plan.fine_cap, poolKeyForPlan(plan), plan.created_by || null],
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

// Open ALL of a plan's periods for `year` (idempotent), so members can prepay
// the whole year. Skips very granular plans (weekly/biweekly) — too many cycles
// to pre-open — falling back to just the current period.
export async function ensureYearCycles(welfare, plan, year) {
  if (!plan || !plan.active) return [];
  if (plan.frequency === "weekly" || plan.frequency === "biweekly") {
    const c = await ensureCurrentCycle({ welfare, plan });
    return c ? [c] : [];
  }
  const opened = [];
  for (const p of periodsForYear(plan, year)) {
    const c = await ensureCurrentCycle({ welfare, plan, ref: new Date(`${p.period_start}T12:00:00`) });
    if (c) opened.push(c);
  }
  return opened;
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
