-- Persist the late-fee / penalty-interest split at the moment penalty
-- is charged on an installment. Until now we recomputed both live from
-- the current balance + days-late, which goes stale the instant a
-- payment lands and reduces the balance. The headline penalty_total
-- is already preserved via penalty_paid + the max() override in the
-- schedule annotation; these two columns let us also keep the
-- breakdown visible after the fact.

ALTER TABLE payment_schedules
  ADD COLUMN IF NOT EXISTS late_fee_charged         numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_interest_charged numeric(15,2) DEFAULT 0;

-- Backfill historic rows that have penalty_paid > 0 but no breakdown.
-- The flat late fee is one-off per overdue installment, so it caps at
-- the loan's late_payment_fee or whatever was paid (whichever is less);
-- whatever remains is the penalty-interest component.
UPDATE payment_schedules ps
   SET late_fee_charged =
         LEAST(COALESCE(l.late_payment_fee, 0), COALESCE(ps.penalty_paid, 0)),
       penalty_interest_charged =
         GREATEST(
           0,
           COALESCE(ps.penalty_paid, 0)
           - LEAST(COALESCE(l.late_payment_fee, 0), COALESCE(ps.penalty_paid, 0))
         )
  FROM loans l
 WHERE l.id = ps.loan_id
   AND COALESCE(ps.penalty_paid, 0) > 0
   AND COALESCE(ps.late_fee_charged, 0) = 0
   AND COALESCE(ps.penalty_interest_charged, 0) = 0;
