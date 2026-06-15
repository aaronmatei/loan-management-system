-- 060: Welfare contribution cycles + schedules
--
-- A cycle is one contribution period (e.g. "July 2026"). Opening a cycle
-- generates a schedule row per active member with an amount due and a due date;
-- payments allocate against the schedule (and post into the pool as savings).
-- Overdue schedules drive contribution_late penalties via the penalty engine.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS contribution_cycles (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  welfare_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL,
  frequency    VARCHAR(20) NOT NULL DEFAULT 'monthly',
  amount       NUMERIC NOT NULL,        -- expected per member
  period_start DATE,
  due_date     DATE NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'open', -- open | closed
  notes        TEXT,
  created_by   INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contribution_schedules (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  cycle_id    INTEGER NOT NULL REFERENCES contribution_cycles(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount_due  NUMERIC NOT NULL,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  due_date    DATE NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | partial | paid | overdue
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_contrib_cycles_welfare ON contribution_cycles(welfare_id, status);
CREATE INDEX IF NOT EXISTS idx_contrib_schedules_cycle ON contribution_schedules(cycle_id);
CREATE INDEX IF NOT EXISTS idx_contrib_schedules_member ON contribution_schedules(member_id);

COMMIT;
