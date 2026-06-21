#!/usr/bin/env node
// Incremental migration runner for the NUMBERED migrations (NNN_name.sql).
//
// `npm run migrate` was wired to this file but the file never existed. Now it
// applies pending numbered migrations in numeric order, recording each in a
// `schema_migrations` table so re-runs are no-ops. The base schema (init.sql +
// the legacy add_*.sql files) is assumed already present — this manages the
// disciplined numbered migrations going forward, which is how new schema has
// been added since the convention started.
//
// Usage:
//   npm run migrate                 apply pending migrations
//   npm run migrate -- --status     list applied / pending (no changes)
//   npm run migrate -- --baseline   record ALL current numbered migrations as
//                                   applied WITHOUT running them — run this once
//                                   on an existing DB that was migrated by hand,
//                                   so only NEW migrations run from then on.
import "dotenv/config"; // load .env before the DB pool reads its connection vars
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pool from "../src/config/database.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Numbered migrations, ordered by their 3-digit prefix (parseInt stops at the _).
const numberedMigrations = () =>
  readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

async function main() {
  const mode = process.argv[2];
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const all = numberedMigrations();
    const done = new Set((await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));
    const pending = all.filter((f) => !done.has(f));

    if (mode === "--status") {
      console.log(`Applied: ${done.size}   Pending: ${pending.length}`);
      pending.forEach((f) => console.log("  pending:", f));
      return;
    }
    if (mode === "--baseline") {
      for (const f of all) {
        await client.query("INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING", [f]);
      }
      console.log(`Baselined ${all.length} migrations as applied (none were run).`);
      return;
    }
    if (!pending.length) {
      console.log("No pending migrations.");
      return;
    }
    for (const f of pending) {
      process.stdout.write(`Applying ${f} … `);
      await client.query(readFileSync(path.join(dir, f), "utf8"));
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [f]);
      console.log("ok");
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
