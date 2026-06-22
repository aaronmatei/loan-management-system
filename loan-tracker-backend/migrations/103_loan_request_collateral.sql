-- A member can offer collateral when requesting a loan (mirrors the admin loan
-- form). Captured on the request, then attached to the issued loan on approval.
BEGIN;
ALTER TABLE member_loan_requests ADD COLUMN IF NOT EXISTS collateral_description text;
ALTER TABLE member_loan_requests ADD COLUMN IF NOT EXISTS collateral_value       numeric(15,2);
COMMIT;
