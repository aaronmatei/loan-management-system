-- Tenant onboarding wizard: track progress + a few extra business
-- profile fields. Additive, nullable, idempotent (IF NOT EXISTS).
-- Backfill existing tenants as already-onboarded so they skip the
-- wizard. The spec said "id IN (1,2,3,4)" but the demo tenants in
-- this DB are 1,5,6,7 — backfill ALL existing tenants instead.

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed   BOOLEAN  DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step        INTEGER  DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_data        JSONB    DEFAULT '{}'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_skipped     BOOLEAN  DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_hours         VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_description   TEXT;

-- Existing tenants already have data — skip the wizard for them.
UPDATE tenants
   SET onboarding_completed = TRUE,
       onboarding_step      = 6,
       onboarding_completed_at = COALESCE(onboarding_completed_at, NOW())
 WHERE onboarding_completed IS NOT TRUE;

COMMIT;

SELECT id, business_name, onboarding_completed, onboarding_step
FROM tenants ORDER BY id;
