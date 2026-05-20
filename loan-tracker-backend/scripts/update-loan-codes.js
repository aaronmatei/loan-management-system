#!/usr/bin/env node
// Mirror of update-tsd-client-codes.js but for loans.loan_code.
//
//   • Tech Tsadong (tenant 1): 763 rows from "LN-2026-NNNN" → "LN-TSD-2026-NNNNN"
//   • ABC outliers (8 rows): "LN-2026-..." → "LN-ABC-2026-NNNNN"
//   • XYZ/QLC already conforming.
//
// Same two-pass __TMP_<id>__ trick to dodge any transient unique
// conflicts. DRY_RUN=true previews. Wraps in one transaction so
// partial failure rolls back.

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tenantPrefix } from "../src/utils/clientCode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

const DRY_RUN = process.env.DRY_RUN === "true";

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER || "aron",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "loan_tracker",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 5432,
});

const sep = "=".repeat(60);

async function main() {
  console.log("🚀 loan_code normalization\n");
  console.log(`Mode: ${DRY_RUN ? "🧪 DRY-RUN" : "✏️  LIVE"}\n`);

  const client = await pool.connect();
  try {
    // Every row whose code isn't already in LN-<PREFIX>-<YEAR>-<N+> form.
    const { rows } = await client.query(
      `SELECT l.id, l.tenant_id, l.loan_code, t.subdomain
         FROM loans l
         JOIN tenants t ON t.id = l.tenant_id
        WHERE l.loan_code !~ '^LN-[A-Z]+-\\d{4}-\\d+$'
        ORDER BY l.tenant_id, l.id`,
    );

    if (rows.length === 0) {
      console.log("✅ Nothing to do — all loan codes already conform.");
      return;
    }

    const planned = [];
    const seenPerTenant = new Map();

    for (const r of rows) {
      const m = r.loan_code.match(/^LN-(\d{4})-(\d+)$/);
      if (!m) {
        console.log(
          `   ⚠️  skip (non-standard): ${r.loan_code} (tenant ${r.tenant_id})`,
        );
        continue;
      }
      const [, year, num] = m;
      const prefix = tenantPrefix(r.subdomain);
      const neu = `LN-${prefix}-${year}-${num.padStart(5, "0")}`;

      if (!seenPerTenant.has(r.tenant_id)) seenPerTenant.set(r.tenant_id, new Set());
      const seen = seenPerTenant.get(r.tenant_id);
      if (seen.has(neu)) {
        console.error(
          `❌ batch collision: two rows would both become ${neu} (tenant ${r.tenant_id})`,
        );
        process.exit(1);
      }
      seen.add(neu);

      planned.push({ id: r.id, tenant_id: r.tenant_id, old: r.loan_code, neu });
    }

    // Collision check against rows that stay unchanged
    for (const p of planned) {
      const c = await client.query(
        `SELECT 1 FROM loans
          WHERE tenant_id = $1 AND loan_code = $2 AND id <> $3 LIMIT 1`,
        [p.tenant_id, p.neu, p.id],
      );
      if (c.rows.length > 0) {
        console.error(
          `❌ collision with existing row: ${p.old} → ${p.neu} already taken (tenant ${p.tenant_id})`,
        );
        process.exit(1);
      }
    }

    console.log(`📋 ${planned.length} renames planned. First 10:`);
    planned
      .slice(0, 10)
      .forEach((p) =>
        console.log(`   ${p.old.padEnd(18)} → ${p.neu}  (t=${p.tenant_id})`),
      );
    if (planned.length > 10) console.log(`   … +${planned.length - 10} more\n`);
    else console.log();

    const byTenant = planned.reduce((acc, p) => {
      acc[p.tenant_id] = (acc[p.tenant_id] || 0) + 1;
      return acc;
    }, {});
    console.log("📊 By tenant:");
    Object.entries(byTenant).forEach(([t, n]) =>
      console.log(`   tenant ${t}: ${n} rows`),
    );
    console.log();

    if (DRY_RUN) {
      console.log("🧪 DRY-RUN — no changes. Re-run without DRY_RUN=true.\n");
      return;
    }

    console.log("✏️  applying…");
    await client.query("BEGIN");
    try {
      // Two-pass: stash via __TMP_<id>__ then move to final.
      for (const p of planned) {
        await client.query(
          `UPDATE loans SET loan_code = $1, updated_at = NOW() WHERE id = $2`,
          [`__TMP_${p.id}__`, p.id],
        );
      }
      for (const p of planned) {
        await client.query(
          `UPDATE loans SET loan_code = $1 WHERE id = $2`,
          [p.neu, p.id],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log(`✅ ${planned.length} rows updated\n`);

    // Verify
    const dup = await client.query(
      `SELECT tenant_id, loan_code, COUNT(*) AS n
         FROM loans GROUP BY tenant_id, loan_code HAVING COUNT(*) > 1`,
    );
    if (dup.rows.length > 0) {
      console.error("❌ duplicates detected post-migration:", dup.rows);
      process.exit(1);
    }
    const nonconf = await client.query(
      `SELECT COUNT(*)::int AS n FROM loans
        WHERE loan_code !~ '^LN-[A-Z]+-\\d{4}-\\d+$'`,
    );
    console.log(`📋 Verification:`);
    console.log(`   duplicates:            0`);
    console.log(`   still non-conforming:  ${nonconf.rows[0].n}\n`);

    const after = await client.query(
      `SELECT t.id, t.business_name, COUNT(l.id) AS n,
              MIN(l.loan_code) AS sample_lo, MAX(l.loan_code) AS sample_hi
         FROM tenants t LEFT JOIN loans l ON l.tenant_id = t.id
         GROUP BY t.id, t.business_name ORDER BY t.id`,
    );
    console.log(sep);
    console.log("✅ POST-MIGRATION STATE");
    console.log(sep);
    after.rows.forEach((r) =>
      console.log(
        `   ${String(r.id).padEnd(3)} ${(r.business_name || "").padEnd(24)} n=${String(r.n).padEnd(4)} ${r.sample_lo || "-"} … ${r.sample_hi || "-"}`,
      ),
    );
    console.log(sep + "\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  console.error(e);
  process.exit(1);
});
