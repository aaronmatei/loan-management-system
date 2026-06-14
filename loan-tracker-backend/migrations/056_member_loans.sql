-- 056: Member loans funded by the member pool (Part 2)
--
-- A loan advanced to a member out of the members' contributions pool — NOT the
-- lending capital_pool. Disbursing moves cash out of the pool (a
-- member_pool_transactions 'loan_disbursed' row); repayments move it back in
-- ('loan_repayment'), with interest growing the pool. Flat interest, tracked as
-- a single running amount_paid against total_amount_due (no installment engine).
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loans (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  loan_code        VARCHAR(30),
  principal        NUMERIC NOT NULL,
  interest_rate    NUMERIC NOT NULL DEFAULT 0,   -- annual %, flat
  duration_months  INTEGER NOT NULL DEFAULT 1,
  total_interest   NUMERIC NOT NULL DEFAULT 0,
  total_amount_due NUMERIC NOT NULL,
  amount_paid      NUMERIC NOT NULL DEFAULT 0,
  status           VARCHAR(20) NOT NULL DEFAULT 'active', -- active | completed | defaulted
  disbursed_at     TIMESTAMP,
  due_date         DATE,
  notes            TEXT,
  created_by       INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_loans_member ON member_loans(member_id);
CREATE INDEX IF NOT EXISTS idx_member_loans_tenant ON member_loans(tenant_id, status);

COMMIT;
