import pool, { query } from "./src/config/database.js";

// Cleanup: the original seed-demo-data-bulk.js drew each payment as
// randomFloat(avg*0.5, avg*1.5) with no per-loan ceiling, so some
// loans (mostly 'completed', ratio 1.0) ended up with SUM(payments)
// slightly above total_amount_due. The top-up did NOT cause this
// (its headroom cap excludes already-overpaid loans). This trims the
// affected demo loans (tenants 5,6,7) so cumulative paid == due:
// walk each loan's completed payments oldest-first, reduce the
// payment that crosses the due line, delete any after it. Tech
// Tsadong (1) untouched. Re-run safe.

const DEMO = [5, 6, 7];
const round2 = (n) => Math.round(n * 100) / 100;

async function run() {
  console.log("🔧 Trimming overpaid demo loans (tenants 5,6,7)\n");

  const overpaid = (
    await query(
      `SELECT l.id, l.total_amount_due::float8 AS due
       FROM loans l
       JOIN transactions t
         ON t.loan_id = l.id AND t.payment_status = 'completed'
       WHERE l.tenant_id = ANY($1::int[])
       GROUP BY l.id, l.total_amount_due
       HAVING SUM(t.amount_paid) > l.total_amount_due + 0.01`,
      [DEMO],
    )
  ).rows;

  console.log(`   ${overpaid.length} overpaid loans found`);
  if (overpaid.length === 0) {
    await pool.end();
    process.exit(0);
  }

  let reduced = 0;
  let deleted = 0;

  for (const loan of overpaid) {
    const txns = (
      await query(
        `SELECT id, amount_paid::float8 AS amt
         FROM transactions
         WHERE loan_id = $1 AND payment_status = 'completed'
         ORDER BY payment_date ASC, id ASC`,
        [loan.id],
      )
    ).rows;

    let running = 0;
    let crossed = false;
    for (const tx of txns) {
      if (crossed) {
        await query("DELETE FROM transactions WHERE id = $1", [tx.id]);
        deleted++;
        continue;
      }
      if (running + tx.amt > loan.due + 0.01) {
        const keep = round2(loan.due - running);
        if (keep >= 1) {
          await query(
            "UPDATE transactions SET amount_paid = $1, updated_at = NOW() WHERE id = $2",
            [keep, tx.id],
          );
          reduced++;
        } else {
          await query("DELETE FROM transactions WHERE id = $1", [tx.id]);
          deleted++;
        }
        crossed = true;
      } else {
        running += tx.amt;
      }
    }
  }

  console.log(
    `   ✅ trimmed: ${reduced} payments reduced, ${deleted} deleted\n`,
  );

  // Recompute capital_pool collected (disbursed/initial unchanged).
  for (const tid of DEMO) {
    const collected = parseFloat(
      (
        await query(
          `SELECT COALESCE(SUM(amount_paid),0) s FROM transactions
           WHERE tenant_id = $1 AND payment_status = 'completed'`,
          [tid],
        )
      ).rows[0].s,
    );
    await query(
      `UPDATE capital_pool SET total_collected = $1, updated_at = NOW()
       WHERE tenant_id = $2`,
      [collected, tid],
    );
  }

  const check = (
    await query(
      `SELECT COUNT(*) c FROM (
         SELECT l.id FROM loans l
         JOIN transactions t
           ON t.loan_id = l.id AND t.payment_status = 'completed'
         WHERE l.tenant_id = ANY($1::int[])
         GROUP BY l.id, l.total_amount_due
         HAVING SUM(t.amount_paid) > l.total_amount_due + 0.01
       ) x`,
      [DEMO],
    )
  ).rows[0].c;

  const fin = await query(
    `SELECT t.business_name,
            (SELECT COUNT(*) FROM transactions WHERE tenant_id=t.id) txns,
            cp.initial_capital, cp.total_disbursed, cp.total_collected,
            (cp.initial_capital - cp.total_disbursed + cp.total_collected) available
     FROM tenants t JOIN capital_pool cp ON cp.tenant_id=t.id
     WHERE t.id = ANY($1::int[]) ORDER BY t.id`,
    [DEMO],
  );
  console.log(`   overpaid loans remaining: ${check} (must be 0)\n`);
  console.table(
    fin.rows.map((r) => ({
      tenant: r.business_name,
      txns: +r.txns,
      initial_capital: Math.round(+r.initial_capital),
      disbursed: Math.round(+r.total_disbursed),
      collected: Math.round(+r.total_collected),
      available: Math.round(+r.available),
    })),
  );

  await pool.end();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("❌ FATAL:", e.message);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
