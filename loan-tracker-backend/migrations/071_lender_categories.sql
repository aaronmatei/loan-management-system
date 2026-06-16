-- 071: reorganise lender categories (tenants.business_type)
--
-- New set: private (Private Lender) · bank · microfinance · sacco · dfi
-- (Development Finance Institution) · welfare_chama (Welfare/Chama). The old
-- 'individual' becomes 'private'; 'chama' folds into 'welfare_chama'. Pawnbroker
-- tenants are converted to Private Lenders (the pawn vertical is being retired —
-- collateral becomes a loan type any lender can offer). Idempotent.

BEGIN;

UPDATE tenants SET business_type = 'private'        WHERE LOWER(COALESCE(business_type,'')) = 'individual';
UPDATE tenants SET business_type = 'welfare_chama'  WHERE LOWER(COALESCE(business_type,'')) = 'chama';

COMMIT;
