-- 023: Per-tenant loan processing fee
-- A tenant admin can set a processing fee (as a % of the principal) that is
-- deducted from the amount the borrower actually receives. The borrower still
-- repays the full principal + interest; the fee is the lender's upfront income.
--
-- tenants.processing_fee_rate  — the configurable rate (% of principal).
-- loans.processing_fee_rate    — rate snapshot at application time.
-- loans.processing_fee         — computed KES fee (principal * rate / 100).
-- loans.net_disbursed_amount   — principal - processing_fee (what is paid out).
--
-- Default rate is 0, so existing tenants/loans are unchanged until set.
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE ... WHERE IS NULL.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS processing_fee_rate NUMERIC(5,2) DEFAULT 0;

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS processing_fee_rate  NUMERIC(5,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee       NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_disbursed_amount NUMERIC(12,2);

UPDATE tenants
   SET processing_fee_rate = COALESCE(processing_fee_rate, 0)
 WHERE processing_fee_rate IS NULL;

UPDATE loans
   SET processing_fee_rate = COALESCE(processing_fee_rate, 0),
       processing_fee      = COALESCE(processing_fee, 0)
 WHERE processing_fee_rate IS NULL
    OR processing_fee IS NULL;

COMMIT;
