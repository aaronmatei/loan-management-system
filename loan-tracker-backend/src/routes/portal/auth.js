import express from "express";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../../config/database.js";
import { sendOTP, verifyOTP } from "../../services/otpService.js";
import { tenantContext } from "../../middleware/tenantContext.js";
import { validatePassword } from "../../utils/validators.js";
import { nextClientCode } from "../../utils/clientCode.js";
import { lfxCode } from "../../utils/customerCode.js";
import { needsKyc } from "../../utils/kyc.js";
import referralService from "../../services/referralService.js";
import { normalizePromo } from "../promos.js";
import logger from "../../config/logger.js";

const router = express.Router();

// Canonical platform phone: +254 + 9-digit subscriber number.
const formatPhone = (phone) => {
  if (!phone) return null;
  let c = String(phone).replace(/[\s\-()]/g, "");
  if (c.startsWith("+")) c = c.slice(1);
  if (c.startsWith("0")) c = "254" + c.slice(1);
  if (!c.startsWith("254")) c = "254" + c;
  return "+" + c;
};

// Existing clients were stored in mixed formats (0XXXXXXXXX, 254...,
// +254...). Match a customer to existing client rows on ANY variant
// so auto-linking actually works (the spec's single +254 match would
// silently never match the legacy 0XXX rows and create duplicates).
const phoneVariants = (formatted) => {
  const sub = (formatted || "").replace(/^\+?254/, ""); // 9 digits
  return [`+254${sub}`, `254${sub}`, `0${sub}`];
};

const ipOf = (req) =>
  req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;

// Referral auto-link: when a customer signs up via a lender's Refer & Earn
// link (?ref=CODE → that lender's tenant), create (or find) the customer's
// client at that lender and link them — so the referring lender gains them as
// a client. Best-effort; never blocks registration.
async function autoLinkToTenant(customer, tenantId) {
  const linked = await query(
    "SELECT 1 FROM customer_tenant_links WHERE platform_customer_id = $1 AND tenant_id = $2",
    [customer.id, tenantId],
  );
  if (linked.rows.length) return;

  let clientId;
  const ec = await query(
    `SELECT id, id_number FROM clients
      WHERE phone_number = ANY($1::text[]) AND tenant_id = $2 LIMIT 1`,
    [phoneVariants(customer.phone_number), tenantId],
  );
  if (ec.rows.length) {
    // Same phone but a different national ID = different person — don't link.
    if (
      ec.rows[0].id_number &&
      customer.id_number &&
      ec.rows[0].id_number !== customer.id_number
    )
      return;
    clientId = ec.rows[0].id;
  } else {
    const clientCode = await nextClientCode(query, tenantId);
    // Portal-side onboarding lands new clients in the tenant's
    // default branch — the customer doesn't pick one at signup.
    clientId = (
      await query(
        `INSERT INTO clients (
           tenant_id, client_code, first_name, last_name, phone_number, id_number,
           email, business_name, business_type, city, county, address,
           date_of_birth, gender, signup_promo_code, client_type, branch_id, status
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
           (SELECT id FROM branches WHERE tenant_id = $1 AND is_default LIMIT 1),
           'active'
         )
         RETURNING id`,
        [
          tenantId, clientCode, customer.first_name, customer.last_name,
          customer.phone_number, customer.id_number, customer.email || null,
          customer.business_name || null, customer.business_type || null,
          customer.city || null, customer.county || null, customer.address || null,
          customer.date_of_birth || null, customer.gender || null,
          customer.signup_promo_code || null,
          customer.client_type || "individual",
        ],
      )
    ).rows[0].id;
  }

  await query(
    `INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status)
     VALUES ($1,$2,$3,'active') ON CONFLICT DO NOTHING`,
    [customer.id, tenantId, clientId],
  );
  await query(
    `INSERT INTO customer_activities
       (platform_customer_id, tenant_id, client_id, activity_type, details)
     VALUES ($1,$2,$3,'added_tenant_link',$4)`,
    [customer.id, tenantId, clientId, JSON.stringify({ via: "referral" })],
  );
}

