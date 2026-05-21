// Rebuilds the isolated e2e database and seeds a tenant + admin login.
// Runs BEFORE `playwright test` (see package.json) so the e2e backend can
// connect to a ready, freshly-seeded DB without depending on the order in
// which Playwright starts globalSetup vs. the webServers.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import bcryptjs from "bcryptjs";
import { ADMIN, TENANT, E2E_DB, dbConfig } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Reuse the backend's pg_dump schema snapshot as the single source of truth.
const SCHEMA = path.resolve(
  __dirname,
  "../loan-tracker-backend/tests/setup/schema.sql",
);

async function main() {
  if (!/e2e/i.test(E2E_DB)) {
    throw new Error(`Refusing: E2E_DB_NAME="${E2E_DB}" must contain "e2e".`);
  }

  // 1) Ensure the database exists (CREATE DATABASE needs the maintenance DB).
  const maint = new pg.Client(dbConfig("postgres"));
  await maint.connect();
  const exists = await maint.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [E2E_DB],
  );
  if (exists.rowCount === 0) {
    await maint.query(`CREATE DATABASE ${E2E_DB}`);
    console.log(`✓ created database ${E2E_DB}`);
  }
  await maint.end();

  // 2) Rebuild the schema (strip pg_dump's psql \meta-commands).
  const pool = new pg.Pool(dbConfig(E2E_DB));
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const schema = readFileSync(SCHEMA, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("\\"))
    .join("\n");
  await pool.query(schema);
  console.log("✓ schema rebuilt");

  // 3) Seed a tenant + a NON-platform admin (the staff /login rejects
  //    platform admins) we can authenticate as in the specs.
  // Qualify with public.* — the dump set search_path to '' on this pooled
  // connection, so unqualified names won't resolve.
  const t = await pool.query(
    `INSERT INTO public.tenants (tenant_code, business_name, subdomain, contact_name, contact_email)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      TENANT.tenant_code,
      TENANT.business_name,
      TENANT.subdomain,
      TENANT.contact_name,
      TENANT.contact_email,
    ],
  );
  const hash = await bcryptjs.hash(ADMIN.password, 10);
  await pool.query(
    `INSERT INTO public.users
       (tenant_id, username, email, password_hash, first_name, last_name, role, is_active, is_platform_admin)
     VALUES ($1, 'e2eadmin', $2, $3, 'E2E', 'Admin', 'admin', true, false)`,
    [t.rows[0].id, ADMIN.email, hash],
  );
  // Seed a funded capital pool (no API initialize endpoint exists) so loans
  // can be approved/disbursed.
  await pool.query(
    `INSERT INTO public.capital_pool (initial_capital, tenant_id)
     VALUES (5000000, $1)`,
    [t.rows[0].id],
  );
  console.log(`✓ seeded tenant + admin (${ADMIN.email}) + capital pool`);

  await pool.end();
}

main().catch((err) => {
  console.error("E2E DB setup failed:", err);
  process.exit(1);
});
