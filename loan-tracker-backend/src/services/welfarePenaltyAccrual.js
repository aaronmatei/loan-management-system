// Late-contribution penalty accrual. For each overdue contribution schedule,
// apply the chama's active `contribution_late` penalty rules. Idempotent: one
// outstanding assessment per (schedule, rule) — daily-accruing rules update the
// same row's amount rather than stacking new ones. Used by the manual
// "assess late" endpoint and the daily cron.
import { query } from "../config/database.js";
import { computePenaltyAmount } from "../utils/penaltyEngine.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function accrueContributionPenalties(tenantId) {
  // Welfare-wide late rules — the fallback when a cycle carries no fine config.
  const globalRules = (
    await query(`SELECT * FROM penalty_rules WHERE tenant_id = $1 AND trigger = 'contribution_late' AND active = true`, [tenantId])
  ).rows;
  const settingsGrace = (
    await query(`SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id = $1`, [tenantId])
  ).rows[0]?.contribution_grace_days || 0;

  // Unpaid schedules in open cycles past their due date, with the CYCLE's own
  // fine rule + grace (migration 081). Grace is applied per-row in JS since it
  // can vary by cycle.
  const rows = (
    await query(
      `SELECT s.*, c.fine_calc_type, c.fine_amount, c.fine_rate, c.fine_cap, c.grace_days AS cycle_grace,
              (CURRENT_DATE - s.due_date) AS days_past
         FROM contribution_schedules s
         JOIN contribution_cycles c ON c.id = s.cycle_id
        WHERE s.tenant_id = $1 AND c.status = 'open' AND s.status <> 'paid' AND s.due_date < CURRENT_DATE`,
      [tenantId],
    )
  ).rows;

  let assessed = 0;
  let overdue = 0;
  for (const s of rows) {
    const grace = s.cycle_grace != null ? parseInt(s.cycle_grace, 10) : settingsGrace;
    const daysLate = (parseInt(s.days_past, 10) || 0) - grace;
    if (daysLate <= 0) continue; // still within grace
    overdue += 1;
    const outstanding = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));

    // A cycle's own fine rule wins (rule_id stays NULL); else the welfare rules.
    const rules = s.fine_calc_type
      ? [{ id: null, calc_type: s.fine_calc_type, amount: s.fine_amount, rate: s.fine_rate, cap: s.fine_cap }]
      : globalRules;

    for (const rule of rules) {
      const amt = computePenaltyAmount(rule, { basis: outstanding, daysLate });
      if (!(amt > 0)) continue;
      const existing = (
        await query(
          `SELECT id FROM penalty_assessments
            WHERE tenant_id = $1 AND source_type = 'contribution_schedule' AND source_id = $2
              AND rule_id IS NOT DISTINCT FROM $3 AND status = 'outstanding' AND paid_amount = 0`,
          [tenantId, s.id, rule.id],
        )
      ).rows[0];
      if (existing) {
        await query(`UPDATE penalty_assessments SET amount = $2, assessed_at = NOW() WHERE id = $1`, [existing.id, amt]);
      } else {
        await query(
          `INSERT INTO penalty_assessments
             (tenant_id, member_id, rule_id, trigger, source_type, source_id, amount, description)
           VALUES ($1,$2,$3,'contribution_late','contribution_schedule',$4,$5,'Late contribution')`,
          [tenantId, s.member_id, rule.id, s.id, amt],
        );
        assessed += 1;
      }
    }
    await query(`UPDATE contribution_schedules SET status = 'overdue', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [s.id]);
  }
  return { assessed, overdue };
}

// Late event-share penalty accrual — the events analogue of the above. Overdue,
// unpaid shares (past the event's due_date + grace) get an `event_late` fine.
// The share's deadline lives on the parent event. Same idempotency rule.
export async function accrueEventSharePenalties(tenantId) {
  const rules = (
    await query(
      `SELECT * FROM penalty_rules
        WHERE tenant_id = $1 AND trigger = 'event_late' AND active = true`,
      [tenantId],
    )
  ).rows;
  if (rules.length === 0) return { assessed: 0, overdue: 0 };

  const grace = (
    await query(`SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id = $1`, [tenantId])
  ).rows[0]?.contribution_grace_days || 0;

  // Unpaid shares whose event has a due date that's passed (+grace) and that is
  // still being collected / awaiting bridge repayment.
  const shares = (
    await query(
      `SELECT s.*,
              (CURRENT_DATE - (e.due_date + ($2 * INTERVAL '1 day'))::date) AS days_late
         FROM welfare_event_shares s
         JOIN welfare_events e ON e.id = s.event_id
        WHERE s.tenant_id = $1 AND s.status <> 'paid'
          AND e.status IN ('collecting','disbursed')
          AND e.due_date IS NOT NULL
          AND (e.due_date + ($2 * INTERVAL '1 day'))::date < CURRENT_DATE`,
      [tenantId, grace],
    )
  ).rows;

  let assessed = 0;
  for (const s of shares) {
    const outstanding = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
    const daysLate = parseInt(s.days_late, 10) || 0;
    for (const rule of rules) {
      const amt = computePenaltyAmount(rule, { basis: outstanding, daysLate });
      if (!(amt > 0)) continue;
      const existing = (
        await query(
          `SELECT id FROM penalty_assessments
            WHERE tenant_id = $1 AND source_type = 'welfare_event_share'
              AND source_id = $2 AND rule_id = $3 AND status = 'outstanding' AND paid_amount = 0`,
          [tenantId, s.id, rule.id],
        )
      ).rows[0];
      if (existing) {
        await query(`UPDATE penalty_assessments SET amount = $2, assessed_at = NOW() WHERE id = $1`, [existing.id, amt]);
      } else {
        await query(
          `INSERT INTO penalty_assessments
             (tenant_id, member_id, rule_id, trigger, source_type, source_id, amount, description)
           VALUES ($1,$2,$3,'event_late','welfare_event_share',$4,$5,'Late event contribution')`,
          [tenantId, s.member_id, rule.id, s.id, amt],
        );
        assessed += 1;
      }
    }
    await query(`UPDATE welfare_event_shares SET status = 'overdue', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [s.id]);
  }
  return { assessed, overdue: shares.length };
}

// Run for every active welfare tenant (the daily cron's entry point).
export async function accrueAllWelfarePenalties() {
  const tenants = (
    await query(`SELECT id FROM tenants WHERE kind = 'welfare' AND status = 'active'`)
  ).rows;
  let assessed = 0;
  for (const t of tenants) {
    try {
      const r = await accrueContributionPenalties(t.id);
      const e = await accrueEventSharePenalties(t.id);
      assessed += r.assessed + e.assessed;
    } catch {
      /* one chama failing shouldn't stop the rest */
    }
  }
  return { tenants: tenants.length, assessed };
}
