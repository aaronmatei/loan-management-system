#!/usr/bin/env node
// Dev convenience: take an existing tenant client, mint a verified
// platform_customer for them, and link them to a different tenant so
// they can log into the customer portal as that tenant's customer.
//
// Schema notes (real columns, NOT what the original draft assumed):
//   - platform_customers.phone_verified / email_verified  (NO is_verified)
//   - customer_tenant_links.linked_at / last_activity_at  (NO created_at/updated_at)
//
// CONFIG: edit the three constants below.

import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { nextClientCode } from "../src/utils/clientCode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER || "aron",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "loan_tracker",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 5432,
});
const q = (text, params) => pool.query(text, params);

// ── Config (env-overridable so the script can run in a loop) ─────
const CLIENT_CODE = process.env.CLIENT_CODE || "CLT-ABC-2026-00224";
const TENANT_SUBDOMAIN = process.env.TENANT_SUBDOMAIN || "abclenders";
const PASSWORD = process.env.PASSWORD || "Customer2026";
// ─────────────────────────────────────────────────────────────────

function normalizePhone(p) {
  let s = String(p).trim();
  if (s.startsWith("0")) s = "+254" + s.substring(1);
  else if (s.startsWith("254")) s = "+" + s;
  else if (!s.startsWith("+")) s = "+254" + s;
  return s;
}

