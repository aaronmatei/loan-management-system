#!/usr/bin/env node
// Provision a dedicated LenderFest platform admin (admin@lenderfest.loans)
// living on a "LenderFest Platform" tenant. The existing tenant admin
// (admin@techtsadong.com, user id=1) keeps `is_platform_admin=true`
// so neither account is taken down by this script.
//
// Schema reality (NOT what the original draft assumed):
//   • users.is_active (boolean)   — NOT users.status
//   • users.username   required + UNIQUE
//   • no users.email_verified columns
//   • tenants.contact_email/contact_phone (NOT owner_*)
//
// Idempotent.

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

// Use the shared DB connection (DATABASE_URL + SSL aware) so this works in the
// Render Shell against Neon, not only a local DB. Imported after dotenv so the
// pool reads the right env.
const { default: pool, query: q } = await import("../src/config/database.js");

// ── Config ───────────────────────────────────────────────────────
const EMAIL = "admin@lenderfest.loans";
const PASSWORD = "Admin@2026";
const USERNAME = "platform_admin"; // 'admin' is taken by id=1
const FIRST_NAME = "Platform";
const LAST_NAME = "Admin";
const PHONE = "+254700000000";

const TENANT_NAME = "LenderFest Platform";
const TENANT_SUBDOMAIN = "platform";
// ─────────────────────────────────────────────────────────────────

const sep = "=".repeat(60);

async function main() {
  console.log("🚀 setup-platform-admin\n");

  // 1. Platform tenant (organizational container for the admin user)
  console.log(`📋 Step 1: ensure '${TENANT_SUBDOMAIN}' tenant exists…`);
  const tRow = await q(
    `SELECT id, business_name FROM tenants WHERE subdomain = $1`,
    [TENANT_SUBDOMAIN],
  );
  let tenantId;
  if (tRow.rows.length === 0) {
    // tenant_code is required + unique. tenants.status, plan, white_label_tier
    // all have sensible defaults but we set them explicitly for clarity.
    const ins = await q(
      `INSERT INTO tenants (
         tenant_code, business_name, subdomain,
         contact_name, contact_email, contact_phone,
         status, plan,
         billing_enabled, billing_fee_percentage,
         white_label_tier,
         onboarding_completed, onboarding_completed_at,
         created_at, updated_at
       ) VALUES (
         'PLATFORM', $1, $2,
         'Platform Admin', $3, $4,
         'active', 'platform',
         false, 0,
         'enterprise',
         true, NOW(),
         NOW(), NOW()
       )
       RETURNING id`,
      [TENANT_NAME, TENANT_SUBDOMAIN, EMAIL, PHONE],
    );
    tenantId = ins.rows[0].id;
    console.log(`   ✓ created (id=${tenantId})\n`);
  } else {
    tenantId = tRow.rows[0].id;
    console.log(`   ✓ already exists (id=${tenantId})\n`);
  }

  // 2. Password hash
  console.log("📋 Step 2: hashing password…");
  const hash = await bcrypt.hash(PASSWORD, 10);
  console.log("   ✓ hashed\n");

  // 3. Upsert the admin user
  console.log(`📋 Step 3: upsert user ${EMAIL}…`);
  const ex = await q(
    `SELECT id, tenant_id, is_platform_admin FROM users WHERE email = $1`,
    [EMAIL],
  );
  let userId;
  if (ex.rows.length > 0) {
    userId = ex.rows[0].id;
    await q(
      `UPDATE users
          SET password_hash      = $1,
              first_name         = $2,
              last_name          = $3,
              phone_number       = $4,
              role               = 'admin',
              is_active          = true,
              is_platform_admin  = true,
              tenant_id          = $5,
              updated_at         = NOW()
        WHERE id = $6`,
      [hash, FIRST_NAME, LAST_NAME, PHONE, tenantId, userId],
    );
    console.log(`   ✓ updated existing user (id=${userId})\n`);
  } else {
    const ins = await q(
      `INSERT INTO users (
         tenant_id, username, email, password_hash,
         first_name, last_name, phone_number,
         role, is_active, is_platform_admin,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         'admin', true, true,
         NOW(), NOW()
       )
       RETURNING id`,
      [
        tenantId,
        USERNAME,
        EMAIL,
        hash,
        FIRST_NAME,
        LAST_NAME,
        PHONE,
      ],
    );
    userId = ins.rows[0].id;
    console.log(`   ✓ created user (id=${userId})\n`);
  }

  // 4. Sanity-check incumbent platform admin
  console.log("📋 Step 4: existing platform admin status…");
  const inc = await q(
    `SELECT id, email, is_active, is_platform_admin
       FROM users WHERE email = 'admin@techtsadong.com'`,
  );
  if (inc.rows.length > 0) {
    const r = inc.rows[0];
    console.log(
      `   admin@techtsadong.com id=${r.id}  is_active=${r.is_active}  is_platform_admin=${r.is_platform_admin}  (left as-is)\n`,
    );
  } else {
    console.log("   (no admin@techtsadong.com row — skipped)\n");
  }

  // 5. Verify & print
  const v = await q(
    `SELECT u.id, u.username, u.email,
            u.first_name || ' ' || u.last_name AS full_name,
            u.phone_number, u.role, u.is_active, u.is_platform_admin,
            t.business_name AS tenant_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.email = $1`,
    [EMAIL],
  );
  const tn = await q(`SELECT COUNT(*)::int AS n FROM tenants WHERE status = 'active'`);
  const pa = await q(
    `SELECT u.email, t.business_name AS tenant
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.is_platform_admin = true ORDER BY u.id`,
  );

  const a = v.rows[0];
  console.log(`\n${sep}\n✅ READY\n${sep}\n`);
  console.log("👑 LenderFest platform admin:");
  console.log(`   id:                 ${a.id}`);
  console.log(`   name:               ${a.full_name}`);
  console.log(`   username:           ${a.username}`);
  console.log(`   email:              ${a.email}`);
  console.log(`   phone:              ${a.phone_number}`);
  console.log(`   role:               ${a.role}`);
  console.log(`   is_active:          ${a.is_active ? "yes ✅" : "no ❌"}`);
  console.log(
    `   is_platform_admin:  ${a.is_platform_admin ? "yes ✅" : "no ❌"}`,
  );
  console.log(`   tenant:             ${a.tenant_name}\n`);
  console.log("🔐 Login:");
  console.log(`   email:    ${EMAIL}`);
  console.log(`   password: ${PASSWORD}\n`);
  console.log(`📊 Active tenants: ${tn.rows[0].n}`);
  console.log("👑 All platform admins:");
  pa.rows.forEach((r) => console.log(`   • ${r.email} (${r.tenant})`));
  console.log(`\n${sep}\n`);
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
