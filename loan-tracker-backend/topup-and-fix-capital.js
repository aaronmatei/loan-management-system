import pool, { query } from "./src/config/database.js";

// Demo tenants only (5=ABC, 6=XYZ, 7=Quick). Tech Tsadong (1) is
// never touched.
//
// 1) TRANSACTION TOP-UP — bring each demo tenant to ~1000 completed
//    transactions. Extra payments are added ONLY against funded
//    loans (active/completed/defaulted) and are capped so a loan's
//    cumulative paid never exceeds 95% of total_amount_due for
//    active/defaulted (keeps them genuinely "in progress") or 100%
//    for completed. This keeps payments consistent with the app's
//    balance/overpayment logic — no phantom overpayments.
//
// 2) CAPITAL POOL FIX — recompute per tenant from real totals and
//    set initial_capital = 1.5x disbursed (rounded to 100k) so a
//    lender that disbursed ~18M reads as healthily capitalised
//    (available = ~0.5x disbursed + collected, strongly positive).

const DEMO = [5, 6, 7];
const TARGET_TXNS = 1000;
const PAYMENT_METHODS = [
  "mpesa", "mpesa", "mpesa", "mpesa", "mpesa", "mpesa", "mpesa",
  "bank_transfer", "bank_transfer", "cash",
];

const randomItem = (a) => a[Math.floor(Math.random() * a.length)];
const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;

function paymentDate(startDate) {
  const start = new Date(startDate).getTime();
  const now = Date.now();
  const earliest = Math.max(start + 5 * DAY, now - 365 * DAY);
  if (earliest >= now) return new Date(now).toISOString().split("T")[0];
  const ts = earliest + Math.random() * (now - earliest);
  return new Date(ts).toISOString().split("T")[0];
}

async function run() {
  console.log("🔧 Transaction top-up + capital pool fix (demo tenants)\n");

  const tenants = (
    await query(
      `SELECT t.id, t.business_name, t.tenant_code, cp.initial_capital
       FROM tenants t
       JOIN capital_pool cp ON cp.tenant_id = t.id
       WHERE t.id = ANY($1::int[]) ORDER BY t.id`,
      [DEMO],
    )
  ).rows;

  for (const t of tenants) {
    const pfx = t.tenant_code.substring(0, 3);
    console.log(`\n━━━ ${t.business_name} (tenant ${t.id}) ━━━`);

    const current = parseInt(
      (
        await query(
          "SELECT COUNT(*) c FROM transactions WHERE tenant_id = $1",
          [t.id],
        )
      ).rows[0].c,
      10,
    );
    let need = Math.max(0, TARGET_TXNS - current);
    console.log(`   current txns: ${current} → need ${need} more`);

    // Funded loans with their current paid total + remaining cap.
    const loans = (
      await query(
        `SELECT l.id, l.client_id, l.status, l.start_date,
                l.total_amount_due::float8 AS due,
                COALESCE(SUM(tx.amount_paid),0)::float8 AS paid
         FROM loans l
         LEFT JOIN transactions tx
           ON tx.loan_id = l.id AND tx.payment_status = 'completed'
         WHERE l.tenant_id = $1
           AND l.status IN ('active','completed','defaulted')
           AND l.start_date IS NOT NULL
         GROUP BY l.id`,
        [t.id],
      )
    ).rows.map((r) => {
      const capPct = r.status === "completed" ? 1.0 : 0.95;
      return {
        ...r,
        cap: r.due * capPct,
        headroom: Math.max(0, r.due * capPct - r.paid),
      };
    });

    const eligible = loans.filter((l) => l.headroom > 200);
    console.log(
      `   ${eligible.length} loans with headroom (of ${loans.length} funded)`,
    );

    if (need === 0 || eligible.length === 0) {
      console.log("   ⏭️  nothing to add");
    } else {
      let seq = Date.now();
      let added = 0;
      // Round-robin: one modest payment per pass per eligible loan
      // until the target is hit or every loan is exhausted.
      let active = eligible;
      while (added < need && active.length > 0) {
        const stillActive = [];
        for (const l of active) {
          if (added >= need) {
            stillActive.push(l);
            continue;
          }
          let amt = round2(
            l.headroom * (randomInt(10, 30) / 100), // 10-30% of remaining
          );
          if (amt < 100) amt = round2(l.headroom); // tiny tail → settle it
          if (l.paid + amt > l.cap) amt = round2(l.cap - l.paid);
          if (amt < 50) continue; // exhausted
          try {
            await query(
              `INSERT INTO transactions (
                 tenant_id, transaction_code, loan_id, client_id,
                 amount_paid, payment_date, payment_method,
                 payment_reference, payment_status
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')`,
              [
                t.id,
                `TXN-${pfx}-TOP-${seq++}`,
                l.id,
                l.client_id,
                amt,
                paymentDate(l.start_date),
                randomItem(PAYMENT_METHODS),
                `REF${randomInt(100000, 999999)}`,
              ],
            );
            l.paid += amt;
            l.headroom = Math.max(0, l.cap - l.paid);
            added++;
            if (l.headroom > 200) stillActive.push(l);
          } catch (e) {
            console.error(`   ⚠️  txn: ${e.message}`);
          }
        }
        active = stillActive;
      }
      console.log(`   ✅ added ${added} transactions`);
      if (added < need) {
        console.log(
          `   ⚠️  loan headroom exhausted before target — capped at ` +
            `${current + added} (further payments would overpay loans)`,
        );
      }
    }

    // ---- Capital pool: recompute from real totals -------------------
    const disbursed = parseFloat(
      (
        await query(
          `SELECT COALESCE(SUM(principal_amount),0) s FROM loans
           WHERE tenant_id = $1
             AND status IN ('active','completed','defaulted')`,
          [t.id],
        )
      ).rows[0].s,
    );
    const collected = parseFloat(
      (
        await query(
          `SELECT COALESCE(SUM(amount_paid),0) s FROM transactions
           WHERE tenant_id = $1 AND payment_status = 'completed'`,
          [t.id],
        )
      ).rows[0].s,
    );
    // Interest portion of collections, approximated from the loan book.
    const interestEarned = parseFloat(
      (
        await query(
          `SELECT COALESCE(SUM(total_interest),0) s FROM loans
           WHERE tenant_id = $1 AND status = 'completed'`,
          [t.id],
        )
      ).rows[0].s,
    );
    const initialCapital =
      Math.ceil((disbursed * 1.5) / 100000) * 100000 || 5000000;

    await query(
      `UPDATE capital_pool
         SET initial_capital = $1, total_disbursed = $2,
             total_collected = $3, total_interest_earned = $4,
             updated_at = NOW()
       WHERE tenant_id = $5`,
      [initialCapital, disbursed, collected, interestEarned, t.id],
    );

    const available = initialCapital - disbursed + collected;
    console.log(
      `   💼 capital: initial ${initialCapital.toLocaleString()}, ` +
        `disbursed ${disbursed.toLocaleString()}, ` +
        `collected ${collected.toLocaleString()}, ` +
        `available ${available.toLocaleString()}`,
    );
  }

  console.log("\n━━━ FINAL ━━━");
  const fin = await query(
    `SELECT t.business_name,
            (SELECT COUNT(*) FROM transactions WHERE tenant_id=t.id) txns,
            cp.initial_capital, cp.total_disbursed, cp.total_collected,
            (cp.initial_capital - cp.total_disbursed + cp.total_collected) available
     FROM tenants t JOIN capital_pool cp ON cp.tenant_id=t.id
     WHERE t.id = ANY($1::int[]) ORDER BY t.id`,
    [DEMO],
  );
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
