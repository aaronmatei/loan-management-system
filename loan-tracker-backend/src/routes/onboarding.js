import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

// Helper: every endpoint here scopes by the caller's tenant_id from
// the JWT (set by verifyToken). Platform admin (tenant_id may be 1)
// hits this just like any tenant.
const tid = (req) => req.user?.tenant_id;

router.get("/status", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: "No tenant context" });
    const r = await query(
      `SELECT
         onboarding_completed,
         onboarding_step,
         onboarding_data,
         onboarding_skipped,
         business_name,
         logo_url,
         brand_color,
         physical_address,
         city,
         county,
         business_hours,
         business_description,
         (SELECT COUNT(*)::int FROM clients WHERE tenant_id = $1) AS client_count,
         (SELECT COUNT(*)::int FROM loans   WHERE tenant_id = $1) AS loan_count,
         (SELECT COUNT(*)::int FROM users   WHERE tenant_id = $1) AS user_count
       FROM tenants WHERE id = $1`,
      [t],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error("Onboarding status error:", error);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

router.post("/step", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: "No tenant context" });
    const { step, data } = req.body || {};
    const cur = await query(
      "SELECT onboarding_data FROM tenants WHERE id = $1",
      [t],
    );
    const merged = { ...(cur.rows[0]?.onboarding_data || {}), ...(data || {}) };
    await query(
      `UPDATE tenants
       SET onboarding_step = COALESCE($1, onboarding_step),
           onboarding_data = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [step ?? null, JSON.stringify(merged), t],
    );
    res.json({ success: true, message: "Step updated" });
  } catch (error) {
    logger.error("Update onboarding step error:", error);
    res.status(500).json({ error: "Failed to update step" });
  }
});

router.post("/complete", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: "No tenant context" });
    await query(
      `UPDATE tenants
       SET onboarding_completed = TRUE,
           onboarding_completed_at = NOW(),
           onboarding_step = 6,
           updated_at = NOW()
       WHERE id = $1`,
      [t],
    );
    res.json({ success: true, message: "Onboarding complete!" });
  } catch (error) {
    logger.error("Complete onboarding error:", error);
    res.status(500).json({ error: "Failed to complete" });
  }
});

router.post("/skip", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: "No tenant context" });
    await query(
      `UPDATE tenants
       SET onboarding_completed = TRUE,
           onboarding_skipped   = TRUE,
           onboarding_completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [t],
    );
    res.json({ success: true, message: "Onboarding skipped" });
  } catch (error) {
    logger.error("Skip onboarding error:", error);
    res.status(500).json({ error: "Failed to skip" });
  }
});

// Business profile update — the spec's `/settings/business` endpoint
// doesn't exist; this writes directly to the tenant row. Only fields
// owned by the tenant table; brand/logo would be handled separately.
router.put("/business-profile", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: "No tenant context" });
    const {
      physical_address,
      city,
      county,
      business_hours,
      business_description,
    } = req.body || {};
    await query(
      `UPDATE tenants SET
         physical_address     = COALESCE($1, physical_address),
         city                 = COALESCE($2, city),
         county               = COALESCE($3, county),
         business_hours       = COALESCE($4, business_hours),
         business_description = COALESCE($5, business_description),
         updated_at = NOW()
       WHERE id = $6`,
      [
        physical_address || null,
        city || null,
        county || null,
        business_hours || null,
        business_description || null,
        t,
      ],
    );
    res.json({ success: true, message: "Business profile updated" });
  } catch (error) {
    logger.error("Business profile update error:", error);
    res.status(500).json({ error: "Failed to update business profile" });
  }
});

export default router;
