// Referral Program service.
//
// Reward structure is read at runtime from referral_config (single
// row). Rewards are snapshotted onto each referrals row at recordReferral
// time so later config edits don't retroactively change what we
// promised an already-signed-up referrer.
//
// Lifecycle:
//   recordReferral()        — called from POST /api/tenants/signup when
//                              the body contains a referral_code.
//   processPendingReferrals()
//                           — called daily from billingCronJob (and
//                              manually via /api/platform/cron/trigger
//                              "referrals"). Promotes any pending row
//                              whose referred tenant has met the
//                              configured qualification, and emails the
//                              referrer.
//   getTenantReferralStats() — feeds the /api/referrals/me dashboard.
//
// Redemption of free-month credits happens in billingService.generateInvoice
// (one credit waives one month's platform fee).

import { query } from "../config/database.js";
import { sendEmail } from "./emailService.js";
import logger from "../config/logger.js";

class ReferralService {
  // Single-row config. Cached briefly to avoid hammering the DB during
  // the daily processPendingReferrals loop, but the TTL is short so
  // operator edits show up almost immediately.
  async getConfig() {
    const result = await query(
      `SELECT * FROM referral_config ORDER BY id LIMIT 1`,
    );
    return result.rows[0];
  }

  // Deterministic per-tenant code: up to 4 alpha chars of the subdomain
  // (uppercased) + a 4-digit suffix derived from the tenant id. Matches
  // the backfill in migrations/016_referral_program.sql.
  generateCode(subdomain, tenantId) {
    const prefix = (subdomain || "REF")
      .replace(/[^a-zA-Z]/g, "")
      .slice(0, 4)
      .toUpperCase();
    const suffix = String(1000 + (tenantId * 137) % 9000).padStart(4, "0");
    return `${prefix}${suffix}`;
  }

  // Look up the referrer by code. Only active tenants can refer —
  // suspended/cancelled tenants can't accrue new rewards. (Trial
  // tenants are status='active' with plan='trial', so they qualify.)
  async findReferrerByCode(code) {
    if (!code) return null;
    const result = await query(
      `SELECT id, business_name, referral_code, contact_email
         FROM tenants
        WHERE referral_code = $1 AND status = 'active'`,
      [code.toUpperCase()],
    );
    return result.rows[0] || null;
  }

  // Called from signup. Returns the inserted referrals row, or null if
  // the program is disabled, the code didn't resolve, or self-referral
  // was attempted. Never throws — signup must always succeed even if
  // the referral side fails.
  async recordReferral(referralCode, newTenant) {
    try {
      const config = await this.getConfig();
      if (!config?.enabled) return null;

      const referrer = await this.findReferrerByCode(referralCode);
      if (!referrer) {
        logger.info(`Referral code ${referralCode} not found - skipping`);
        return null;
      }
      // Self-referral guard
      if (referrer.id === newTenant.id) return null;

      const result = await query(
        `INSERT INTO referrals (
           referrer_tenant_id, referred_tenant_id, referral_code, status,
           referrer_reward_type, referrer_reward_value,
           referred_reward_type, referred_reward_value,
           referred_business_name, signed_up_at, created_at
         ) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,NOW(),NOW())
         RETURNING *`,
        [
          referrer.id,
          newTenant.id,
          referralCode.toUpperCase(),
          config.referrer_reward_type,
          config.referrer_reward_value,
          config.referred_reward_type,
          config.referred_reward_value,
          newTenant.business_name,
        ],
      );

      // Stamp the back-pointer so we can see "who referred this tenant"
      // directly off the tenants row.
      await query(
        `UPDATE tenants SET referred_by_tenant_id = $1 WHERE id = $2`,
        [referrer.id, newTenant.id],
      );

      // Optional welcome bonus for the referred tenant. Default config
      // is 'none', so this branch is dormant until an operator opts in.
      // For 'extended_trial' we update BOTH trial_days (for visibility)
      // and trial_ends_at (the column the rest of the platform checks).
      if (
        config.referred_reward_type === "extended_trial" &&
        config.referred_reward_value > 0
      ) {
        const days = Math.floor(parseFloat(config.referred_reward_value));
        await query(
          `UPDATE tenants
              SET trial_days = $1,
                  trial_ends_at = NOW() + ($1 || ' days')::interval
            WHERE id = $2`,
          [days, newTenant.id],
        );
      }

      // If qualification is just 'signup', skip the wait and qualify now.
      if (config.qualification === "signup") {
        await this.qualifyReferral(result.rows[0].id);
      }

      logger.info(
        `Referral recorded: ${referrer.business_name} → ${newTenant.business_name}`,
      );
      return result.rows[0];
    } catch (error) {
      logger.error("Record referral error:", error);
      return null;
    }
  }

