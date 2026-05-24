-- 020_kyc_documents.sql
-- Customer identity documents (KYC): a profile/DP photo plus both sides of the
-- national ID, stored on the cross-tenant platform_customers record so every
-- lender the customer links to sees the same verified identity.
--
-- profile_photo_url already exists; this adds the two ID-image columns.
-- Idempotent — safe to re-run.

ALTER TABLE platform_customers
  ADD COLUMN IF NOT EXISTS id_front_url text,
  ADD COLUMN IF NOT EXISTS id_back_url  text;
