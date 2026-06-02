// One-shot backfill for migration 042: populate
// payment_schedules.interest_portion / principal_portion /
// balance_after on every existing row from the loan's
// principal + monthly rate + months + interest_method.
//
// Idempotent — re-runs produce identical numbers for the same data.
// Audit row dropped when finished.

import "dotenv/config";
import pool, { query } from "../src/config/database.js";
import { computeLoanTotals } from "../src/utils/loanMath.js";

const t0 = Date.now();

(async () => {
  // Pull every loan that has at least one schedule row. Ignore loans
  // without schedules (still pending / not disbursed).
  const loans = await query(
    `SELECT DISTINCT l.id, l.principal_amount, l.interest_rate,
                     l.loan_duration_months, l.interest_method
       FROM loans l
       JOIN payment_schedules ps ON ps.loan_id = l.id
      ORDER BY l.id`,
  );
  console.log(`Backfilling breakdown for ${loans.rows.length} loans…`);

  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (const l of loans.rows) {
    try {
      const months = parseInt(l.loan_duration_months, 10);
      const monthlyRatePct = parseFloat(l.interest_rate) || 0;
      const principal = parseFloat(l.principal_amount);
      if (!(months > 0) || !(principal > 0)) {
        skipped++;
        continue;
      }
      const { schedule } = computeLoanTotals({
        principal,
        annualRatePct: monthlyRatePct * 12,
        months,
        method: l.interest_method || "flat",
      });
      // Walk schedule rows in payment_number order. The amortization
      // table is keyed on dueIndex (1-based) — match on that.
      for (const row of schedule) {
        await query(
          `UPDATE payment_schedules
              SET interest_portion  = $1,
                  principal_portion = $2,
                  balance_after     = $3,
                  updated_at        = NOW()
            WHERE loan_id = $4 AND payment_number = $5`,
          [
            row.interestPortion,
            row.principalPortion,
            row.balanceAfter,
            l.id,
            row.dueIndex,
          ],
        );
      }
      updated++;
    } catch (err) {
      errored++;
      console.error(`  loan ${l.id} failed:`, err.message);
    }
    if ((updated + skipped + errored) % 25 === 0) {
      process.stdout.write(
        `  ${updated + skipped + errored}/${loans.rows.length}\r`,
      );
    }
  }
  console.log("");
  console.log(
    `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — updated: ${updated}, skipped: ${skipped}, errored: ${errored}`,
  );

  await query(
    `INSERT INTO audit_logs (
       tenant_id, user_id, action, action_category, table_name, entity_type,
       description, severity, status, created_at
     ) VALUES (
       NULL, NULL, 'payment_schedule_breakdown_backfill', 'system',
       'payment_schedules', 'payment_schedules',
       $1, 'info', 'success', NOW()
     )`,
    [
      `Backfilled interest_portion / principal_portion / balance_after for ${updated} loans (${skipped} skipped, ${errored} errored).`,
    ],
  );

  await pool.end();
})().catch(async (err) => {
  console.error("Backfill failed:", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
