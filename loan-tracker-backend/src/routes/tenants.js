import express from "express";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import pool, { query } from "../config/database.js";
import { validateEmail, validatePassword } from "../utils/validators.js";
import logger from "../config/logger.js";
import referralService from "../services/referralService.js";

const router = express.Router();

const RESERVED = [
  "www", "api", "admin", "app", "mail", "support",
  "help", "docs", "blog", "status",
];

// Default platform billing for a self-registered welfare: a flat monthly fee
// plus 5% of the interest it earns on member loans. The platform admin can
// change either per welfare from the admin billing screen.
const WELFARE_MONTHLY_FEE = 500;
const WELFARE_FEE_PERCENTAGE = 5.0;

// Public tenant signup. Creates tenant + admin user + capital pool +
// company settings in ONE transaction so a partial failure can't
// leave an orphaned tenant. (Requires the multitenancy migration to
// have been applied — the tenants table must exist.)
router.post("/signup", async (req, res) => {
  const {
    business_name,
    business_type,
    subdomain,
    contact_name,
    contact_email,
    contact_phone,
    admin_password,
    physical_address,
    city,
    county,
    referral_code, // optional — set when the user arrived via /signup?ref=
  } = req.body;

  if (
    !business_name ||
    !subdomain ||
    !contact_name ||
    !contact_email ||
    !admin_password
  ) {
    return res
      .status(400)
      .json({ error: "All required fields must be provided" });
  }
  if (!validateEmail(contact_email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  // Use the project-wide password policy, NOT the spec's min-8.
  if (!validatePassword(admin_password)) {
    return res.status(400).json({
      error:
        "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
    });
  }

  const sub = subdomain.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(sub)) {
    return res.status(400).json({
      error:
        "Invalid subdomain. Lowercase letters, numbers, and hyphens only (3-50 chars)",
    });
  }
  if (RESERVED.includes(sub)) {
    return res.status(400).json({ error: "This subdomain is reserved" });
  }

  const client = await pool.connect();
  try {
    const dup = await client.query(
      `SELECT
         (SELECT id FROM tenants WHERE subdomain = $1) AS sub_taken,
         (SELECT id FROM tenants WHERE contact_email = $2) AS email_taken,
         (SELECT id FROM users WHERE LOWER(email) = $2) AS user_taken`,
      [sub, contact_email.toLowerCase()],
    );
    if (dup.rows[0].sub_taken) {
      return res
        .status(409)
        .json({ error: "This subdomain is already taken" });
    }
    if (dup.rows[0].email_taken || dup.rows[0].user_taken) {
      return res
        .status(409)
        .json({ error: "This email is already registered" });
    }

    // tenant_code = TNT{N} where N is one more than the highest existing
    // numeric suffix on a TNT-pattern code. COUNT(*) used to drive this,
    // but it collides whenever a tenant has been deleted (it can return a
    // value that already exists).
    const codeRes = await client.query(
      `SELECT COALESCE(
         MAX(CAST(SUBSTRING(tenant_code FROM '^TNT(\\d+)$') AS INTEGER)), 0
       ) + 1 AS next FROM tenants`,
    );
    const tenantCode = `TNT${String(codeRes.rows[0].next).padStart(5, "0")}`;

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await client.query("BEGIN");

    // Platform-wide new-lender billing defaults (Platform Settings). Fall back
    // to the historic 5% / 0 base when unset.
    const settRes = await client.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('default_fee_percent','default_base_fee')",
    );
    const sett = Object.fromEntries(settRes.rows.map((r) => [r.key, r.value]));
    const defFee = Number.parseFloat(sett.default_fee_percent);
    const feePct = Number.isFinite(defFee) ? defFee : 5.0;
    const defBase = Number.parseFloat(sett.default_base_fee);
    const baseFee = Number.isFinite(defBase) ? defBase : 0;

    const tRes = await client.query(
      `INSERT INTO tenants (
        tenant_code, business_name, business_type, subdomain,
        contact_name, contact_email, contact_phone,
        physical_address, city, county,
        plan, status, trial_ends_at,
        platform_fee_percentage, billing_fee_percentage, billing_base_fee,
        max_clients, max_loans, max_users
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'trial','onboarding',$11,$12,$12,$13,50,50,3)
      RETURNING *`,
      [
        tenantCode,
        business_name,
        business_type || "private",
        sub,
        contact_name,
        contact_email.toLowerCase(),
        contact_phone || null,
        physical_address || null,
        city || null,
        county || null,
        trialEndsAt,
        feePct,
        baseFee,
      ],
    );
    const tenant = tRes.rows[0];

    // Seed the default "Main" branch — every tenant must have at
    // least one, since create-client flows fall back to the default
    // when no branch is picked. Mirrors migration 036's existing-
    // tenant seed for fresh signups.
    await client.query(
      `INSERT INTO branches (tenant_id, name, is_default, active)
       VALUES ($1, 'Main', TRUE, TRUE)`,
      [tenant.id],
    );

    const [firstName, ...rest] = contact_name.trim().split(/\s+/);
    const lastName = rest.join(" ") || "User";

    // username is globally unique — derive + suffix on collision
    let username = contact_email.toLowerCase().split("@")[0];
    const uTaken = await client.query(
      "SELECT 1 FROM users WHERE username = $1",
      [username],
    );
    if (uTaken.rows.length > 0) {
      username = `${username}-${Math.random().toString(16).slice(2, 6)}`;
    }

    const passwordHash = await bcryptjs.hash(admin_password, 10);
    const uRes = await client.query(
      `INSERT INTO users (
        tenant_id, username, email, password_hash,
        first_name, last_name, phone_number, role,
        is_active, is_platform_admin
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'admin',true,false)
      RETURNING id, email, first_name, last_name, role`,
      [
        tenant.id,
        username,
        contact_email.toLowerCase(),
        passwordHash,
        firstName,
        lastName,
        contact_phone || null,
      ],
    );
    const user = uRes.rows[0];

    await client.query(
      `INSERT INTO capital_pool
         (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned)
       VALUES ($1, 0, 0, 0, 0)`,
      [tenant.id],
    );

    // Seed the 11 default expense categories — same set migration 031
    // backfilled for existing tenants. ON CONFLICT keeps it idempotent
    // if a migration re-run also touched this tenant.
    await client.query(
      `INSERT INTO expense_categories (tenant_id, name, icon, is_default, sort_order)
       VALUES
         ($1, 'Salaries & Wages',                'users',          true, 10),
         ($1, 'Communication (Airtime, SMS, Internet)', 'phone',  true, 20),
         ($1, 'Office Supplies & Equipment',     'package',        true, 30),
         ($1, 'Transport & Travel',              'car',            true, 40),
         ($1, 'Printing & Stationery',           'printer',        true, 50),
         ($1, 'Transaction Charges',             'credit-card',    true, 60),
         ($1, 'Default Follow-up Costs',         'alert-triangle', true, 70),
         ($1, 'Rent & Utilities',                'home',           true, 80),
         ($1, 'Marketing & Promotion',           'megaphone',      true, 90),
         ($1, 'Platform Billing',                'receipt',        true, 95),
         ($1, 'Other',                           'more-horizontal',true, 100)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenant.id],
    );

    await client.query(
      `INSERT INTO company_settings
         (tenant_id, company_name, company_address, company_phone, company_email)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tenant.id,
        business_name,
        physical_address || "",
        contact_phone || "",
        contact_email.toLowerCase(),
      ],
    );

    // Stamp this tenant's own referral code so they can refer others
    // from day one. Done inside the signup transaction so we never
    // leave a tenant without one. The deterministic format matches
    // referralService.generateCode + the backfill in migration 016.
    const newCode = referralService.generateCode(tenant.subdomain, tenant.id);
    const codeRow = await client.query(
      `UPDATE tenants SET referral_code = $1 WHERE id = $2
       RETURNING referral_code`,
      [newCode, tenant.id],
    );
    tenant.referral_code = codeRow.rows[0]?.referral_code || newCode;

    await client.query("COMMIT");

    // Inbound referral: recorded AFTER commit so a referral hiccup
    // can never roll back a successful signup. recordReferral never
    // throws — it returns null on misses.
    if (referral_code) {
      await referralService.recordReferral(referral_code, tenant);
    }

    // Auto-login into onboarding: the tenant is created 'onboarding' and can
    // complete the setup wizard. Finishing onboarding flips them to 'pending'
    // (awaiting a platform admin's review) — see routes/onboarding.js.
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: "admin",
        tenant_id: tenant.id,
        is_platform_admin: false,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "7d" },
    );

    logger.info(`🎉 New tenant signed up (onboarding): ${business_name} (${sub})`);

    res.status(201).json({
      success: true,
      message: "Welcome! Complete a few setup steps and we'll review your account.",
      token,
      tenant: {
        id: tenant.id,
        business_name: tenant.business_name,
        subdomain: tenant.subdomain,
        plan: tenant.plan,
        referral_code: tenant.referral_code,
      },
      user,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Signup error:", error);
    res.status(500).json({ error: "Failed to create account" });
  } finally {
    client.release();
  }
});

