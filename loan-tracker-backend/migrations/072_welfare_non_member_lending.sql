-- 072: welfare lending to non-members
--
-- Some chamas/welfares lend only to their own members; others extend loans to
-- outsiders. Only the latter should appear to borrowers in the customer lender
-- directory. This flag gates that visibility. Idempotent.

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lends_to_non_members boolean NOT NULL DEFAULT false;

COMMIT;
