-- 089: Member loan products — pre-configured loan products per welfare.
--
-- The welfare analogue of loan_packages (039): a product locks the
-- financial mechanics (annual_interest_rate, interest_method, processing
-- fee, late_fee, penalty_rate) and range-validates amount + duration for
-- member (chama) loans funded by the members' pool. Off-product custom
-- loans leave member_loans.product_id NULL. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loan_products (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL,
  welfare_id           INTEGER NOT NULL,
  name                 VARCHAR(80)  NOT NULL,
  description          TEXT,

  -- annual_interest_rate as a percent (e.g. 18 = 18% p.a.). interest_rate
  -- on member_loans stores the same annual rate (flat) — existing convention.
  annual_interest_rate NUMERIC(6,2) NOT NULL CHECK (annual_interest_rate >= 0),
  interest_method      VARCHAR(20)  NOT NULL DEFAULT 'flat'
                         CHECK (interest_method IN ('flat', 'reducing')),
  processing_fee_rate  NUMERIC(5,2) NOT NULL DEFAULT 0
                         CHECK (processing_fee_rate >= 0 AND processing_fee_rate <= 100),

  -- Validated ranges. An application outside them is rejected at create time.
  min_amount           NUMERIC(15,2) NOT NULL CHECK (min_amount > 0),
  max_amount           NUMERIC(15,2) NOT NULL CHECK (max_amount >= min_amount),
  min_duration_months  INTEGER       NOT NULL CHECK (min_duration_months > 0),
  max_duration_months  INTEGER       NOT NULL
                         CHECK (max_duration_months >= min_duration_months),

  -- Overdue-repayment terms applied to loans on this product.
  late_fee             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  penalty_rate         NUMERIC(6,3)  NOT NULL DEFAULT 0 CHECK (penalty_rate >= 0),

  active               BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by           INTEGER,
  created_at           TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Per-welfare uniqueness on active name (archived names can be reused).
CREATE UNIQUE INDEX IF NOT EXISTS member_loan_products_welfare_name_active_unique
  ON member_loan_products (welfare_id, lower(name)) WHERE active;

CREATE INDEX IF NOT EXISTS idx_member_loan_products_welfare
  ON member_loan_products (welfare_id);

COMMIT;
