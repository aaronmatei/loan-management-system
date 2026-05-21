-- 016_referral_program.sql
--
-- Referral Program: existing tenants refer new lenders and earn rewards.
-- Reward structure is config-driven (referral_config) so values can be
-- tuned without code changes. Default: referrer gets 1 free month when
-- the referred tenant becomes 'active'; referred tenant gets no extra
-- bonus (normal 14-day trial).
--
-- Renumbered from the design's "014" because 014_audit_extensions.sql
-- and 015_demo_mode.sql are already applied.

BEGIN;

-- ============================================================
-- REFERRAL CONFIG (platform-wide settings, editable)
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_config (
  id SERIAL PRIMARY KEY,
  referrer_reward_type   VARCHAR(30) DEFAULT 'free_month',
  -- 'free_month' | 'fee_discount' | 'credit'
  referrer_reward_value  DECIMAL(10,2) DEFAULT 1,   -- months / pct / amount
  referred_reward_type   VARCHAR(30) DEFAULT 'none',
  -- 'none' | 'extended_trial' | 'free_month'  (default: no extra bonus)
  referred_reward_value  DECIMAL(10,2) DEFAULT 0,
  qualification          VARCHAR(30) DEFAULT 'active',
  -- What makes a referral "qualified": 'signup' | 'active' | 'first_payment'
  enabled                BOOLEAN DEFAULT TRUE,
  updated_at             TIMESTAMP DEFAULT NOW()
);

-- Seed the single-row config — only if not present (idempotent re-runs)
INSERT INTO referral_config (
  referrer_reward_type, referrer_reward_value,
  referred_reward_type, referred_reward_value, qualification, enabled
)
SELECT 'free_month', 1, 'none', 0, 'active', true
WHERE NOT EXISTS (SELECT 1 FROM referral_config);

-- ============================================================
-- TENANT COLUMNS (one referral code per tenant + credit balance)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code         VARCHAR(20) UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_credits      INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_days            INTEGER DEFAULT 14;

-- ============================================================
-- REFERRALS (one row per referral relationship)
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  referral_code      VARCHAR(20) NOT NULL,

  status VARCHAR(20) DEFAULT 'pending',
  -- 'pending' (signed up, not yet qualified) | 'qualified' | 'expired'

  -- Reward snapshot (frozen at recordReferral time so later config
  -- changes don't retroactively alter what we promised).
  referrer_reward_type  VARCHAR(30),
  referrer_reward_value DECIMAL(10,2),
  referrer_rewarded     BOOLEAN DEFAULT FALSE,
  referred_reward_type  VARCHAR(30),
  referred_reward_value DECIMAL(10,2),
  referred_rewarded     BOOLEAN DEFAULT FALSE,

  -- Metadata
  referred_business_name VARCHAR(255),
  signed_up_at  TIMESTAMP DEFAULT NOW(),
  qualified_at  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_tenant_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_tenant_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status   ON referrals(status);

-- ============================================================
-- Backfill referral codes for existing tenants.
-- Format: up-to-4 alpha chars of the subdomain (uppercased) + a
-- deterministic 4-digit suffix derived from the tenant id, so the
-- backfill matches what referralService.generateCode produces.
-- ============================================================
UPDATE tenants
   SET referral_code = UPPER(LEFT(REGEXP_REPLACE(subdomain, '[^a-zA-Z]', '', 'g'), 4))
                       || LPAD((1000 + (id * 137) % 9000)::text, 4, '0')
 WHERE referral_code IS NULL AND subdomain IS NOT NULL;

COMMIT;

-- For convenience after running:
SELECT id, business_name, subdomain, referral_code
  FROM tenants
 WHERE referral_code IS NOT NULL
 ORDER BY id;
