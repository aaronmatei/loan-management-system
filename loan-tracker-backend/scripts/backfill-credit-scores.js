// One-shot backfill: recompute clients.credit_score for every client
// in every tenant. Idempotent — re-runs produce identical output for
// the same data. Use after migration 038 + slice 3 to populate the
// column for the existing book; from then on, the write-path hooks in
// services/creditScoreService.js keep it fresh.
//
// Usage:
//   node scripts/backfill-credit-scores.js
//
// Drops an audit_logs row when finished (system action; tenant-less)
// so the run is traceable.

import "dotenv/config";
import pool, { query } from "../src/config/database.js";
import { recomputeCreditScore } from "../src/services/creditScoreService.js";

const t0 = Date.now();

(async () => {
  const all = await query(
    `SELECT id, tenant_id FROM clients ORDER BY tenant_id, id`,
  );
  console.log(`Backfilling credit_score for ${all.rows.length} clients…`);

  let rated = 0;
  let unrated = 0;
  let errored = 0;

  for (const c of all.rows) {
    try {
      const score = await recomputeCreditScore(c.id, c.tenant_id);
      score == null ? unrated++ : rated++;
    } catch {
      errored++;
    }
    if ((rated + unrated + errored) % 50 === 0) {
      process.stdout.write(
        `  ${rated + unrated + errored}/${all.rows.length}\r`,
      );
    }
  }
  console.log("");
  console.log(
    `Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — rated: ${rated}, unrated: ${unrated}, errored: ${errored}`,
  );

  await query(
    `INSERT INTO audit_logs (
       tenant_id, user_id, action, action_category, table_name, entity_type,
       description, severity, status, created_at
     ) VALUES (
       NULL, NULL, 'credit_score_backfill', 'system',
       'clients', 'clients',
       $1, 'info', 'success', NOW()
     )`,
    [
      `Backfilled clients.credit_score for ${all.rows.length} clients — ${rated} rated, ${unrated} unrated, ${errored} errored.`,
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
