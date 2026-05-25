-- 022_promo_codes.sql
-- Tenant-defined promo / campaign codes for the customer sign-up link. A tenant
-- creates named codes (e.g. RADIO, JAN2026) and shares
--   /loanfix/portal/register?promo=<code>
-- Customers who sign up with a code are auto-linked to that tenant (like a
-- referral) AND tagged with the code, so the tenant can see who came from each
-- campaign. Code is globally unique so ?promo=<code> resolves to one tenant.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS promo_codes (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL REFERENCES tenants(id),
  code        varchar(40) NOT NULL UNIQUE,
  label       varchar(120),
  is_active   boolean DEFAULT true,
  created_at  timestamp without time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_tenant ON promo_codes(tenant_id);

-- Which promo code a record signed up with (null for everyone else).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS signup_promo_code varchar(40);
ALTER TABLE platform_customers
  ADD COLUMN IF NOT EXISTS signup_promo_code varchar(40);
