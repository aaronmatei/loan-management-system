-- 070: per-loan grace + auction-notice overrides for pawn pledges
--
-- pawn_settings holds the SHOP defaults; these optional per-loan columns let a
-- clerk tailor a single pledge (e.g. a longer grace for a good customer). NULL
-- means "use the shop default". Nullable, pawn-only in practice. Idempotent.

BEGIN;

ALTER TABLE loans ADD COLUMN IF NOT EXISTS grace_days           integer;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS auction_notice_days  integer;

COMMIT;
