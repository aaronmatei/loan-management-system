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

    const tRes = await client.query(
      `INSERT INTO tenants (
        tenant_code, business_name, business_type, subdomain,
        contact_name, contact_email, contact_phone,
        physical_address, city, county,
        plan, status, trial_ends_at,
        platform_fee_percentage, max_clients, max_loans, max_users
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'trial','active',$11,5.00,50,50,3)
      RETURNING *`,
      [
        tenantCode,
        business_name,
        business_type || "microfinance",
        sub,
        contact_name,
        contact_email.toLowerCase(),
        contact_phone || null,
        physical_address || null,
        city || null,
        county || null,
        trialEndsAt,
      ],
    );
    const tenant = tRes.rows[0];

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

    logger.info(`🎉 New tenant signed up: ${business_name} (${sub})`);

    res.status(201).json({
      success: true,
      message: "Welcome! Your 14-day trial has started.",
      token,
      tenant: {
        id: tenant.id,
        business_name: tenant.business_name,
        subdomain: tenant.subdomain,
        plan: tenant.plan,
        trial_ends_at: tenant.trial_ends_at,
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
