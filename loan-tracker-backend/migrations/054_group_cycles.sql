-- 054: Group lending cycles / rounds (Phase 5c)
--
-- Group lending runs in rounds: a cycle bounds a round of member loans (e.g. a
-- quarter), opens, then closes once everyone has repaid. Each member loan may
-- belong to one cycle (loans.cycle_id). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS group_cycles (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  name         VARCHAR(80),
  start_date   DATE,
  end_date     DATE,
  status       VARCHAR(20) NOT NULL DEFAULT 'open', -- open | closed
  notes        TEXT,
  created_by   INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, cycle_number)
);

ALTER TABLE loans ADD COLUMN IF NOT EXISTS cycle_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_group_cycles_group ON group_cycles(group_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_cycle ON loans(cycle_id);

COMMIT;
