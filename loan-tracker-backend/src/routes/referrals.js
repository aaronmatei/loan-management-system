// Referral API.
//
// GET /api/referrals/me            — authed, tenant-scoped. Drives the
//                                    "Refer & Earn" dashboard: link,
//                                    code, stats, free-month banner,
//                                    referral list.
// GET /api/referrals/validate/:code — PUBLIC. Used by the /signup?ref=
//                                    page to show a "Referred by X"
//                                    banner before the user submits.
//
// Authoring/redemption logic lives in services/referralService.js — this
// file is the HTTP-shape layer.

import express from "express";
import { verifyToken } from "../middleware/auth.js";
import { tenantContext, requireTenant } from "../middleware/tenantContext.js";
import referralService from "../services/referralService.js";
import logger from "../config/logger.js";

const router = express.Router();

// Dashboard for the current tenant. tenantContext also enforces the
// suspended/cancelled/trial-expired guards used everywhere else.
router.get("/me", verifyToken, tenantContext, requireTenant, async (req, res) => {
  try {
    const stats = await referralService.getTenantReferralStats(req.user.tenant_id);
    const config = await referralService.getConfig();
    res.json({ success: true, data: { ...stats, config } });
  } catch (error) {
    logger.error("Referral dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch referrals" });
  }
});

// Public — used by the signup page before the visitor authenticates.
// Returns valid=false (NOT 4xx) on miss so the signup page can simply
// not render the banner without special-casing error states.
router.get("/validate/:code", async (req, res) => {
  try {
    const referrer = await referralService.findReferrerByCode(req.params.code);
    const config = await referralService.getConfig();

    if (!referrer || !config?.enabled) {
      return res.json({ success: true, valid: false });
    }

    // Translate referred_reward_type → human-readable bonus string.
    // Default config has 'none', so most signups won't promise extras
    // — the banner will only say "Referred by X. Welcome to LendFest."
    let bonus = null;
    if (
      config.referred_reward_type === "extended_trial" &&
      config.referred_reward_value > 0
    ) {
      bonus = `${Math.floor(parseFloat(config.referred_reward_value))}-day free trial`;
    } else if (config.referred_reward_type === "free_month") {
      bonus = "first month free";
    }

    res.json({
      success: true,
      valid: true,
      referrer_name: referrer.business_name,
      bonus,
    });
  } catch (error) {
    // Never let validate errors break the public signup page.
    res.json({ success: true, valid: false });
  }
});

export default router;
