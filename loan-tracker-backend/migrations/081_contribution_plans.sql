-- 081: recurring contribution PLANS (set the monthly contribution once — amount,
-- due day, fine rule — and cycles auto-open each period), plus per-CYCLE fine
-- config so a cycle carries its own late-fee rule (defaulted from the plan).
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS contribution_plans (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  welfare_id     integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name           varchar(80) NOT NULL DEFAULT 'Monthly contribution',
  frequency      varchar(20) NOT NULL DEFAULT 'monthly',
  amount         numeric NOT NULL,
  due_day        integer NOT NULL DEFAULT 10,   -- day of the month the contribution is due
  grace_days     integer NOT NULL DEFAULT 0,
  fine_calc_type varchar(20),                   -- fixed | percentage | daily_fixed | daily_percentage
  fine_amount    numeric,
  fine_rate      numeric,
  fine_cap       numeric,
  active         boolean NOT NULL DEFAULT true,
  created_by     integer,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
-- One active plan per (welfare, frequency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contribution_plan ON public.contribution_plans(welfare_id, frequency) WHERE active;

-- Per-cycle fine rule + the link back to the plan + the period it covers.
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS plan_id integer REFERENCES public.contribution_plans(id) ON DELETE SET NULL;
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS period_key varchar(7);   -- e.g. 2026-07
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS grace_days integer;
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS fine_calc_type varchar(20);
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS fine_amount numeric;
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS fine_rate numeric;
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS fine_cap numeric;
-- One auto-opened cycle per plan per period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cycle_plan_period ON public.contribution_cycles(plan_id, period_key) WHERE plan_id IS NOT NULL AND period_key IS NOT NULL;

COMMIT;
