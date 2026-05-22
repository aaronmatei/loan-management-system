import express from "express";
import bcryptjs from "bcryptjs";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { validateEmail, validatePassword } from "../utils/validators.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router();

const VALID_ROLES = ["admin", "manager", "loan_officer", "viewer"];

router.use(verifyToken);

// ============================================================
// SELF-SERVICE (any authenticated user) — must be declared
// BEFORE the admin gate below.
// ============================================================

// Current user info
router.get("/me", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, phone_number, role,
              is_active, last_login, created_at
       FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error("Get current user error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// Change own password
router.post("/me/change-password", async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res
        .status(400)
        .json({ error: "Current and new passwords are required" });
    }
    if (!validatePassword(new_password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }

    const userResult = await query(
      "SELECT password_hash, email FROM users WHERE id = $1",
      [req.user.id],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const isValid = await bcryptjs.compare(
      current_password,
      userResult.rows[0].password_hash,
    );
    if (!isValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const newPasswordHash = await bcryptjs.hash(new_password, 10);
    await query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [newPasswordHash, req.user.id],
    );

    await logAudit({
      user: req.user,
      action: "password_changed",
      entityType: "user",
      entityId: req.user.id,
      entityCode: userResult.rows[0].email,
      description: `User changed their own password`,
      req,
    });

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    logger.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// ============================================================
// ADMIN-ONLY user management. Reuses the existing authorize()
// middleware (same one capital.js uses) rather than a parallel
// role-check module.
// ============================================================
router.use(authorize("admin"));

// List users
router.get("/", async (req, res) => {
  try {
    const ut = tenantClause(req, 0, "u.tenant_id");
    const result = await query(
      `
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.phone_number,
        u.role, u.is_active, u.last_login, u.created_at,
        creator.first_name AS created_by_name
      FROM users u
      LEFT JOIN users creator ON u.created_by = creator.id
      WHERE 1=1${ut.clause}
      ORDER BY u.created_at DESC
    `,
      ut.params,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Create user
router.post("/", async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone_number, role } =
      req.body;

    if (!email || !password || !first_name || !last_name || !role) {
      return res
        .status(400)
        .json({ error: "Email, password, name, and role are required" });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await query("SELECT id FROM users WHERE email = $1", [
      normalizedEmail,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already exists" });
    }

    // username has a UNIQUE constraint; derive from the email local part
    // and add a short suffix on collision so this never 500s.
    let username = normalizedEmail.split("@")[0];
    const usernameTaken = await query(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    if (usernameTaken.rows.length > 0) {
      username = `${username}-${Math.random().toString(16).slice(2, 6)}`;
    }

    const passwordHash = await bcryptjs.hash(password, 10);

    const result = await query(
      `INSERT INTO users (
        tenant_id, username, email, password_hash, first_name, last_name,
        phone_number, role, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING id, email, first_name, last_name, phone_number, role,
                is_active, created_at`,
      [
        req.user?.tenant_id || null,
        username,
        normalizedEmail,
        passwordHash,
        first_name,
        last_name,
        phone_number || null,
        role,
        req.user.id,
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "user",
      entityId: result.rows[0].id,
      entityCode: normalizedEmail,
      description: `Created ${role} user: ${first_name} ${last_name} (${normalizedEmail})`,
      newValues: { email: normalizedEmail, role, first_name, last_name },
      req,
    });

    logger.info(
      `✓ User created: ${normalizedEmail} (${role}) by ${req.user.email}`,
    );

    // ─── TODO: invite email (DISABLED — uncomment to enable) ─────────────
    // Emails the new member their login link + temporary password. To turn on:
    //   1) add at the top of this file:
    //        import { sendEmail } from "../services/emailService.js";
    //   2) uncomment the block below
    //   3) set EMAIL_ENABLED=true + EMAIL_USER/EMAIL_PASSWORD/EMAIL_FROM
    //      (and optionally APP_URL) in the backend env
    // sendEmail() already no-ops unless EMAIL_ENABLED==="true", and returns
    // { success:false } instead of throwing, so it won't break user creation.
    // `password` is the plaintext temp password from req.body.
    /*
    const loginUrl = process.env.APP_URL || "https://app.loanfix.co.ke";
    await sendEmail({
      to: normalizedEmail,
      subject: "You've been invited to LoanFix",
      html: `
        <p>Hi ${first_name},</p>
        <p>An account has been created for you (role: <b>${role}</b>).</p>
        <p><b>Login:</b> <a href="${loginUrl}/login">${loginUrl}/login</a><br/>
           <b>Email:</b> ${normalizedEmail}<br/>
           <b>Temporary password:</b> ${password}</p>
        <p>Please sign in and change your password on first login.</p>
      `,
    });
    */
    // ─────────────────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Update user
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, phone_number, role, is_active } = req.body;

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }

    const xt = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM users WHERE id = $1${xt.clause}`,
      [id, ...xt.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const currentUser = existing.rows[0];

    // Never let an admin lock themselves out.
    if (parseInt(id, 10) === req.user.id && is_active === false) {
      return res
        .status(400)
        .json({ error: "You cannot deactivate your own account" });
    }

    // Don't strand the system without an admin: block demoting or
    // deactivating the last active admin.
    const losingAdmin =
      currentUser.role === "admin" &&
      ((role && role !== "admin") || is_active === false);
    if (losingAdmin) {
      // Per-tenant: each tenant needs its own last active admin.
      const adminCount = await query(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = true AND tenant_id = $1",
        [currentUser.tenant_id],
      );
      if (parseInt(adminCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({
          error: "Cannot demote or deactivate the last active admin",
        });
      }
    }

    const result = await query(
      `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        phone_number = COALESCE($3, phone_number),
        role = COALESCE($4, role),
        is_active = COALESCE($5, is_active),
        updated_at = NOW()
      WHERE id = $6 AND tenant_id = $7
      RETURNING id, email, first_name, last_name, phone_number, role,
                is_active, last_login`,
      [
        first_name ?? null,
        last_name ?? null,
        phone_number ?? null,
        role ?? null,
        is_active ?? null,
        id,
        currentUser.tenant_id,
      ],
    );

    await logAudit({
      user: req.user,
      action: currentUser.role !== (role || currentUser.role)
        ? "status_changed"
        : "updated",
      entityType: "user",
      entityId: id,
      entityCode: currentUser.email,
      description: `Updated user ${currentUser.email}`,
      oldValues: { role: currentUser.role, is_active: currentUser.is_active },
      newValues: { role, is_active, first_name, last_name },
      req,
    });

    res.json({
      success: true,
      message: "User updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update user error:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Reset another user's password (admin)
router.post("/:id/reset-password", async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || !validatePassword(new_password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }

    const rt = tenantClause(req, 1);
    const user = await query(
      `SELECT email, tenant_id FROM users WHERE id = $1${rt.clause}`,
      [id, ...rt.params],
    );
    if (user.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const passwordHash = await bcryptjs.hash(new_password, 10);
    await query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3",
      [passwordHash, id, user.rows[0].tenant_id],
    );

    await logAudit({
      user: req.user,
      action: "password_changed",
      entityType: "user",
      entityId: id,
      entityCode: user.rows[0].email,
      description: `Password reset for user ${user.rows[0].email}`,
      req,
    });

    logger.info(
      `✓ Password reset for ${user.rows[0].email} by ${req.user.email}`,
    );

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    logger.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
