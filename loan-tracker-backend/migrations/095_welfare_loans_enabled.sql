-- 095: Per-welfare master switch for the loan capability.
--
-- When FALSE (the default — loans are opt-in), the welfare admin app and the
-- member portal hide everything loan-related and the backend refuses loan
-- writes. When TRUE, the welfare's loan module is available and the existing
-- tenants.lends_to_non_members flag (mig 072) decides whether it also lends to
-- outsiders. Idempotent.

BEGIN;

ALTER TABLE welfare_settings
  ADD COLUMN IF NOT EXISTS loans_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
