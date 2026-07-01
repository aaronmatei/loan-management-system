import express from "express";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../config/database.js";
import logger from "../config/logger.js";
import { validateEmail, validatePassword } from "../utils/validators.js";
import { validate, body } from "../utils/validate.js";
import { captureException } from "../config/sentry.js";
import { logAudit } from "../services/auditService.js";
import { verifyToken, authorize } from "../middleware/auth.js";

const router = express.Router();

// Mirrors the role set enforced in users.js.
const VALID_ROLES = ["admin", "manager", "loan_officer", "viewer"];

// Login
router.post(
  "/login",
  // Shape validation before the bcrypt compare so a request without a
  // body (or with the wrong types) never reaches the DB lookup. The
  // ad-hoc "email and password required" check below now only fires
  // on the email-format / max-length cases this catches first.
  validate(
    body("email")
      .isEmail()
      .withMessage("must be a valid email")
      .isLength({ max: 254 })
      .normalizeEmail({ gmail_remove_dots: false }),
    body("password")
      .isString()
      .withMessage("required")
      .isLength({ min: 1, max: 256 })
      .withMessage("required"),
  ),
  async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // ✅ Updated query to include first_name and last_name
    const result = await query(
      "SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = $1",
      [email],
    );

    const user = result.rows[0];

    if (!user) {
      await logAudit({
        user: { id: null, email },
        action: "login_failed",
        entityType: "user",
        entityCode: email,
        description: `Failed login attempt for ${email} (no such user)`,
        req,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.is_active) {
      await logAudit({
        user,
        action: "login_failed",
        entityType: "user",
        entityId: user.id,
        entityCode: email,
        description: `Failed login for ${email} (account inactive)`,
        req,
      });
      return res.status(401).json({ error: "Account is inactive" });
    }

    // Verify password
    const isValidPassword = await bcryptjs.compare(
      password,
      user.password_hash,
    );
    if (!isValidPassword) {
      await logAudit({
        user,
        action: "login_failed",
        entityType: "user",
        entityId: user.id,
        entityCode: email,
        description: `Failed login for ${email} (wrong password)`,
        req,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Enrich with tenant info. Guarded so this keeps working BEFORE
    // the multitenancy migration runs (tenants table / tenant_id
    // columns don't exist yet → fall back to single-tenant). After
    // the migration this transparently becomes tenant-aware.
    let t = {};
    try {
      const tr = await query(
        `SELECT u.tenant_id, u.is_platform_admin,
                tn.subdomain, tn.business_name, tn.business_type, tn.kind AS tenant_kind,
                tn.plan AS tenant_plan, tn.status AS tenant_status,
                tn.brand_color, tn.city, tn.country
         FROM users u
         LEFT JOIN tenants tn ON u.tenant_id = tn.id
         WHERE u.id = $1`,
        [user.id],
      );
      t = tr.rows[0] || {};
    } catch {
      t = {}; // pre-migration: stay single-tenant
    }

    // Block non-active tenants (platform admins exempt). Message is
    // status-specific — pending accounts are awaiting approval, not suspended.
    if (
      t.tenant_id &&
      !t.is_platform_admin &&
      t.tenant_status &&
      t.tenant_status !== "active"
    ) {
      const gates = {
        pending: {
          error: "Account pending approval",
          message:
            "Your account is awaiting review. We'll email you as soon as it's approved.",
          code: "TENANT_PENDING",
        },
        rejected: {
          error: "Application not approved",
          message:
            "Your account application was not approved. Please contact support.",
          code: "TENANT_REJECTED",
        },
        cancelled: {
          error: "Account cancelled",
          message: "This account has been cancelled.",
          code: "TENANT_CANCELLED",
        },
      };
      return res.status(403).json(
        gates[t.tenant_status] || {
          error: "Account suspended",
          message:
            "Your business account is currently suspended. Please contact support.",
          code: "TENANT_SUSPENDED",
        },
      );
    }

    // Generate JWT token (include tenant claims only when present)
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        ...(t.tenant_id
          ? {
              tenant_id: t.tenant_id,
              is_platform_admin: !!t.is_platform_admin,
            }
          : {}),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "7d" },
    );

    // Update last login
    await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

    await logAudit({
      user,
      action: "login",
      entityType: "user",
      entityId: user.id,
      entityCode: user.email,
      description: `User logged in`,
      req,
    });

    logger.info(`✓ Login successful: ${email}`);

    // ✅ Return user with first_name and last_name
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: `${user.first_name} ${user.last_name}`, // Computed full name
        role: user.role,
        tenant_id: t.tenant_id || null,
        is_platform_admin: !!t.is_platform_admin,
        tenant: t.tenant_id
          ? {
              id: t.tenant_id,
              subdomain: t.subdomain,
              business_name: t.business_name,
              business_type: t.business_type,
              kind: t.tenant_kind || "lender",
              plan: t.tenant_plan,
              brand_color: t.brand_color,
              // city + country drive the bottom arc on the
              // in-system Payment Receipt stamp. Cheap to
              // include here so receipts don't need a separate
              // tenant fetch at render time.
              city: t.city,
              country: t.country,
            }
          : null,
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    // Don't capture credential failures (those are 401 from above);
    // this path only fires on infra problems — DB, bcrypt, JWT sign.
    captureException(error, { route: { method: "POST", path: "/api/auth/login" } });
    res.status(500).json({ error: "Server error" });
  }
  },
);

// Register a staff user (admin only). Creates the user inside the calling
// admin's tenant. POST /api/users is the primary user-management endpoint;
// this is the explicit-username registration variant and shares its rules.
router.post(
  "/register",
  verifyToken,
  authorize("admin"),
  // Same name rules as POST /users — these are two paths into the
  // same staff record, the username field is the only meaningful
  // difference. validators.js still owns the password-strength
  // policy below.
  validate(
    body("username")
      .isString()
      .withMessage("required")
      .trim()
      .isLength({ min: 3, max: 50 })
      .withMessage("must be 3-50 characters")
      .matches(/^[A-Za-z0-9._-]+$/)
      .withMessage("only letters, digits, '.', '_' and '-' allowed"),
    body("first_name")
      .optional({ checkFalsy: true })
      .isString()
      .trim()
      .isLength({ min: 1, max: 50 })
      .matches(/^[A-Za-z][A-Za-z\s'-]*$/)
      .withMessage(
        "letters only — spaces, hyphens and apostrophes ok; no digits or symbols",
      ),
    body("last_name")
      .optional({ checkFalsy: true })
      .isString()
      .trim()
      .isLength({ min: 1, max: 50 })
      .matches(/^[A-Za-z][A-Za-z\s'-]*$/)
      .withMessage(
        "letters only — spaces, hyphens and apostrophes ok; no digits or symbols",
      ),
    body("email")
      .isEmail()
      .withMessage("must be a valid email")
      .isLength({ max: 254 })
      .normalizeEmail({ gmail_remove_dots: false }),
    body("role")
      .optional({ checkFalsy: true })
      .isIn(["admin", "manager", "loan_officer", "viewer"])
      .withMessage("must be admin / manager / loan_officer / viewer"),
  ),
  async (req, res) => {
  try {
    const { username, email, password, first_name, last_name, role } = req.body;

    // Validate input
    if (!email || !password || !username) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with uppercase, number, and special character",
      });
    }

    const userRole = role || "loan_officer";
    if (!VALID_ROLES.includes(userRole)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    // users.tenant_id is NOT NULL — take it from the admin's token so the
    // new user lands in the admin's own tenant.
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "No tenant context for this account" });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if user exists
    const existing = await query(
      "SELECT id FROM users WHERE email = $1 OR username = $2",
      [normalizedEmail, username],
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Create user
    const result = await query(
      `INSERT INTO users
         (tenant_id, username, email, password_hash, first_name, last_name, role, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       RETURNING id, email, first_name, last_name, role, tenant_id`,
      [
        tenantId,
        username,
        normalizedEmail,
        hashedPassword,
        first_name,
        last_name,
        userRole,
        req.user.id,
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "user",
      entityId: result.rows[0].id,
      entityCode: normalizedEmail,
      description: `Registered user ${normalizedEmail} (role: ${userRole})`,
      newValues: { username, email: normalizedEmail, role: userRole },
      req,
    });

    logger.info(`New user registered: ${normalizedEmail}`);

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    logger.error("Registration error:", error);
    if (error.code === "22001") {
      return res
        .status(400)
        .json({ error: "One of the fields is too long. Shorten it and try again." });
    }
    if (error.code === "23505") {
      return res
        .status(409)
        .json({ error: "A user with this email or username already exists." });
    }
    captureException(error, {
      route: { method: "POST", path: "/api/auth/register" },
      tenant_id: req.user?.tenant_id,
    });
    res.status(500).json({ error: "Server error" });
  }
  },
);

// Verify token
router.post("/verify-token", (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (req.headers.authorization?.split(" ")[0] !== "Bearer ") {
      return res.status(401).json({ error: "Token MUST be Bearer " });
    }

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ valid: false, error: "Invalid token" });
  }
});

export default router;
