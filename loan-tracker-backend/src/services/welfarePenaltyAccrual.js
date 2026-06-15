// Late-contribution penalty accrual. For each overdue contribution schedule,
// apply the chama's active `contribution_late` penalty rules. Idempotent: one
// outstanding assessment per (schedule, rule) — daily-accruing rules update the
// same row's amount rather than stacking new ones. Used by the manual
// "assess late" endpoint and the daily cron.
import { query } from "../config/database.js";
import { computePenaltyAmount } from "../utils/penaltyEngine.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function accrueContributionPenalties(tenantId) {
  const rules = (
    await query(
      `SELECT * FROM penalty_rules
        WHERE tenant_id = $1 AND trigger = 'contribution_late' AND active = true`,
      [tenantId],
    )
  ).rows;

  // Grace period from the chama's settings (default 0).
  const setRes = await query(
    `SELECT contribution_grace_days FROM welfare_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  const grace = setRes.rows[0]?.contribution_grace_days || 0;

  // Overdue, unpaid schedules in open cycles, past their due date + grace.
  const schedules = (
    await query(
      `SELECT s.*,
              (CURRENT_DATE - (s.due_date + ($2 * INTERVAL '1 day'))::date) AS days_late
         FROM contribution_schedules s
         JOIN contribution_cycles c ON c.id = s.cycle_id
        WHERE s.tenant_id = $1 AND c.status = 'open' AND s.status <> 'paid'
          AND (s.due_date + ($2 * INTERVAL '1 day'))::date < CURRENT_DATE`,
      [tenantId, grace],
    )
  ).rows;

  let assessed = 0;
  for (const s of schedules) {
    const outstanding = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
    const daysLate = parseInt(s.days_late, 10) || 0;

    for (const rule of rules) {
      const amt = computePenaltyAmount(rule, { basis: outstanding, daysLate });
      if (!(amt > 0)) continue;

      const existing = (
        await query(
          `SELECT id FROM penalty_assessments
            WHERE tenant_id = $1 AND source_type = 'contribution_schedule'
              AND source_id = $2 AND rule_id = $3 AND status = 'outstanding' AND paid_amount = 0`,
          [tenantId, s.id, rule.id],
        )
      ).rows[0];

      if (existing) {
        // Daily rules grow; refresh the amount to the current value.
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

    // Flag the schedule overdue so the UI reflects it.
    await query(
      `UPDATE contribution_schedules SET status = 'overdue', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [s.id],
    );
  }
  return { assessed, overdue: schedules.length };
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
      assessed += r.assessed;
    } catch {
      /* one chama failing shouldn't stop the rest */
    }
  }
  return { tenants: tenants.length, assessed };
}
