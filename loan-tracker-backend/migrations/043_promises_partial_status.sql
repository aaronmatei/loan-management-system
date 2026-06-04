-- 043_promises_partial_status.sql
--
-- Add 'partial' to the promises_to_pay status enum so the payment
-- reconciliation hook can store the in-between state where some money
-- arrived after the promise was logged but it doesn't yet cover the
-- promised amount. The existing transitions stay intact:
--
--   pending → partial   (auto, on payment < promised amount)
--   pending → kept      (auto, on payment ≥ promised amount; manual still works)
--   pending → broken    (derived in route, promised_date < CURRENT_DATE)
--   pending → cancelled (manual, with reason)
--   partial → kept      (auto, when cumulative payment reaches the amount)
--   partial → partial   (sticks even after promised_date — borrower made effort)
--
-- Pure schema change; no data backfill needed (no existing rows are
-- 'partial' yet).

ALTER TABLE promises_to_pay
  DROP CONSTRAINT IF EXISTS promises_to_pay_status_check;

ALTER TABLE promises_to_pay
  ADD CONSTRAINT promises_to_pay_status_check
  CHECK (status IN ('pending', 'partial', 'kept', 'cancelled'));
