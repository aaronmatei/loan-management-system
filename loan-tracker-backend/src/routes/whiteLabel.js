import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();

// Fields that any tier can edit. Tier-gated fields are added on top
// of this in the PUT handler below.
const BASIC_FIELDS = ["brand_color"];
const PRO_FIELDS = [
  "hide_platform_branding",
  "favicon_url",
  "email_sender_name",
  "sms_sender_id",
  "email_signature",
  "report_header_text",
  "report_footer_text",
  "support_email",
  "support_phone",
];
const ENTERPRISE_FIELDS = [
  "custom_domain",
  "custom_email_domain",
  "terms_url",
  "privacy_url",
  "custom_portal_title",
  "custom_portal_tagline",
  "custom_login_image_url",
];

// Public: branding by subdomain (used by the customer portal /
// signed-out pages to pick up logo, favicon, colors). No auth.
router.get("/branding/:subdomain", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         business_name, subdomain, logo_url, brand_color,
         favicon_url,
         custom_portal_title, custom_portal_tagline,
         custom_login_image_url,
         hide_platform_branding, white_label_tier,
         support_email, support_phone,
         terms_url, privacy_url
       FROM tenants
       WHERE subdomain = $1 AND status = 'active'`,
      [req.params.subdomain],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error("Get branding error:", error);
    res.status(500).json({ error: "Failed to fetch branding" });
  }
});

// Everything below is authenticated.
router.use(verifyToken);

router.get("/settings", async (req, res) => {
  try {
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const r = await query(
      `SELECT
         white_label_tier,
         hide_platform_branding, favicon_url, email_sender_name,
         sms_sender_id, email_signature, report_header_text,
         report_footer_text, support_email, support_phone,
         custom_domain, custom_email_domain, terms_url, privacy_url,
         custom_portal_title, custom_portal_tagline,
         custom_login_image_url,
         logo_url, brand_color, business_name, subdomain
       FROM tenants WHERE id = $1`,
      [tid],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error("Get white label settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    const tid = req.user?.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });

    const tr = await query(
      "SELECT white_label_tier FROM tenants WHERE id = $1",
      [tid],
    );
    const tier = tr.rows[0]?.white_label_tier || "basic";

    // Which fields is this tier allowed to write?
    let allowed = [...BASIC_FIELDS];
    if (tier === "pro" || tier === "enterprise")
      allowed = allowed.concat(PRO_FIELDS);
    if (tier === "enterprise") allowed = allowed.concat(ENTERPRISE_FIELDS);

    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, f)) {
        params.push(req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }
    if (sets.length === 0) {
      // Body had only out-of-tier fields (or nothing). For basic
      // tenants who tried to touch pro/enterprise fields, that's a
      // permissions message; for everyone else it's just nothing.
      const hadOutOfTier = Object.keys(req.body || {}).some(
        (k) => !allowed.includes(k),
      );
      if (hadOutOfTier && tier === "basic") {
        return res.status(403).json({
          error:
            "White-label customization requires Pro or Enterprise plan.",
        });
      }
      return res.status(400).json({ error: "No allowed updates provided" });
    }
    params.push(tid);
    await query(
      `UPDATE tenants SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params,
    );

    logger.info(
      `White label settings updated for tenant ${tid} (tier=${tier}, ${sets.length} fields)`,
    );
    res.json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    logger.error("Update white label error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// Platform admin only — change a tenant's tier.
router.put("/admin/:tenant_id/tier", async (req, res) => {
  try {
    if (!req.user?.is_platform_admin) {
      return res.status(403).json({ error: "Platform admin only" });
    }
    const { tier } = req.body || {};
    if (!["basic", "pro", "enterprise"].includes(tier)) {
      return res.status(400).json({ error: "Invalid tier" });
    }
    const r = await query(
      `UPDATE tenants SET white_label_tier = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, business_name, white_label_tier`,
      [tier, req.params.tenant_id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    logger.info(
      `Platform admin ${req.user.email} set tenant ${req.params.tenant_id} tier -> ${tier}`,
    );
    res.json({
      success: true,
      message: `Tenant upgraded to ${tier} tier`,
      data: r.rows[0],
    });
  } catch (error) {
    logger.error("Upgrade tier error:", error);
    res.status(500).json({ error: "Failed to upgrade tier" });
  }
});

export default router;
