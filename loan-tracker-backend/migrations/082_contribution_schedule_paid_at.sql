-- 082: when a contribution schedule was fully paid — lets the cycle view show
-- who paid on time vs late (and by how many days). Idempotent.

BEGIN;

ALTER TABLE contribution_schedules
  ADD COLUMN IF NOT EXISTS paid_at timestamp;

COMMIT;