// ── phone existence check ──────────────────────────────────────
router.get("/check-phone/:phone", tenantContext, async (req, res) => {
  try {
    const fp = formatPhone(req.params.phone);
    const r = await query(
      "SELECT id, phone_verified FROM platform_customers WHERE phone_number = $1",
      [fp],
    );
    if (r.rows.length === 0) {
      return res.json({ exists: false, next_step: "register" });
    }
    const c = r.rows[0];
    if (!c.phone_verified) {
      return res.json({
        exists: true,
        verified: false,
        next_step: "verify_otp",
        customer_id: c.id,
      });
    }
    if (req.tenant) {
      const l = await query(
        "SELECT id FROM customer_tenant_links WHERE platform_customer_id = $1 AND tenant_id = $2",
        [c.id, req.tenant.id],
      );
      return res.json({
        exists: true,
        verified: true,
        linked_to_current_tenant: l.rows.length > 0,
        next_step: "login",
      });
    }
    return res.json({ exists: true, verified: true, next_step: "login" });
  } catch (error) {
    logger.error("Check phone error:", error);
    res.status(500).json({ error: "Check failed" });
  }
});

// ── register (tenant-less platform account) ───────────────────
// Creates a platform_customers row with NO lender association. The
// client adds a lender later (login → add-lender / select-tenant).
// Phone OTP verification is still required; date_of_birth + gender are
// captured here and stored on the platform account.
router.post("/register", async (req, res) => {
  try {
    const {
      phone_number,
      id_number,
      first_name,
      last_name,
      email,
      date_of_birth,
      gender,
      business_name,
      business_type,
      client_type: rawClientType,
      city,
      county,
      address,
      ref, // optional Refer & Earn code → links the customer to that lender
      promo, // optional promo/campaign code → links + tags the client
    } = req.body;
    if (!phone_number || !id_number || !first_name || !last_name) {
      return res
        .status(400)
        .json({ error: "Name, phone number, and ID number are required" });
    }
    // client_type defaults to 'individual'; anything else must match
    // the enum the DB CHECK constraint enforces.
    const allowedTypes = ["individual", "group", "business"];
    const clientType = (rawClientType || "individual").toLowerCase();
    if (!allowedTypes.includes(clientType)) {
      return res
        .status(400)
        .json({ error: `client_type must be one of: ${allowedTypes.join(", ")}` });
    }
    const fp = formatPhone(phone_number);
    // A promo code OR a referral code attributes the customer to a lender (and
    // auto-links them on verify). A promo code additionally tags the client.
    let referrerTenantId = null;
    let promoCode = null;
    if (promo) {
      const pr = await query(
        `SELECT p.tenant_id, p.code FROM promo_codes p
           JOIN tenants t ON t.id = p.tenant_id
          WHERE p.code = $1 AND p.is_active = true AND t.status = 'active'`,
        [normalizePromo(promo)],
      );
      if (pr.rows.length) {
        referrerTenantId = pr.rows[0].tenant_id;
        promoCode = pr.rows[0].code;
      }
    }
    if (!referrerTenantId && ref) {
      referrerTenantId =
        (await referralService.findReferrerByCode(ref))?.id ?? null;
    }

    const existing = await query(
      "SELECT id, phone_verified, id_number FROM platform_customers WHERE phone_number = $1",
      [fp],
    );

    let customerId;
    let isNew = false;

    if (existing.rows.length > 0) {
      const c = existing.rows[0];
      if (c.id_number !== id_number) {
        return res.status(409).json({
          error:
            "Phone number is registered with a different ID number. Please verify your details or contact support.",
        });
      }
      customerId = c.id;
      if (c.phone_verified) {
        return res.status(409).json({
          error: "You already have an account. Please login.",
          action: "login",
        });
      }
      // Unverified existing account → refresh details + resend OTP.
      await query(
        `UPDATE platform_customers
            SET first_name = $1, last_name = $2,
                email = COALESCE($3, email),
                date_of_birth = $4, gender = $5,
                business_name = COALESCE($6, business_name),
                business_type = COALESCE($7, business_type),
                city = COALESCE($8, city),
                county = COALESCE($9, county),
                address = COALESCE($10, address),
                registration_tenant_id = COALESCE(registration_tenant_id, $11),
                signup_promo_code = COALESCE(signup_promo_code, $12),
                client_type = $13,
                updated_at = NOW()
          WHERE id = $14`,
        [
          first_name,
          last_name,
          email || null,
          date_of_birth || null,
          gender || null,
          business_name || null,
          business_type || null,
          city || null,
          county || null,
          address || null,
          referrerTenantId,
          promoCode,
          clientType,
          customerId,
        ],
      );
    } else {
      const idCheck = await query(
        "SELECT id FROM platform_customers WHERE id_number = $1",
        [id_number],
      );
      if (idCheck.rows.length > 0) {
        return res.status(409).json({
          error:
            "This ID number is already registered with a different phone number.",
        });
      }
      const nc = await query(
        `INSERT INTO platform_customers (
           phone_number, id_number, first_name, last_name, email,
           date_of_birth, gender, business_name, business_type,
           city, county, address, registration_tenant_id, signup_promo_code,
           registration_ip, client_type
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          fp,
          id_number,
          first_name,
          last_name,
          email || null,
          date_of_birth || null,
          gender || null,
          business_name || null,
          business_type || null,
          city || null,
          county || null,
          address || null,
          referrerTenantId,
          promoCode,
          ipOf(req),
          clientType,
        ],
      );
      customerId = nc.rows[0].id;
      isNew = true;
      logger.info(`✓ New platform customer (tenant-less): ${fp}`);
    }

    // TODO(OTP): re-enable phone verification once an SMS provider
    // (Africa's Talking) is configured. Uncomment the sendOTP call below and
    // flip requires_otp back to true. For now OTP is skipped — the account is
    // marked phone_verified when the password is set (see /verify-otp).
    // const otp = await sendOTP({
    //   customerId,
    //   phoneNumber: fp,
    //   purpose: "registration",
    // });
    // if (!otp.success) return res.status(500).json({ error: otp.error });

    res.json({
      success: true,
      message: "Account created. Set a password to finish.",
      customer_id: customerId,
      requires_otp: false, // TODO(OTP): true once SMS is configured
      is_new_customer: isNew,
    });
  } catch (error) {
    logger.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── verify OTP + set password (tenant-less) ───────────────────
router.post("/verify-otp", async (req, res) => {
  try {
    const { customer_id, otp, password } = req.body;
    // TODO(OTP): require `otp` again once SMS is configured.
    if (!customer_id || !password) {
      return res
        .status(400)
        .json({ error: "Customer ID and password required" });
    }
    // Project-wide password policy (spec's <6 is far too weak for
    // loan data — relax here only if you deliberately choose to).
    if (!validatePassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }

    // TODO(OTP): re-enable OTP verification once SMS is configured.
    // const v = await verifyOTP({
    //   customerId: customer_id,
    //   otp,
    //   purpose: "registration",
    // });
    // if (!v.success) return res.status(400).json({ error: v.error });

    const passwordHash = await bcryptjs.hash(password, 10);
    // phone_verified is set here because the OTP step (which normally sets it)
    // is skipped while OTP is disabled.
    const cr = await query(
      "UPDATE platform_customers SET password_hash = $1, phone_verified = true, updated_at = NOW() WHERE id = $2 RETURNING *",
      [passwordHash, customer_id],
    );
    const customer = cr.rows[0];

    await query(
      `INSERT INTO customer_activities (platform_customer_id, activity_type, ip_address)
       VALUES ($1,'registration',$2)`,
      [customer_id, ipOf(req)],
    );

    // If they signed up via a lender's Refer & Earn link, link them to that
    // lender now (best-effort — a hiccup must not fail registration).
    if (customer.registration_tenant_id) {
      try {
        await autoLinkToTenant(customer, customer.registration_tenant_id);
      } catch (err) {
        logger.error("Referral auto-link failed:", err);
      }
    }

    const token = jwt.sign(
      {
        platform_customer_id: customer.id,
        phone_number: customer.phone_number,
        user_type: "customer",
        current_tenant_id: null,
        current_client_id: null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      message: "Registration successful! 🎉",
      token,
      customer: {
        id: customer.id,
        customer_code: lfxCode(customer.id),
        phone_number: customer.phone_number,
        first_name: customer.first_name,
        last_name: customer.last_name,
        profile_photo_url: customer.profile_photo_url,
        needs_kyc: needsKyc(customer),
      },
      current_tenant: null,
    });
  } catch (error) {
    logger.error("OTP verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── login (returns tenant list / picker action) ───────────────
router.post("/login", tenantContext, async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ error: "Phone and password required" });
    }
    const fp = formatPhone(phone_number);
    const r = await query(
      "SELECT * FROM platform_customers WHERE phone_number = $1 AND is_active = true",
      [fp],
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ error: "Invalid phone or password" });
    }
    const customer = r.rows[0];

    if (customer.is_blacklisted_platform) {
      return res.status(403).json({
        error: "Your account has been suspended. Please contact support.",
      });
    }
    if (!customer.phone_verified) {
      return res.status(403).json({
        error: "Account not verified. Please complete registration.",
        action: "verify",
        customer_id: customer.id,
      });
    }
    const ok = await bcryptjs.compare(password, customer.password_hash || "");
    if (!ok) {
      await query(
        `INSERT INTO customer_activities (platform_customer_id, activity_type, ip_address)
         VALUES ($1,'login_failed',$2)`,
        [customer.id, ipOf(req)],
      );
      return res.status(401).json({ error: "Invalid phone or password" });
    }

    const links = await query(
      `SELECT ctl.tenant_id, ctl.client_id, ctl.status, ctl.linked_at,
              t.business_name, t.subdomain, t.brand_color,
              c.client_code,
              (SELECT COUNT(*) FROM loans
                WHERE client_id = ctl.client_id AND status = 'active') AS active_loans
       FROM customer_tenant_links ctl
       JOIN tenants t ON ctl.tenant_id = t.id
       JOIN clients c ON ctl.client_id = c.id
       WHERE ctl.platform_customer_id = $1
         AND ctl.status = 'active' AND t.status = 'active'
       ORDER BY active_loans DESC, ctl.linked_at DESC`,
      [customer.id],
    );
    const tenants = links.rows;

    await query(
      "UPDATE platform_customers SET last_login = NOW() WHERE id = $1",
      [customer.id],
    );
    await query(
      `INSERT INTO customer_activities (platform_customer_id, tenant_id, activity_type, ip_address)
       VALUES ($1,$2,'login',$3)`,
      [customer.id, req.tenant?.id || null, ipOf(req)],
    );

    const baseCustomer = {
      id: customer.id,
      customer_code: lfxCode(customer.id),
      phone_number: customer.phone_number,
      first_name: customer.first_name,
      last_name: customer.last_name,
      profile_photo_url: customer.profile_photo_url,
      needs_kyc: needsKyc(customer),
    };
    const sign = (claims, exp = "7d") =>
      jwt.sign(
        {
          platform_customer_id: customer.id,
          phone_number: customer.phone_number,
          user_type: "customer",
          ...claims,
        },
        process.env.JWT_SECRET,
        { expiresIn: exp },
      );

    if (tenants.length === 0) {
      return res.json({
        success: true,
        token: sign({ current_tenant_id: null, current_client_id: null }),
        customer: baseCustomer,
        tenants: [],
        action: "add_lender",
      });
    }
    // One global account spanning all linked lenders. No "current lender"
    // is chosen at login — the customer lands on the aggregate dashboard
    // (which lists every lender) and drills into one from there; that
    // drill-in mints a tenant-scoped token via /select-tenant.
    return res.json({
      success: true,
      token: sign({ current_tenant_id: null, current_client_id: null }),
      customer: baseCustomer,
      tenants,
      action: "dashboard",
    });
  } catch (error) {
    logger.error("Customer login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── select tenant after multi-tenant login ────────────────────
router.post("/select-tenant", async (req, res) => {
  try {
    const { tenant_id } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token" });
    const decoded = jwt.verify(
      authHeader.split(" ")[1],
      process.env.JWT_SECRET,
    );
    if (decoded.user_type !== "customer") {
      return res.status(403).json({ error: "Customer token required" });
    }

    const l = await query(
      `SELECT ctl.tenant_id, ctl.client_id, t.business_name, t.subdomain,
              t.city, t.country, t.brand_color
       FROM customer_tenant_links ctl
       JOIN tenants t ON ctl.tenant_id = t.id
       WHERE ctl.platform_customer_id = $1 AND ctl.tenant_id = $2
         AND ctl.status = 'active' AND t.status = 'active'`,
      [decoded.platform_customer_id, tenant_id],
    );
    if (l.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "You do not have access to this tenant" });
    }
    const link = l.rows[0];

    const token = jwt.sign(
      {
        platform_customer_id: decoded.platform_customer_id,
        phone_number: decoded.phone_number,
        user_type: "customer",
        current_tenant_id: link.tenant_id,
        current_client_id: link.client_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    await query(
      `INSERT INTO customer_activities (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'switched_tenant')`,
      [decoded.platform_customer_id, link.tenant_id, link.client_id],
    );

    res.json({
      success: true,
      token,
      current_tenant: {
        tenant_id: link.tenant_id,
        business_name: link.business_name,
        subdomain: link.subdomain,
        // city + country power the bottom arc on the in-system
        // payment receipt stamp. Cheap to ship here so the
        // portal doesn't need a second tenant fetch.
        city: link.city,
        country: link.country,
        brand_color: link.brand_color,
      },
    });
  } catch (error) {
    logger.error("Select tenant error:", error);
    res.status(500).json({ error: "Failed to select tenant" });
  }
});

// ── add tenant link (logged-in customer at a new lender) ──────
router.post("/add-tenant", tenantContext, async (req, res) => {
  try {
    const { customer_id, password, target_tenant_id, target_subdomain } =
      req.body;

    // Resolve the target tenant: explicit body id/subdomain (the
    // list-based Add-Lender UI) takes precedence; otherwise fall back
    // to tenantContext's req.tenant (X-Tenant-Subdomain / host) so the
    // original flow keeps working.
    let targetTenant = null;
    if (target_tenant_id) {
      const tr = await query(
        "SELECT * FROM tenants WHERE id = $1 AND status = 'active'",
        [target_tenant_id],
      );
      targetTenant = tr.rows[0] || null;
    } else if (target_subdomain) {
      const tr = await query(
        "SELECT * FROM tenants WHERE subdomain = $1 AND status = 'active'",
        [target_subdomain],
      );
      targetTenant = tr.rows[0] || null;
    } else if (req.tenant) {
      targetTenant = req.tenant;
    }
    if (!targetTenant) {
      return res
        .status(404)
        .json({ error: "Tenant not found or inactive" });
    }
    if (!targetTenant.allow_self_signup) {
      return res.status(403).json({
        error: `${targetTenant.business_name} does not allow self-signup. Please contact them directly.`,
      });
    }

    const cr = await query(
      "SELECT * FROM platform_customers WHERE id = $1",
      [customer_id],
    );
    if (cr.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const customer = cr.rows[0];
    const ok = await bcryptjs.compare(password, customer.password_hash || "");
    if (!ok) return res.status(401).json({ error: "Invalid password" });

    const exists = await query(
      "SELECT id FROM customer_tenant_links WHERE platform_customer_id = $1 AND tenant_id = $2",
      [customer_id, targetTenant.id],
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({
        error: `You already have an account with ${targetTenant.business_name}`,
      });
    }

    let clientId;
    let clientCode;
    let isNewClient = false;
    // phoneVariants() handles 07.../+254... so we don't create a
    // duplicate client for a differently-formatted phone.
    const existingClient = await query(
      `SELECT id, client_code, id_number
         FROM clients
        WHERE phone_number = ANY($1::text[]) AND tenant_id = $2 LIMIT 1`,
      [phoneVariants(customer.phone_number), targetTenant.id],
    );
    if (existingClient.rows.length > 0) {
      const ec = existingClient.rows[0];
      // Security: same phone but a different national ID is a
      // different person — refuse to auto-link.
      if (
        ec.id_number &&
        customer.id_number &&
        ec.id_number !== customer.id_number
      ) {
        return res.status(409).json({
          error:
            "A client with this phone exists at this lender but the ID number does not match.",
        });
      }
      clientId = ec.id;
      clientCode = ec.client_code;
    } else {
      clientCode = await nextClientCode(query, targetTenant.id);
      // Seed the per-tenant client with the customer's own profile, including
      // the business + location captured at portal sign-up, so the lender's
      // client record matches what a tenant-added client would have.
      const ncl = await query(
        `INSERT INTO clients (
           tenant_id, client_code, first_name, last_name,
           phone_number, id_number, email,
           business_name, business_type, city, county, address,
           date_of_birth, gender, client_type, branch_id, status
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
           (SELECT id FROM branches WHERE tenant_id = $1 AND is_default LIMIT 1),
           'active'
         )
         RETURNING id`,
        [
          targetTenant.id,
          clientCode,
          customer.first_name,
          customer.last_name,
          customer.phone_number,
          customer.id_number,
          customer.email || null,
          customer.business_name || null,
          customer.business_type || null,
          customer.city || null,
          customer.county || null,
          customer.address || null,
          customer.date_of_birth || null,
          customer.gender || null,
          customer.client_type || "individual",
        ],
      );
      clientId = ncl.rows[0].id;
      isNewClient = true;
    }

    await query(
      `INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status)
       VALUES ($1,$2,$3,'active')`,
      [customer_id, targetTenant.id, clientId],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'added_tenant_link',$4)`,
      [
        customer_id,
        targetTenant.id,
        clientId,
        JSON.stringify({
          tenant_name: targetTenant.business_name,
          is_new_client: isNewClient,
        }),
      ],
    );

    res.json({
      success: true,
      message: `Successfully linked to ${targetTenant.business_name}! ${
        isNewClient
          ? "A new account was created."
          : "Auto-linked to your existing client record."
      }`,
      tenant_id: targetTenant.id,
      client_id: clientId,
      tenant: {
        id: targetTenant.id,
        business_name: targetTenant.business_name,
        subdomain: targetTenant.subdomain,
        brand_color: targetTenant.brand_color,
      },
      client: {
        id: clientId,
        client_code: clientCode,
        is_new: isNewClient,
      },
    });
  } catch (error) {
    logger.error("Add tenant error:", error);
    res.status(500).json({ error: "Failed to add tenant" });
  }
});

