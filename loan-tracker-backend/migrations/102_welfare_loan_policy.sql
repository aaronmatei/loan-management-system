-- Welfare loan policy defaults (mirrors the lender's Loan Settings → Loan Policy).
-- These pre-fill every new welfare loan / loan product so an admin sets the
-- chama's terms once. Per-loan and per-product values still override them.
BEGIN;
ALTER TABLE welfare_settings ADD COLUMN IF NOT EXISTS default_loan_interest_rate      numeric(6,2);
ALTER TABLE welfare_settings ADD COLUMN IF NOT EXISTS default_loan_interest_method    varchar(20) NOT NULL DEFAULT 'flat';
ALTER TABLE welfare_settings ADD COLUMN IF NOT EXISTS default_loan_processing_fee_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE welfare_settings ADD COLUMN IF NOT EXISTS default_loan_late_fee           numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE welfare_settings ADD COLUMN IF NOT EXISTS default_loan_penalty_rate       numeric(6,3) NOT NULL DEFAULT 0;
COMMIT;
