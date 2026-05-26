-- 027: Track how much of each payment went to penalty vs to amount_due
-- The Overdue page accrues a per-installment penalty (flat late fee +
-- penalty interest). Until now it was display-only — payments couldn't
-- distinguish "this 2,050 covered penalty" from "this 2,050 reduced the
-- principal+interest balance". We now allocate penalty FIRST on every
-- payment and record the split:
--
--   transactions.penalty_portion     KES of this payment that paid penalty
--   payment_schedules.penalty_paid   cumulative penalty paid on this installment
--
-- Loan-completion math uses (amount_paid - penalty_portion) against
-- total_amount_due so penalty payments don't fake-complete the loan.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS penalty_portion NUMERIC(12,2) DEFAULT 0;

ALTER TABLE payment_schedules
  ADD COLUMN IF NOT EXISTS penalty_paid NUMERIC(12,2) DEFAULT 0;

-- Backfill the defaults (NULL → 0) on rows that may have pre-existed.
UPDATE transactions      SET penalty_portion = 0 WHERE penalty_portion IS NULL;
UPDATE payment_schedules SET penalty_paid    = 0 WHERE penalty_paid    IS NULL;

COMMIT;
