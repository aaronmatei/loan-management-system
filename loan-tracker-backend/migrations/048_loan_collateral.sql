-- 048: Pawn / collateral items
--
-- A pledged item backing a pawn loan: valued at intake, held by the lender,
-- and either returned on redemption or forfeited (then optionally sold) on
-- default. One item per pawn loan (Phase 2). The loan itself carries
-- loan_type='pawn' (migration 047) and a single bullet schedule.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS loan_collateral (
  id               SERIAL PRIMARY KEY,
  tenant_id        INTEGER NOT NULL,
  loan_id          INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  category         VARCHAR(60),
  description      TEXT NOT NULL,
  serial_number    VARCHAR(120),
  condition        VARCHAR(40),
  appraised_value  NUMERIC NOT NULL,
  ltv_percent      NUMERIC NOT NULL DEFAULT 50,
  storage_location VARCHAR(120),
  photos           JSONB,
  status           VARCHAR(20) NOT NULL DEFAULT 'held',  -- held | returned | forfeited | sold
  sale_amount      NUMERIC,
  sale_date        DATE,
  returned_at      TIMESTAMP,
  forfeited_at     TIMESTAMP,
  created_by       INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_collateral_loan   ON loan_collateral(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_collateral_tenant ON loan_collateral(tenant_id, status);

COMMIT;