async function main() {
  console.log("🚀 add-client-to-tenant\n");

  // 1. Source client
  console.log(`📋 Looking up source client ${CLIENT_CODE}…`);
  const src = await q(
    `SELECT c.id, c.client_code, c.first_name, c.last_name,
            c.phone_number, c.email, c.id_number, c.tenant_id,
            t.business_name AS current_tenant
       FROM clients c LEFT JOIN tenants t ON t.id = c.tenant_id
      WHERE c.client_code = $1`,
    [CLIENT_CODE],
  );
  if (src.rows.length === 0) {
    console.error(`❌ Client ${CLIENT_CODE} not found`);
    process.exit(1);
  }
  const client = src.rows[0];
  console.log(
    `   ✓ ${client.first_name} ${client.last_name} · ${client.phone_number} · currently at ${client.current_tenant}\n`,
  );

  // 2. Target tenant
  console.log(`📋 Looking up target tenant '${TENANT_SUBDOMAIN}'…`);
  const ten = await q(
    `SELECT id, business_name, subdomain FROM tenants WHERE subdomain = $1`,
    [TENANT_SUBDOMAIN],
  );
  if (ten.rows.length === 0) {
    console.error(`❌ Tenant ${TENANT_SUBDOMAIN} not found`);
    process.exit(1);
  }
  const tenant = ten.rows[0];
  console.log(`   ✓ ${tenant.business_name} (id=${tenant.id})\n`);

  // 3. Normalize phone
  const phone = normalizePhone(client.phone_number);
  console.log(`📋 Phone normalized: ${client.phone_number} → ${phone}\n`);

  // 4. Client at target tenant.
  // Phone match needs to be format-agnostic: legacy seeds use the
  // local 0xxx form, new rows use the canonical +254xxx form. We
  // strip everything but digits and compare on the 9-digit tail (the
  // subscriber number) so 0716697425 ≡ +254716697425 ≡ 254716697425.
  console.log(`📋 Checking client record at ${tenant.business_name}…`);
  const tail = phone.replace(/\D/g, "").slice(-9);
  const existAtTarget = await q(
    `SELECT id, client_code FROM clients
      WHERE tenant_id = $1
        AND REGEXP_REPLACE(phone_number, '\\D', '', 'g') LIKE '%' || $2`,
    [tenant.id, tail],
  );
  let targetClientId;
  if (existAtTarget.rows.length > 0) {
    targetClientId = existAtTarget.rows[0].id;
    console.log(
      `   ✓ already exists (id=${targetClientId}, code=${existAtTarget.rows[0].client_code})\n`,
    );
  } else {
    // Shared helper — produces CLT-<PREFIX>-<YEAR>-<NNNNN>.
    const newCode = await nextClientCode(q, tenant.id);
    const ins = await q(
      `INSERT INTO clients (
         tenant_id, client_code, first_name, last_name,
         phone_number, email, id_number, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active', NOW())
       RETURNING id, client_code`,
      [
        tenant.id,
        newCode,
        client.first_name,
        client.last_name,
        phone,
        client.email,
        client.id_number,
      ],
    );
    targetClientId = ins.rows[0].id;
    console.log(`   ✓ created (id=${targetClientId}, code=${ins.rows[0].client_code})\n`);
  }

  // 5. Platform customer
  console.log(`📋 Checking platform customer for ${phone}…`);
  // Lookup tolerates either normalized or raw stored format.
  const pcExist = await q(
    `SELECT id, phone_verified FROM platform_customers
      WHERE phone_number IN ($1, $2)`,
    [phone, client.phone_number],
  );
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  let platformCustomerId;
  if (pcExist.rows.length > 0) {
    platformCustomerId = pcExist.rows[0].id;
    await q(
      `UPDATE platform_customers
          SET password_hash  = $1,
              phone_verified = true,
              email_verified = true,
              is_active      = true,
              updated_at     = NOW()
        WHERE id = $2`,
      [passwordHash, platformCustomerId],
    );
    console.log(`   ✓ updated existing customer (id=${platformCustomerId})\n`);
  } else {
    const ins = await q(
      `INSERT INTO platform_customers (
         phone_number, email, id_number, first_name, last_name,
         password_hash, phone_verified, email_verified, is_active,
         registration_tenant_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,true,true,true,$7, NOW(), NOW())
       RETURNING id`,
      [
        phone,
        client.email,
        client.id_number,
        client.first_name,
        client.last_name,
        passwordHash,
        tenant.id,
      ],
    );
    platformCustomerId = ins.rows[0].id;
    console.log(`   ✓ created customer (id=${platformCustomerId})\n`);
  }

  // 6. Link
  console.log(`📋 Linking customer to ${tenant.business_name}…`);
  const linkExist = await q(
    `SELECT id FROM customer_tenant_links
      WHERE platform_customer_id = $1 AND tenant_id = $2`,
    [platformCustomerId, tenant.id],
  );
  if (linkExist.rows.length > 0) {
    await q(
      `UPDATE customer_tenant_links
          SET client_id = $1, status = 'active', last_activity_at = NOW()
        WHERE platform_customer_id = $2 AND tenant_id = $3`,
      [targetClientId, platformCustomerId, tenant.id],
    );
    console.log(`   ✓ link existed — updated\n`);
  } else {
    await q(
      `INSERT INTO customer_tenant_links
         (platform_customer_id, tenant_id, client_id, status, linked_at)
       VALUES ($1, $2, $3, 'active', NOW())`,
      [platformCustomerId, tenant.id, targetClientId],
    );
    console.log(`   ✓ created\n`);
  }

  // 7. Verify
  const v = await q(
    `SELECT pc.id, pc.first_name || ' ' || pc.last_name AS full_name,
            pc.phone_number, pc.phone_verified, pc.email_verified,
            ctl.tenant_id, t.business_name, ctl.client_id, c.client_code
       FROM platform_customers pc
       JOIN customer_tenant_links ctl ON ctl.platform_customer_id = pc.id
       JOIN tenants t ON t.id = ctl.tenant_id
       JOIN clients c ON c.id = ctl.client_id
      WHERE pc.id = $1
      ORDER BY t.business_name`,
    [platformCustomerId],
  );

  const sep = "=".repeat(60);
  console.log(`\n${sep}\n✅ SUCCESS\n${sep}\n`);
  console.log(`📱 Login:`);
  console.log(`   Name:           ${v.rows[0].full_name}`);
  console.log(`   Phone:          ${v.rows[0].phone_number}`);
  console.log(`   Password:       ${PASSWORD}`);
  console.log(
    `   phone_verified: ${v.rows[0].phone_verified ? "yes ✅" : "no ❌"}\n`,
  );
  console.log(`🏢 Linked tenants:`);
  v.rows.forEach((r) =>
    console.log(`   • ${r.business_name} (client: ${r.client_code})`),
  );
  console.log(`\n${sep}`);
  console.log(`💡 In dev:`);
  console.log(`   1. http://localhost:5173/portal/login`);
  console.log(`   2. dev tenant switcher → ${TENANT_SUBDOMAIN}`);
  console.log(`   3. Phone:    ${v.rows[0].phone_number}`);
  console.log(`   4. Password: ${PASSWORD}`);
  console.log(`${sep}\n`);
}

main()
  .catch((err) => {
    console.error("❌ Error:", err.message);
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
