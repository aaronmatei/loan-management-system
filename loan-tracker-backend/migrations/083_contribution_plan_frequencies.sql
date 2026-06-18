-- 083: support weekly / bi-weekly / monthly / quarterly (3-month) / yearly
-- contribution plans. due_day is interpreted per frequency (weekday 1–7 for
-- weekly/bi-weekly; day-of-month otherwise); yearly also needs a month. Period
-- keys get longer (e.g. 2026-W25, 2026-Q2). Idempotent.

BEGIN;

ALTER TABLE contribution_plans ADD COLUMN IF NOT EXISTS due_month integer; -- 1-12, for yearly
ALTER TABLE contribution_cycles ALTER COLUMN period_key TYPE varchar(16);

COMMIT;
