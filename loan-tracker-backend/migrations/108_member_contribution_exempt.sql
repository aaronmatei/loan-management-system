-- 108: Member contribution exemption (sick / hardship)
--
-- Lets a welfare mark a member as EXEMPT from periodic contributions — e.g.
-- they're sick and unable to contribute — WITHOUT dropping them from the
-- roster. An exempt member stays status='active' (still counted, still votes,
-- still receives benefits/dividends, still attends meetings) but is SKIPPED
-- when contribution dues are generated (see contributionPlanService), so they
-- also accrue no contribution penalties while exempt.
--
-- exempt_reason carries the human label (e.g. "Sick"); exempt_since records
-- when the exemption began. Idempotent.

BEGIN;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS contribution_exempt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS exempt_reason TEXT;
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS exempt_since DATE;

COMMIT;
