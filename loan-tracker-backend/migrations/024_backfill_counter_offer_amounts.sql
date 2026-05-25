-- 024: Backfill derived amounts on counter-offer loans
-- Before this, accepting a counter-offer set principal_amount = offered_amount
-- but did NOT recompute total_interest / total_amount_due / processing_fee /
-- net_disbursed_amount, leaving them based on the original requested amount.
-- The accept handler now recomputes them; this corrects loans already in that
-- stale state. Scoped to NOT-yet-disbursed loans (their schedules don't exist
-- yet) and counter-offer loans only (requested_amount IS NOT NULL).
--
-- interest_rate is the stored MONTHLY rate; processing_fee_rate is the rate
-- snapshotted at application. Idempotent — re-running recomputes the same
-- values from principal_amount.

BEGIN;

UPDATE loans SET
  total_interest = ROUND(
    principal_amount * (interest_rate / 100.0) * loan_duration_months, 2),
  total_amount_due = ROUND(
    principal_amount * (1 + (interest_rate / 100.0) * loan_duration_months), 2),
  processing_fee = ROUND(
    principal_amount * COALESCE(processing_fee_rate, 0) / 100.0, 2),
  net_disbursed_amount = ROUND(
    principal_amount - principal_amount * COALESCE(processing_fee_rate, 0) / 100.0, 2),
  updated_at = NOW()
WHERE requested_amount IS NOT NULL
  AND status IN ('pending', 'under_review', 'counter_offered', 'approved', 'rejected');

COMMIT;
