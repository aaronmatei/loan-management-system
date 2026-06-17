-- 077: members invited to the self-service portal get an admin-set temporary
-- password and are forced to change it on first login. This flag drives that
-- "set your password" step. Borrowers who self-register never have it set.
-- Idempotent.

BEGIN;

ALTER TABLE platform_customers
  ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;

COMMIT;
