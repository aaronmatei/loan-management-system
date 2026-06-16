-- 069: pawn loans/requests without collateral
--
-- A pawnbroker can lend WITH a pledged item (secured) or as a plain cash loan
-- (unsecured). For applications, the item becomes optional and a `secured` flag
-- records which kind it is. For the loan itself, "secured" is simply whether a
-- loan_collateral row exists — no schema change needed there. Idempotent.

BEGIN;

ALTER TABLE pawn_applications ALTER COLUMN item_description DROP NOT NULL;
ALTER TABLE pawn_applications ADD COLUMN IF NOT EXISTS secured boolean NOT NULL DEFAULT true;

COMMIT;
