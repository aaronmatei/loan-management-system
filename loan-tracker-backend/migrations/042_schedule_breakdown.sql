-- Per-installment amortization breakdown on payment_schedules.
--
-- Until now schedule rows only stored amount_due (the EMI for
-- reducing-balance, or the even split for flat). For a reducing-
-- balance loan that hides the most informative thing about the loan:
-- the declining interest portion + rising principal portion + the
-- shrinking balance.
--
--   interest_portion   what the row's EMI buys in interest charges
--   principal_portion  what the row's EMI buys in principal repayment
--   balance_after      principal remaining after this row is paid
--
-- All three are SNAPSHOTS at disburse time — we don't dynamically
-- re-amortize when a borrower over/underpays. Overpayment continues
-- to roll forward to the next installment (existing behavior), so
-- the contractual schedule is the truth the borrower can plan
-- against; deviations show up as "balance still owed at row N".
--
-- For flat-rate loans these come out as constant interest +
-- constant principal so the UI renders the same columns for either
-- method — just with different numbers.

ALTER TABLE payment_schedules
  ADD COLUMN IF NOT EXISTS interest_portion  NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_schedules
  ADD COLUMN IF NOT EXISTS principal_portion NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_schedules
  ADD COLUMN IF NOT EXISTS balance_after     NUMERIC(12,2) NOT NULL DEFAULT 0;
