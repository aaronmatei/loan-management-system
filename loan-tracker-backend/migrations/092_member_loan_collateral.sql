-- 092: Collateral pledged against a member loan — mirror of loan_collateral
-- (048), scoped to member_loans. Lifecycle: held → returned (redemption) |
-- forfeited (default) → optionally sold. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loan_collateral (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL,
  member_loan_id   INTEGER NOT NULL REFERENCES member_loans(id) ON DELETE CASCADE,
  category         VARCHAR(60),
  description      TEXT NOT NULL,
  serial_number    VARCHAR(120),
  condition        VARCHAR(40),
  appraised_value  NUMERIC NOT NULL,
  ltv_percent      NUMERIC NOT NULL DEFAULT 50,
  storage_location VARCHAR(120),
  photos           JSONB,
  status           VARCHAR(20) NOT NULL DEFAULT 'held', -- held | returned | forfeited | sold
  sale_amount      NUMERIC,
  sale_date        DATE,
  returned_at      TIMESTAMP,
  forfeited_at     TIMESTAMP,
  created_by       INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_loan_collateral_loan
  ON member_loan_collateral(member_loan_id);

COMMIT;
