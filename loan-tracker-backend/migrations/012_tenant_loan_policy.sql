-- 012: Per-tenant loan policy columns
-- Adds the policy fields the widget & portal calculators previously
-- hardcoded (15% / 1k-1M / 24mo). Default rate is 50% p.a. — the new
-- platform default. Existing rows get the same defaults via the
-- DEFAULT clause; explicit UPDATE backfills any nulls from older
-- environments that may have run a partial ALTER previously.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE ... WHERE IS NULL.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_interest_rate  NUMERIC(5,2)  DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS default_loan_duration  INTEGER       DEFAULT 6,
  ADD COLUMN IF NOT EXISTS min_loan_amount        NUMERIC(15,2) DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_loan_amount        NUMERIC(15,2) DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS late_payment_fee       NUMERIC(15,2) DEFAULT 500;

-- Backfill any rows that pre-existed the ADD COLUMN (DEFAULT only
-- applies to subsequent inserts on some PG versions when added in a
-- separate statement).
UPDATE tenants
   SET default_interest_rate = COALESCE(default_interest_rate, 50.00),
       default_loan_duration = COALESCE(default_loan_duration, 6),
       min_loan_amount       = COALESCE(min_loan_amount,       1000),
       max_loan_amount       = COALESCE(max_loan_amount,       1000000),
       late_payment_fee      = COALESCE(late_payment_fee,      500)
 WHERE default_interest_rate IS NULL
    OR default_loan_duration IS NULL
    OR min_loan_amount       IS NULL
    OR max_loan_amount       IS NULL
    OR late_payment_fee      IS NULL;

COMMIT;
