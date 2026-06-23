-- Remove back-dated event/emergency (benefit) contribution cycles that were
-- auto-created merely by viewing a past year in the admin overview (now
-- prevented in loadPlanOverview). Strictly scoped so nothing real is lost:
--   • plan-generated benefit cycles only (pool_key <> 'savings'),
--   • dated before the current year,
--   • with NO contribution paid on any schedule, and
--   • with NO late-contribution fine paid.
-- Anything with a payment (contribution or fine) is left untouched.
BEGIN;

CREATE TEMP TABLE _stale_cycles ON COMMIT DROP AS
  SELECT c.id
    FROM contribution_cycles c
   WHERE c.plan_id IS NOT NULL
     AND COALESCE(c.pool_key, 'savings') <> 'savings'
     AND EXTRACT(YEAR FROM c.due_date) < EXTRACT(YEAR FROM CURRENT_DATE)
     AND NOT EXISTS (
       SELECT 1 FROM contribution_schedules s
        WHERE s.cycle_id = c.id AND COALESCE(s.amount_paid, 0) > 0
     )
     AND NOT EXISTS (
       SELECT 1 FROM contribution_schedules s
       JOIN penalty_assessments p
         ON p.source_type = 'contribution_schedule' AND p.source_id = s.id
       WHERE s.cycle_id = c.id AND COALESCE(p.paid_amount, 0) > 0
     );

-- Drop the (unpaid) late-contribution fines tied to those cycles' schedules, so
-- no orphaned penalty points to a deleted schedule.
DELETE FROM penalty_assessments
 WHERE source_type = 'contribution_schedule'
   AND source_id IN (
     SELECT s.id FROM contribution_schedules s WHERE s.cycle_id IN (SELECT id FROM _stale_cycles)
   );

-- Then the schedules and the cycles. (Deleting a cycle cascades its schedules
-- and SET NULLs benefit_pool_ledger.cycle_id — but unpaid cycles have no ledger
-- rows; schedules are removed explicitly first for clarity.)
DELETE FROM contribution_schedules WHERE cycle_id IN (SELECT id FROM _stale_cycles);
DELETE FROM contribution_cycles    WHERE id       IN (SELECT id FROM _stale_cycles);

COMMIT;
