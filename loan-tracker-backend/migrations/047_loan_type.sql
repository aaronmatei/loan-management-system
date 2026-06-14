-- 047: Loan TYPE as a first-class concept
--
-- A loan's TYPE is the category that drives its structure & workflow
-- (personal / pawn / logbook / group), distinct from a package (a priced
-- product within a type). Phase 1 just introduces the column; everything
-- defaults to 'personal' so existing behaviour is unchanged. Packages carry
-- the type; a loan inherits it from its package.
--
-- Idempotent.

BEGIN;

ALTER TABLE loan_packages
  ADD COLUMN IF NOT EXISTS loan_type VARCHAR(20) NOT NULL DEFAULT 'personal';

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_type VARCHAR(20) NOT NULL DEFAULT 'personal';

COMMIT;