// Public WELFARE signup. Creates a welfare account (a tenant of kind='welfare')
// + its admin user + one welfare group, in one transaction. Reuses the tenant
// engine but the account is welfare-only: kind='welfare' drives a welfare
// experience (members, contributions pool, pool lending) with lender features
// hidden. Not related to lender tenants.
router.post("/welfare-signup", async (req, res) => {
  const {
    welfare_name,
    subdomain,
    contact_name,
    contact_email,
    contact_phone,
    admin_password,
    registration_number,
    city,
    county,
  } = req.body;

  if (!welfare_name || !subdomain || !contact_name || !contact_email || !admin_password) {
    return res.status(400).json({ error: "All required fields must be provided" });
  }
  if (!validateEmail(contact_email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  if (!validatePassword(admin_password)) {
    return res.status(400).json({
      error:
        "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
    });
  }

  const sub = subdomain.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(sub)) {
    return res.status(400).json({
      error: "Invalid subdomain. Lowercase letters, numbers, and hyphens only (3-50 chars)",
    });
  }
  if (RESERVED.includes(sub)) {
    return res.status(400).json({ error: "This subdomain is reserved" });
  }

  const client = await pool.connect();
  try {
    const dup = await client.query(
      `SELECT
         (SELECT id FROM tenants WHERE subdomain = $1) AS sub_taken,
         (SELECT id FROM tenants WHERE contact_email = $2) AS email_taken,
         (SELECT id FROM users WHERE LOWER(email) = $2) AS user_taken`,
      [sub, contact_email.toLowerCase()],
    );
    if (dup.rows[0].sub_taken) {
      return res.status(409).json({ error: "This subdomain is already taken" });
    }
    if (dup.rows[0].email_taken || dup.rows[0].user_taken) {
      return res.status(409).json({ error: "This email is already registered" });
    }

    const codeRes = await client.query(
      `SELECT COALESCE(
         MAX(CAST(SUBSTRING(tenant_code FROM '^TNT(\\d+)$') AS INTEGER)), 0
       ) + 1 AS next FROM tenants`,
    );
    const tenantCode = `TNT${String(codeRes.rows[0].next).padStart(5, "0")}`;

    await client.query("BEGIN");

    const tRes = await client.query(
      `INSERT INTO tenants (
        tenant_code, business_name, business_type, kind, subdomain,
        registration_number, contact_name, contact_email, contact_phone,
        city, county, plan, status,
        billing_enabled, billing_base_fee, billing_fee_percentage
      ) VALUES ($1,$2,'welfare','welfare',$3,$4,$5,$6,$7,$8,$9,'trial','pending',
                true,$10,$11)
      RETURNING *`,
      [
        tenantCode,
        welfare_name,
        sub,
        registration_number || null,
        contact_name,
        contact_email.toLowerCase(),
        contact_phone || null,
        city || null,
        county || null,
        WELFARE_MONTHLY_FEE,
        WELFARE_FEE_PERCENTAGE,
      ],
    );
    const tenant = tRes.rows[0];

    const [firstName, ...rest] = contact_name.trim().split(/\s+/);
    const lastName = rest.join(" ") || "User";
    let username = contact_email.toLowerCase().split("@")[0];
    const uTaken = await client.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (uTaken.rows.length > 0) {
      username = `${username}-${Math.random().toString(16).slice(2, 6)}`;
    }
    const passwordHash = await bcryptjs.hash(admin_password, 10);
    const uRes = await client.query(
      `INSERT INTO users (
        tenant_id, username, email, password_hash,
        first_name, last_name, phone_number, role, is_active, is_platform_admin
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'admin',true,false)
      RETURNING id, email, first_name, last_name, role`,
      [tenant.id, username, contact_email.toLowerCase(), passwordHash, firstName, lastName, contact_phone || null],
    );
    const user = uRes.rows[0];

    // Company settings (used by PDFs) + the welfare's own group, so members /
    // pool / loans have somewhere to live from day one.
    await client.query(
      `INSERT INTO company_settings (tenant_id, company_name, company_phone, company_email)
       VALUES ($1, $2, $3, $4)`,
      [tenant.id, welfare_name, contact_phone || "", contact_email.toLowerCase()],
    );
    const gRes = await client.query(
      `INSERT INTO groups (tenant_id, group_code, name, registration_no, status, created_by)
       VALUES ($1, 'GRP-00001', $2, $3, 'active', $4) RETURNING id`,
      [tenant.id, welfare_name, registration_number || null, user.id],
    );
    const welfareGroupId = gRes.rows[0].id;

    await client.query("COMMIT");

    logger.info(`🤝 New welfare signed up (pending review): ${welfare_name} (${sub})`);

    // No auto-login: welfare accounts are also created 'pending' and go live
    // once a platform admin approves them.
    res.status(201).json({
      success: true,
      pending: true,
      message:
        "Your welfare account has been created and is pending review. We'll notify you once it's approved.",
      welfare_group_id: welfareGroupId,
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        business_name: tenant.business_name,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Welfare signup error:", error);
    res.status(500).json({ error: "Failed to create welfare account" });
  } finally {
    client.release();
  }
});


// Subdomain availability (signup form)
router.get("/check-subdomain/:subdomain", async (req, res) => {
  try {
    const sub = req.params.subdomain.toLowerCase();
    if (RESERVED.includes(sub)) {
      return res.json({ available: false, reason: "reserved" });
    }
    const r = await query(
      "SELECT id FROM tenants WHERE subdomain = $1",
      [sub],
    );
    res.json({
      available: r.rows.length === 0,
      reason: r.rows.length > 0 ? "taken" : null,
    });
  } catch (error) {
    logger.error("check-subdomain error:", error);
    res.status(500).json({ error: "Failed to check subdomain" });
  }
});

export default router;
