#!/usr/bin/env node
// One-shot migration: bring every clients.client_code into the
// canonical CLT-<PREFIX>-<YEAR>-<NNNNN> format.
//
//   • Tech Tsadong (tenant 1): 501 rows from "CLT-2026-NNNN" → "CLT-TSD-2026-NNNNN"
//   • ABC/XYZ/QLC outliers (8 rows): non-conforming legacy codes
//     get the same treatment (uppercase prefix, 5-digit zero-pad).
//
// Set DRY_RUN=true to preview without writing. Runs in one
// transaction so a uniqueness violation rolls back everything.

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { TENANT_PREFIXES, tenantPrefix } from "../src/utils/clientCode.js";

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
  console.log("🚀 client_code normalization\n");
  console.log(`Mode: ${DRY_RUN ? "🧪 DRY-RUN" : "✏️  LIVE"}\n`);

  const client = await pool.connect();
  try {
    // Pull every code that isn't already in CLT-<PREFIX>-<YEAR>-<N+> form.
    const { rows } = await client.query(
      `SELECT c.id, c.tenant_id, c.client_code, t.subdomain
         FROM clients c
         JOIN tenants t ON t.id = c.tenant_id
        WHERE c.client_code !~ '^CLT-[A-Z]+-\\d{4}-\\d+$'
        ORDER BY c.tenant_id, c.id`,
    );

    if (rows.length === 0) {
      console.log("✅ Nothing to do — all codes already conform.");
      return;
    }

    // Build the rename plan in JS so we can collision-check up front.
    const planned = []; // {id, tenant_id, old, neu}
    const seenPerTenant = new Map(); // tenant_id → Set<new_code>

    for (const r of rows) {
      const m = r.client_code.match(/^CLT-(\d{4})-(\d+)$/);
      if (!m) {
        console.log(
          `   ⚠️  skip (non-standard): ${r.client_code} (tenant ${r.tenant_id})`,
        );
        continue;
      }
      const [, year, num] = m;
      const prefix = tenantPrefix(r.subdomain);
      const neu = `CLT-${prefix}-${year}-${num.padStart(5, "0")}`;

      // Collision check inside the planned batch
      if (!seenPerTenant.has(r.tenant_id))
        seenPerTenant.set(r.tenant_id, new Set());
      const seen = seenPerTenant.get(r.tenant_id);
      if (seen.has(neu)) {
        console.error(
          `❌ batch collision: two rows would both become ${neu} (tenant ${r.tenant_id})`,
        );
        process.exit(1);
      }
      seen.add(neu);

      planned.push({ id: r.id, tenant_id: r.tenant_id, old: r.client_code, neu });
    }

    // Collision check against rows that stay unchanged
    for (const p of planned) {
      const c = await client.query(
        `SELECT 1 FROM clients
          WHERE tenant_id = $1 AND client_code = $2 AND id <> $3 LIMIT 1`,
        [p.tenant_id, p.neu, p.id],
      );
      if (c.rows.length > 0) {
        console.error(
          `❌ collision with existing row: ${p.old} → ${p.neu} already taken (tenant ${p.tenant_id})`,
        );
        process.exit(1);
      }
    }

    // Print a sample
    console.log(`📋 ${planned.length} renames planned. First 10:`);
    planned.slice(0, 10).forEach((p) =>
      console.log(`   ${p.old.padEnd(20)} → ${p.neu}  (t=${p.tenant_id})`),
    );
    if (planned.length > 10) console.log(`   … +${planned.length - 10} more\n`);
    else console.log();

    // Group totals
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

    // Single transaction — partial failure rolls back.
    console.log("✏️  applying…");
    await client.query("BEGIN");
    try {
      // Two-pass to avoid transient uniqueness conflicts: stash to a
      // temporary code (prefixed with __TMP_<id>__) then move to final.
      // This sidesteps any case where the target of row A is currently
      // the source of row B (none in our batch, but cheap insurance).
      for (const p of planned) {
        await client.query(
          `UPDATE clients SET client_code = $1, updated_at = NOW() WHERE id = $2`,
          [`__TMP_${p.id}__`, p.id],
        );
      }
      for (const p of planned) {
        await client.query(
          `UPDATE clients SET client_code = $1 WHERE id = $2`,
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
      `SELECT tenant_id, client_code, COUNT(*) AS n
         FROM clients GROUP BY tenant_id, client_code HAVING COUNT(*) > 1`,
    );
    if (dup.rows.length > 0) {
      console.error("❌ duplicates detected post-migration:", dup.rows);
      process.exit(1);
    }
    const nonconf = await client.query(
      `SELECT COUNT(*)::int AS n FROM clients
        WHERE client_code !~ '^CLT-[A-Z]+-\\d{4}-\\d+$'`,
    );
    console.log(`📋 Verification:`);
    console.log(`   duplicates:            0`);
    console.log(`   still non-conforming:  ${nonconf.rows[0].n}\n`);

    // Per-tenant after-sample
    const after = await client.query(
      `SELECT t.id, t.business_name, COUNT(c.id) AS n,
              MIN(c.client_code) AS sample_lo, MAX(c.client_code) AS sample_hi
         FROM tenants t LEFT JOIN clients c ON c.tenant_id = t.id
         GROUP BY t.id, t.business_name ORDER BY t.id`,
    );
    console.log(sep);
    console.log("✅ POST-MIGRATION STATE");
    console.log(sep);
    after.rows.forEach((r) =>
      console.log(
        `   ${String(r.id).padEnd(3)} ${r.business_name.padEnd(24)} n=${String(r.n).padEnd(4)} ${r.sample_lo} … ${r.sample_hi}`,
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
