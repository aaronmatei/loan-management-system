-- Platform Admin: tenants need a free-text suspension reason so the
-- super-admin can record WHY a tenant was suspended/cancelled.
-- Additive, nullable, idempotent — safe to re-run. trial_ends_at
-- already exists from the multitenancy migration so it is not added.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
