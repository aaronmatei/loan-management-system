// Runs ONCE before the whole test run (Vitest globalSetup). Rebuilds the
// test database schema from a pg_dump snapshot of the real dev schema
// (tests/setup/schema.sql) — more faithful than replaying migrations,
// which aren't in alphabetical order (init.sql would sort last).
import { config } from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

config({ path: ".env.test" });

export default async function () {
  const dbName = process.env.DB_NAME || "";
  // Non-negotiable guard: the DROP SCHEMA below must NEVER hit dev/prod.
  if (!dbName.includes("test")) {
    throw new Error("Refusing to run tests: DB_NAME is not a *_test database!");
  }

  const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(path.join(dir, "schema.sql"), "utf8");
  // pg_dump 18 emits psql meta-commands (\restrict / \unrestrict) that are
  // NOT valid SQL through the pg driver — strip backslash-command lines.
  const schema = raw
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n");
  await pool.query(schema);
  await pool.end();
}
