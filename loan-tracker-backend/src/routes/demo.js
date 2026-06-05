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
import { sendEmail } from "../services/emailService.js";

const router = express.Router();

// Where demo-request leads are emailed (provisional — moves to a team inbox
// later). The interested party is engaged manually, then sent the demo link:
// https://lenderfest.loans/demo
const DEMO_LEADS_TO = "aronique@gmail.com";

// POST /api/demo/request — a lender asks for a guided demo. We email the
// lead; the demo link is sent back by hand after a conversation.
router.post("/request", async (req, res) => {
  try {
    const clean = (s, n = 200) =>
      String(s || "").replace(/[<>]/g, "").trim().slice(0, n);
    const name = clean(req.body?.name, 120);
    const email = clean(req.body?.email, 160);
    const business = clean(req.body?.business_name, 160);
    const lenderType = clean(req.body?.lender_type, 60);
    const phone = clean(req.body?.phone, 40);
    const message = clean(req.body?.message, 1500);

    if (!name || !email) {
      return res.status(400).json({ error: "Your name and email are required." });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const rows = [
      ["Name", name],
      ["Email", email],
      ["Business", business],
      ["Lender type", lenderType],
      ["Phone", phone],
      ["Message", message],
      ["Submitted", new Date().toISOString()],
      ["IP", clean(req.headers["x-forwarded-for"] || req.ip, 60)],
    ].filter(([, v]) => v);

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#122a2e">
        <h2 style="margin:0 0 14px">New LenderFest demo request</h2>
        <table style="border-collapse:collapse;font-size:14px">
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td style="padding:5px 16px 5px 0;color:#64748b;vertical-align:top">${k}</td><td style="padding:5px 0;font-weight:600">${String(v).replace(/\n/g, "<br>")}</td></tr>`,
            )
            .join("")}
        </table>
        <p style="margin-top:18px;color:#64748b;font-size:13px">
          Reply to engage this lead, then send them the demo link:
          <a href="https://lenderfest.loans/demo">https://lenderfest.loans/demo</a>
        </p>
      </div>`;

    const result = await sendEmail({
      to: DEMO_LEADS_TO,
      subject: `Demo request — ${name}${business ? " · " + business : ""}`,
      html,
      fromName: "LenderFest Demo Requests",
    });

    if (!result.success) {
      logger.error("demo request email failed:", result.error);
      return res.status(502).json({
        error: "Could not submit your request right now. Please try again shortly.",
      });
    }
    if (result.disabled) {
      // Email is off in this environment — don't silently lose the lead.
      logger.warn(`Demo request (email disabled): ${name} <${email}> ${business}`);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("demo request error:", err);
    res.status(500).json({ error: "Could not submit your request." });
  }
});

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
