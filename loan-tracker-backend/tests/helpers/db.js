// Shared DB helpers for integration tests. These reuse the app's own pg
// pool (src/config/database.js), so closePool() closes the same pool the
// route handlers use. Safe because tests/setup/env.js guarantees we're
// pointed at loan_tracker_test.
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import pool, { query } from "../../src/config/database.js";

export { pool, query };

// Sign a staff JWT matching the shape verifyToken expects (id/email/role/
// tenant_id). Use with `.set("Authorization", "Bearer " + tokenFor(user))`.
export function tokenFor(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// Wipe the tables tests write to. CASCADE clears FK-referencing rows.
//
// NOTE: we deliberately do NOT use RESTART IDENTITY. Some welfare tables
// (penalty_assessments, member_pool_transactions, …) reference tenants
// without an ON DELETE CASCADE FK, so a TRUNCATE of `tenants` leaves their
// rows orphaned (tenant_id retained). If the id sequence were reset, a later
// test that creates a fresh tenant could be handed a RECYCLED id and inherit
// those orphans — making tenant-scoped COUNT/SUM assertions flaky (e.g. a
// contribution-late penalty count reading 3 instead of 2). Letting serial
// ids keep climbing means a new tenant never collides with old orphans.
export async function truncate(...tables) {
  const list = tables.length ? tables : ["tenants", "users", "audit_logs"];
  await query(
    `TRUNCATE ${list.map((t) => `"${t}"`).join(", ")} CASCADE`,
  );
}

// Insert a minimal valid tenant (only the NOT-NULL-without-default columns
// are required; the rest default, incl. status='active').
export async function seedTenant(overrides = {}) {
  const t = {
    tenant_code: "TST",
    business_name: "Test Lender Ltd",
    subdomain: "testlender",
    contact_name: "Test Owner",
    contact_email: "owner@testlender.test",
    ...overrides,
  };
  const { rows } = await query(
    `INSERT INTO tenants (tenant_code, business_name, subdomain, contact_name, contact_email)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      t.tenant_code,
      t.business_name,
      t.subdomain,
      t.contact_name,
      t.contact_email,
    ],
  );
  const tenant = rows[0];
  // Mirror migration 036: every new tenant gets a default "Main"
  // branch so client-create flows that fall back to the tenant's
  // default branch don't fail.
  await query(
    `INSERT INTO branches (tenant_id, name, is_default, active)
     VALUES ($1, 'Main', TRUE, TRUE)`,
    [tenant.id],
  );
  return tenant;
}

// Insert a user with a bcrypt-hashed password. Returns the row plus the
// plaintext password so the caller can log in with it.
export async function seedUser({
  tenant_id,
  password = "TestPass1234!",
  ...overrides
} = {}) {
  const u = {
    username: "tester",
    email: "tester@testlender.test",
    first_name: "Test",
    last_name: "User",
    role: "loan_officer",
    is_active: true,
    ...overrides,
  };
  const password_hash = await bcryptjs.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users
       (username, email, password_hash, first_name, last_name, role, is_active, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, email, role, tenant_id, is_active`,
    [
      u.username,
      u.email,
      password_hash,
      u.first_name,
      u.last_name,
      u.role,
      u.is_active,
      tenant_id,
    ],
  );
  return { ...rows[0], password };
}

export async function closePool() {
  await pool.end();
}
