import express from "express";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../config/database.js";
import logger from "../config/logger.js";
import { validateEmail, validatePassword } from "../utils/validators.js";
import { logAudit } from "../services/auditService.js";

const router = express.Router();

// Login
router.post("/login", async (req, res) => {
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

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
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
      },
    });
  } catch (error) {
    logger.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Register (admin only)
router.post("/register", async (req, res) => {
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

    // Check if user exists
    const existing = await query(
      "SELECT id FROM users WHERE email = $1 OR username = $2",
      [email, username],
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Create user
    const result = await query(
      "INSERT INTO users (username, email, password_hash, first_name, last_name, role, is_active) VALUES ($1, $2, $3, $4, $5, $6,true) RETURNING id, email, full_name, role",
      [
        username,
        email,
        hashedPassword,
        first_name,
        last_name,
        role || "loan_officer",
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "user",
      entityId: result.rows[0].id,
      entityCode: email,
      description: `Registered user ${email} (role: ${role || "loan_officer"})`,
      newValues: { username, email, role: role || "loan_officer" },
      req,
    });

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    logger.error("Registration error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

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
