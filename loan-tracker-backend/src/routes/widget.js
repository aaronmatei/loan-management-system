import express from "express";
import { query } from "../config/database.js";
import logger from "../config/logger.js";

const router = express.Router();

// Allow this endpoint to be fetched from any origin (the widget is
// designed to be iframed onto third-party sites). Per-response ACAO
// header — we don't touch the global CORS config the rest of the API
// depends on. NOTE: spec used `X-Frame-Options: ALLOWALL` which is
// not a valid value; iframe-ability is governed by the SPA host's
// CSP/frame-ancestors, not by the JSON API.
const cors = (res) =>
  res.set("Access-Control-Allow-Origin", "*");

// GET /api/widget/calculator/:subdomain  (PUBLIC, no auth)
router.get("/calculator/:subdomain", async (req, res) => {
  try {
    const result = await query(
      `SELECT
         id, business_name, subdomain,
         logo_url, brand_color,
         support_email, support_phone,
         hide_platform_branding, white_label_tier,
         custom_domain,
         physical_address, city, county,
         -- Per-tenant loan policy (migration 012). Coalesced in case
         -- a row pre-dates the migration's UPDATE backfill.
         COALESCE(default_interest_rate, 50.00) AS default_interest_rate,
         COALESCE(min_loan_amount,       1000)  AS min_amount,
         COALESCE(max_loan_amount,    1000000)  AS max_amount,
         24                                     AS max_duration_months,
         COALESCE(default_loan_duration, 6)     AS default_duration_months
       FROM tenants
       WHERE subdomain = $1 AND status = 'active'`,
      [req.params.subdomain],
    );
    cors(res);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error("Widget data error:", error);
    res.status(500).json({ error: "Failed to fetch widget data" });
  }
});

// POST /api/widget/track/:subdomain  (PUBLIC, no auth)
// Best-effort analytics into customer_activities (jsonb details).
// Errors here MUST NOT break the embedded calculator.
router.post("/track/:subdomain", async (req, res) => {
  cors(res);
  try {
    const { event, data } = req.body || {};
    const tr = await query(
      "SELECT id FROM tenants WHERE subdomain = $1",
      [req.params.subdomain],
    );
    if (tr.rows.length > 0) {
      await query(
        `INSERT INTO customer_activities
           (tenant_id, activity_type, details, ip_address, user_agent)
         VALUES ($1, 'widget_event', $2, $3, $4)`,
        [
          tr.rows[0].id,
          JSON.stringify({ event, ...(data || {}) }),
          req.ip || null,
          req.get("User-Agent") || null,
        ],
      );
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Widget track error:", error);
    res.json({ success: false });
  }
});

export default router;
