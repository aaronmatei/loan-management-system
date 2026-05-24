-- 021_platform_customer_business.sql
-- Capture the customer's business + location at portal sign-up. These live on
-- the cross-tenant platform_customers record so every lender the customer links
-- to inherits them on the per-tenant clients row (see /portal/auth/add-tenant).
-- Mirrors the business/location fields a tenant fills in when adding a client.
-- Idempotent — safe to re-run.

ALTER TABLE platform_customers
  ADD COLUMN IF NOT EXISTS business_name varchar(100),
  ADD COLUMN IF NOT EXISTS business_type varchar(50),
  ADD COLUMN IF NOT EXISTS city          varchar(50),
  ADD COLUMN IF NOT EXISTS county        varchar(50),
  ADD COLUMN IF NOT EXISTS address       text;