  // Move a referral from 'pending' → 'qualified' and pay out the
  // referrer's reward. Idempotent — already-qualified rows are a no-op.
  async qualifyReferral(referralId) {
    try {
      const refResult = await query(
        `SELECT * FROM referrals WHERE id = $1`,
        [referralId],
      );
      if (refResult.rows.length === 0) return;
      const referral = refResult.rows[0];
      if (referral.status === "qualified") return;

      // Apply the referrer reward.
      if (
        referral.referrer_reward_type === "free_month" &&
        !referral.referrer_rewarded
      ) {
        await query(
          `UPDATE tenants
              SET referral_credits = referral_credits + $1
            WHERE id = $2`,
          [
            Math.floor(parseFloat(referral.referrer_reward_value)) || 1,
            referral.referrer_tenant_id,
          ],
        );
      }
      // 'fee_discount' and 'credit' types are recorded but not yet
      // plumbed into the billing pipeline — billingService only consumes
      // free-month credits today. Left as a TODO when those reward
      // shapes are turned on in referral_config.

      await query(
        `UPDATE referrals
            SET status = 'qualified',
                referrer_rewarded = true,
                referred_rewarded = true,
                qualified_at = NOW()
          WHERE id = $1`,
        [referralId],
      );

      // Notify the referrer. Demo and non-active tenants both have a
      // contact_email — sending is still gated on email transport
      // being configured (EMAIL_ENABLED).
      const referrerResult = await query(
        `SELECT business_name, contact_email FROM tenants WHERE id = $1`,
        [referral.referrer_tenant_id],
      );
      const r = referrerResult.rows[0];
      if (r?.contact_email) {
        await sendEmail({
          to: r.contact_email,
          subject: "🎁 You earned a referral reward!",
          html: this.getRewardEmail(r.business_name, referral),
          fromName: "LenderFest",
        });
      }

      logger.info(`Referral ${referralId} qualified - rewards issued`);
    } catch (error) {
      logger.error("Qualify referral error:", error);
    }
  }

  // Sweep pending referrals and qualify those whose referred tenant
  // has met the configured qualification rule. Called by the daily
  // billing cron and by the platform-admin manual trigger.
  async processPendingReferrals() {
    try {
      const config = await this.getConfig();
      if (!config?.enabled) return 0;

      // Build the WHERE-clause fragment for the qualification rule.
      // 'signup' is handled inline in recordReferral so we never have
      // 'pending' rows when the rule is 'signup' — but include it for
      // safety in case config flipped mid-cycle.
      let condition;
      switch (config.qualification) {
        case "signup":
          condition = "TRUE";
          break;
        case "first_payment":
          condition = `EXISTS (
            SELECT 1 FROM invoices i
             WHERE i.tenant_id = t.id AND i.status = 'paid'
          )`;
          break;
        case "active":
        default:
          condition = `t.status = 'active'`;
          break;
      }

      const pending = await query(
        `SELECT r.id
           FROM referrals r
           JOIN tenants t ON r.referred_tenant_id = t.id
          WHERE r.status = 'pending' AND ${condition}`,
      );

      for (const ref of pending.rows) {
        await this.qualifyReferral(ref.id);
      }

      logger.info(`Processed ${pending.rows.length} pending referrals`);
      return pending.rows.length;
    } catch (error) {
      logger.error("Process pending referrals error:", error);
      return 0;
    }
  }

  // Stats panel for the /api/referrals/me dashboard.
  async getTenantReferralStats(tenantId) {
    const tenant = await query(
      `SELECT referral_code, referral_credits FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const stats = await query(
      `SELECT
         COUNT(*)::int                                              AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'qualified')::int          AS qualified,
         COUNT(*) FILTER (WHERE status = 'pending')::int            AS pending
         FROM referrals
        WHERE referrer_tenant_id = $1`,
      [tenantId],
    );

    const list = await query(
      `SELECT referred_business_name, status, signed_up_at, qualified_at
         FROM referrals
        WHERE referrer_tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );

    return {
      referral_code: tenant.rows[0]?.referral_code || null,
      credits: tenant.rows[0]?.referral_credits || 0,
      stats: stats.rows[0],
      referrals: list.rows,
    };
  }

  // Reward email (sent on qualification).
  getRewardEmail(businessName, referral) {
    return `<html><body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;margin:0 auto;">
        <tr><td style="background:linear-gradient(135deg,#10b981,#059669);padding:30px;text-align:center;color:#fff;">
          <div style="font-size:48px;">🎁</div>
          <h1 style="margin:8px 0 0 0;">Referral Reward Earned!</h1>
        </td></tr>
        <tr><td style="padding:30px;">
          <p>Hi <strong>${businessName}</strong>,</p>
          <p>Great news! <strong>${referral.referred_business_name}</strong> signed up for LenderFest using your referral link and is now active.</p>
          <div style="background:#dcfce7;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
            <p style="margin:0;color:#15803d;font-size:20px;font-weight:bold;">🎉 You've earned 1 FREE MONTH!</p>
            <p style="margin:8px 0 0 0;color:#166534;">Your next platform fee will be waived automatically.</p>
          </div>
          <p>Keep sharing your referral link to earn more free months. There's no limit!</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="http://localhost:5173/referrals" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">View My Referrals →</a>
          </div>
        </td></tr>
      </table>
    </body></html>`;
  }
}

export default new ReferralService();
