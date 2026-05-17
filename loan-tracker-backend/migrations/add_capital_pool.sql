-- ============================================================
-- Capital Pool Tracking
-- Safe to run multiple times (IF NOT EXISTS + idempotent recalc).
-- ============================================================

CREATE TABLE IF NOT EXISTS capital_pool (
  id SERIAL PRIMARY KEY,
  initial_capital NUMERIC(15, 2) NOT NULL,
  total_disbursed NUMERIC(15, 2) DEFAULT 0,        -- Total principal lent out
  total_collected NUMERIC(15, 2) DEFAULT 0,        -- Total principal recovered
  total_interest_earned NUMERIC(15, 2) DEFAULT 0,  -- Interest = profit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed the single pool row once (default starting capital: KES 50,000,000)
INSERT INTO capital_pool (initial_capital, total_disbursed, total_collected, total_interest_earned)
SELECT 50000000, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM capital_pool);

-- Capital transactions log (audit trail)
CREATE TABLE IF NOT EXISTS capital_transactions (
  id SERIAL PRIMARY KEY,
  transaction_type VARCHAR(20) NOT NULL,  -- 'loan_disbursed' | 'payment_received' | 'capital_added' | 'capital_withdrawn'
  amount NUMERIC(15, 2) NOT NULL,
  loan_id INTEGER REFERENCES loans(id),
  transaction_id INTEGER REFERENCES transactions(id),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capital_txn_created_at
  ON capital_transactions (created_at DESC);

-- ============================================================
-- Recalculate the pool from existing data so historical loans
-- and payments are reflected. This is an absolute SET derived
-- from source tables, so it is safe to re-run.
--
-- For each completed payment we split it into the principal vs
-- interest portion using the loan's principal / total_amount_due
-- ratio. Only the principal portion reduces outstanding capital;
-- the interest portion is profit.
-- ============================================================
WITH agg AS (
  SELECT
    (SELECT COALESCE(SUM(principal_amount), 0) FROM loans) AS disbursed,
    COALESCE(SUM(
      t.amount_paid * (l.principal_amount / NULLIF(l.total_amount_due, 0))
    ), 0) AS principal_collected,
    COALESCE(SUM(
      t.amount_paid * (1 - l.principal_amount / NULLIF(l.total_amount_due, 0))
    ), 0) AS interest_collected
  FROM transactions t
  JOIN loans l ON t.loan_id = l.id
  WHERE t.payment_status = 'completed'
)
UPDATE capital_pool
SET total_disbursed       = agg.disbursed,
    total_collected       = agg.principal_collected,
    total_interest_earned = agg.interest_collected,
    updated_at            = NOW()
FROM agg;
