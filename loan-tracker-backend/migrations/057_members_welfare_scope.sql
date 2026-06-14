-- 057: Scope members + their pool to a welfare (group)
--
-- Members are now members OF a welfare (the entity formerly called group/chama),
-- not a tenant-wide roster. Each welfare has its own members, contributions pool
-- and pool lending. The members* tables are new (migrations 055/056) and unused
-- in production, so no backfill is needed — welfare_id is added nullable and the
-- API requires it going forward. Idempotent.

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS welfare_id INTEGER;
ALTER TABLE member_pool_transactions ADD COLUMN IF NOT EXISTS welfare_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_members_welfare ON members(welfare_id);
CREATE INDEX IF NOT EXISTS idx_member_pool_welfare ON member_pool_transactions(welfare_id, id);

COMMIT;
