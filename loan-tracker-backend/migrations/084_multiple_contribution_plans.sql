-- 084: a welfare runs MULTIPLE named contributions at once (e.g. "Monthly" and
-- "Quarterly"). Drop the one-active-plan-per-frequency rule; keep names distinct
-- per welfare instead. Idempotent.

BEGIN;

DROP INDEX IF EXISTS uq_contribution_plan;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contribution_plan_name
  ON public.contribution_plans (welfare_id, lower(name)) WHERE active;

COMMIT;
