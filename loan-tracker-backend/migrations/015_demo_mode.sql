-- 015: Demo / sandbox mode
--
-- Adds:
--   • tenants.is_demo  — flag the cron/notify path use to skip the
--                        demo tenant (no real SMS/email, no
--                        auto-suspension, no billing)
--   • demo_sessions    — lightweight analytics table for the public
--                        demo entry endpoint (one row per visitor
--                        who clicks "Try Live Demo")
--   • A "Demo Lenders" tenant row at subdomain='demo' with all the
--     NOT-NULL fields the tenants schema actually requires
--     (tenant_code, contact_name, contact_email, contact_phone).
--   • Demo admin user (demo@lenderfest.loans / password 'demo123' —
--     intentionally simple; only reachable via the public /api/demo/start
--     endpoint which mints a short-lived JWT, not via /login).
--
-- Idempotent.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS demo_sessions (
  id                   SERIAL PRIMARY KEY,
  session_token        VARCHAR(100) UNIQUE NOT NULL,
  ip_address           VARCHAR(45),
  user_agent           TEXT,
  actions_count        INTEGER     DEFAULT 0,
  converted_to_signup  BOOLEAN     DEFAULT FALSE,
  started_at           TIMESTAMP   DEFAULT NOW(),
  last_active_at       TIMESTAMP   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_sessions_token   ON demo_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_started ON demo_sessions(started_at DESC);

-- Demo tenant (insert if missing). All NOT-NULL fields supplied.
INSERT INTO tenants (
  tenant_code, business_name, subdomain,
  contact_name, contact_email, contact_phone,
  status, plan,
  billing_enabled, billing_fee_percentage,
  white_label_tier, brand_color, business_type,
  onboarding_completed, onboarding_completed_at,
  is_demo,
  default_interest_rate, default_loan_duration,
  min_loan_amount, max_loan_amount,
  created_at, updated_at
)
SELECT
  'DEMO', 'Demo Lenders', 'demo',
  'Demo Admin', 'demo@lenderfest.loans', '+254700000099',
  'active', 'demo',
  false, 0,
  'pro', '#0E8A6E', 'microfinance',
  true, NOW(),
  true,
  50.00, 6,
  1000, 1000000,
  NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE subdomain = 'demo');

-- Demo admin user (insert if the demo tenant has none). Reached ONLY via
-- POST /api/demo/start, which mints a short-lived JWT — never via /login.
-- password_hash is bcrypt('demo123').
INSERT INTO users (
  username, email, password_hash,
  first_name, last_name, role, is_active,
  tenant_id, created_at, updated_at
)
SELECT
  'demo_admin', 'demo@lenderfest.loans',
  '$2b$10$nUfBuASYmkIxMjKFXO8mjOqnlaSYWcOTNIkqw1i0FRog0AwSMQmui',
  'Demo', 'Admin', 'admin', true,
  t.id, NOW(), NOW()
FROM tenants t
WHERE t.subdomain = 'demo'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id);

COMMIT;
