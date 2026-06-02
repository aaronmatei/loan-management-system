// Promo / campaign codes API (tenant-scoped, except the public validate route).
//
// A tenant creates named codes and shares /portal/register?promo=<code>.
// Customers who sign up with a code are auto-linked to the tenant (see
// routes/portal/auth.js) and tagged with the code on their client record, so the
// tenant can see who came from each campaign.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantContext, requireTenant } from "../middleware/tenantContext.js";
import logger from "../config/logger.js";

const router = express.Router();

// Codes are case-insensitive and alphanumeric (so they're URL-clean).
export const normalizePromo = (c) =>
  String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const authed = [verifyToken, tenantContext, requireTenant];

// List the tenant's promo codes with signup counts.
router.get("/", ...authed, async (req, res) => {
  try {
    const r = await query(
      `SELECT p.id, p.code, p.label, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM clients c
                 WHERE c.tenant_id = p.tenant_id AND c.signup_promo_code = p.code)::int
                AS signups
         FROM promo_codes p
        WHERE p.tenant_id = $1
        ORDER BY p.created_at DESC`,
      [req.user.tenant_id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("List promos error:", e);
    res.status(500).json({ error: "Failed to fetch promo codes" });
  }
});

// Create a promo code (globally unique so ?promo= resolves to one tenant).
router.post("/", ...authed, async (req, res) => {
  try {
    const code = normalizePromo(req.body.code);
    const label = (req.body.label || "").trim() || null;
    if (code.length < 3) {
      return res
        .status(400)
        .json({ error: "Code must be at least 3 letters/numbers" });
    }
    const dup = await query("SELECT 1 FROM promo_codes WHERE code = $1", [code]);
    if (dup.rows.length) {
      return res.status(409).json({ error: "That code is already taken — try another." });
    }
    const r = await query(
      `INSERT INTO promo_codes (tenant_id, code, label)
       VALUES ($1,$2,$3) RETURNING id, code, label, is_active, created_at`,
      [req.user.tenant_id, code, label],
    );
    res.status(201).json({ success: true, data: { ...r.rows[0], signups: 0 } });
  } catch (e) {
    logger.error("Create promo error:", e);
    res.status(500).json({ error: "Failed to create promo code" });
  }
});

// Enable/disable a code.
router.patch("/:id", ...authed, async (req, res) => {
  try {
    const r = await query(
      "UPDATE promo_codes SET is_active = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id",
      [!!req.body.is_active, req.params.id, req.user.tenant_id],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Promo code not found" });
    res.json({ success: true });
  } catch (e) {
    logger.error("Update promo error:", e);
    res.status(500).json({ error: "Failed to update promo code" });
  }
});

// Clients who signed up with a given promo code (tenant-scoped).
router.get("/:id/clients", ...authed, async (req, res) => {
  try {
    const r = await query(
      `SELECT c.id, c.client_code, c.first_name, c.last_name, c.phone_number, c.created_at
         FROM clients c
         JOIN promo_codes p
           ON p.code = c.signup_promo_code AND p.tenant_id = c.tenant_id
        WHERE p.id = $1 AND p.tenant_id = $2
        ORDER BY c.created_at DESC`,
      [req.params.id, req.user.tenant_id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("Promo clients error:", e);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// PUBLIC — the portal sign-up page greets the customer with the lender's name.
router.get("/validate/:code", async (req, res) => {
  try {
    const r = await query(
      `SELECT p.label, t.business_name
         FROM promo_codes p JOIN tenants t ON t.id = p.tenant_id
        WHERE p.code = $1 AND p.is_active = true AND t.status = 'active'`,
      [normalizePromo(req.params.code)],
    );
    if (!r.rows.length) return res.json({ success: true, valid: false });
    res.json({
      success: true,
      valid: true,
      tenant_name: r.rows[0].business_name,
      label: r.rows[0].label,
    });
  } catch {
    res.json({ success: true, valid: false });
  }
});

export default router;
