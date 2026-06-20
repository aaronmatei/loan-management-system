-- 094: Member loan requests can target a product and carry a counter-offer
-- state. Extends the status CHECK (075) with 'counter_offered'. Idempotent.

BEGIN;

ALTER TABLE member_loan_requests
  ADD COLUMN IF NOT EXISTS product_id      INTEGER REFERENCES member_loan_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interest_method VARCHAR(20) NOT NULL DEFAULT 'flat';

ALTER TABLE member_loan_requests DROP CONSTRAINT IF EXISTS member_loan_requests_status_check;
ALTER TABLE member_loan_requests
  ADD CONSTRAINT member_loan_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'counter_offered'));

COMMIT;
