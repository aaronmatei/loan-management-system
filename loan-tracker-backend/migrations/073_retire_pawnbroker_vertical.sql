-- 073: retire the pawnbroker vertical
--
-- Pawn is no longer a separate tenant kind — "loan against collateral" is now a
-- loan type any lender can issue (loan_type='pawn' with a loan_collateral row;
-- see migration 071 + the standard /api/loans flow). Convert every existing
-- pawnbroker tenant into a normal Private Lender. Their pawn data (loans,
-- collateral, auctions, pawn_settings) is independent of tenant.kind and stays
-- intact. Idempotent.

BEGIN;

UPDATE tenants
   SET kind = 'lender',
       business_type = 'private'
 WHERE kind = 'pawnbroker';

COMMIT;