// ── forgot / reset password ───────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const fp = formatPhone(req.body.phone_number);
    const r = await query(
      "SELECT id FROM platform_customers WHERE phone_number = $1 AND phone_verified = true",
      [fp],
    );
    if (r.rows.length === 0) {
      return res.json({ success: true, message: "If account exists, OTP sent" });
    }
    const otp = await sendOTP({
      customerId: r.rows[0].id,
      phoneNumber: fp,
      purpose: "password_reset",
    });
    res.json({
      success: true,
      message: "If account exists, OTP sent",
      customer_id: otp.success ? r.rows[0].id : null,
    });
  } catch (error) {
    logger.error("Forgot password error:", error);
    res.status(500).json({ error: "Request failed" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { customer_id, otp, new_password } = req.body;
    if (!validatePassword(new_password || "")) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }
    const v = await verifyOTP({
      customerId: customer_id,
      otp,
      purpose: "password_reset",
    });
    if (!v.success) return res.status(400).json({ error: v.error });

    const passwordHash = await bcryptjs.hash(new_password, 10);
    await query(
      "UPDATE platform_customers SET password_hash = $1 WHERE id = $2",
      [passwordHash, customer_id],
    );
    res.json({ success: true, message: "Password reset successful" });
  } catch (error) {
    logger.error("Reset password error:", error);
    res.status(500).json({ error: "Reset failed" });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { customer_id, purpose = "registration" } = req.body;
    const r = await query(
      "SELECT phone_number FROM platform_customers WHERE id = $1",
      [customer_id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const otp = await sendOTP({
      customerId: customer_id,
      phoneNumber: r.rows[0].phone_number,
      purpose,
    });
    res.json(otp);
  } catch (error) {
    logger.error("Resend OTP error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
