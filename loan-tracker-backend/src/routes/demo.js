// Public endpoints for the shared demo tenant. Mounted at /api/demo.
//
// POST /api/demo/start    Mints a 2-hour JWT pointing at the demo
//                         tenant's admin user. No auth required —
//                         this is the "Try Live Demo" door.
// POST /api/demo/convert  Marks a demo session as converted when a
//                         visitor clicks "Sign Up Free" in the banner.
//
// All real-side-effect code paths (notifications, billing cron) check
// tenant.is_demo and skip — so the demo can be used freely without
// any actual SMS, email, or auto-suspension events firing.

import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { query } from "../config/database.js";
import logger from "../config/logger.js";

const router = express.Router();

router.post("/start", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         u.id  AS user_id, u.first_name, u.last_name, u.email, u.role,
         u.tenant_id,
         t.business_name, t.subdomain, t.brand_color
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE t.subdomain = 'demo' AND t.is_demo = true
       LIMIT 1`,
    );
    if (r.rows.length === 0) {
      return res
        .status(503)
        .json({ error: "Demo not available. Please try again later." });
    }
    const d = r.rows[0];

    const token = jwt.sign(
      {
        id: d.user_id,
        tenant_id: d.tenant_id,
        email: d.email,
        role: d.role,
        is_platform_admin: false,
        is_demo: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );

    // Best-effort session-tracking row (non-fatal on failure)
    const sessionToken = crypto.randomBytes(16).toString("hex");
    await query(
      `INSERT INTO demo_sessions (session_token, ip_address, user_agent)
       VALUES ($1, $2, $3)`,
      [
        sessionToken,
        req.headers["x-forwarded-for"] || req.ip,
        req.get("User-Agent") || null,
      ],
    ).catch((err) => logger.warn("demo_sessions insert failed:", err.message));

    res.json({
      success: true,
      token,
      session_token: sessionToken,
      // Mirror the /api/auth/login response shape so the frontend
      // can re-use the same { token, user } storage.
      user: {
        id: d.user_id,
        first_name: d.first_name,
        last_name: d.last_name,
        full_name: `${d.first_name} ${d.last_name}`.trim(),
        email: d.email,
        role: d.role,
        tenant_id: d.tenant_id,
        is_platform_admin: false,
        is_demo: true,
        tenant: {
          id: d.tenant_id,
          subdomain: d.subdomain,
          business_name: d.business_name,
          brand_color: d.brand_color,
        },
      },
    });
  } catch (err) {
    logger.error("demo start error:", err);
    res.status(500).json({ error: "Failed to start demo" });
  }
});

router.post("/convert", async (req, res) => {
  try {
    const { session_token } = req.body || {};
    if (session_token) {
      await query(
        `UPDATE demo_sessions
            SET converted_to_signup = true, last_active_at = NOW()
          WHERE session_token = $1`,
        [session_token],
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.warn("demo convert error:", err.message);
    res.json({ success: false });
  }
});

export default router;
