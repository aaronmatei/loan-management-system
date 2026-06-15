-- 062: M-Pesa targeting for welfare payments
--
-- Welfare STK pushes (contribution / member-loan repayment / penalty) reuse the
-- shared mpesa_transactions + Daraja callback, but need to know which welfare
-- target to credit when the callback confirms. `allocated` makes applying the
-- money idempotent (callback or manual reconciliation can run once). Idempotent.

BEGIN;

ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS welfare_id  INTEGER;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS member_id   INTEGER;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS target_type VARCHAR(30); -- contribution_schedule | member_loan | penalty_assessment
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS target_id   INTEGER;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS allocated   BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mpesa_welfare ON mpesa_transactions(welfare_id);

COMMIT;
