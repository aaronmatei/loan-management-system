-- 091: Member loan installment schedules — the welfare analogue of
-- payment_schedules.
--
-- One row per installment with the amortization breakdown (interest_portion
-- / principal_portion / balance_after) and the penalty snapshot columns,
-- mirroring the lender schedule so the payment allocator
-- (penalty → interest → principal) and the reducing-balance re-amortization
-- port directly. A bullet loan is just a 1-row schedule. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loan_schedules (
  id                       SERIAL PRIMARY KEY,
  tenant_id                INTEGER NOT NULL,
  member_loan_id           INTEGER NOT NULL REFERENCES member_loans(id) ON DELETE CASCADE,
  payment_number           INTEGER NOT NULL,
  due_date                 DATE    NOT NULL,
  amount_due               NUMERIC(14,2) NOT NULL,
  amount_paid              NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_portion         NUMERIC(14,2) NOT NULL DEFAULT 0,
  principal_portion        NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_after            NUMERIC(14,2) NOT NULL DEFAULT 0,
  interest_paid            NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_paid             NUMERIC(14,2) NOT NULL DEFAULT 0,
  late_fee_charged         NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalty_interest_charged NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_payment_date      DATE,
  days_late                INTEGER NOT NULL DEFAULT 0,
  status                   VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | overdue | paid | waived
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (member_loan_id, payment_number)
);

CREATE INDEX IF NOT EXISTS idx_member_loan_schedules_loan
  ON member_loan_schedules(member_loan_id);

COMMIT;
