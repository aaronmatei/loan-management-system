-- 052: Group savings + joint-liability coverage (Phase 5b)
--
-- A group's own savings fund: members contribute, the group can withdraw, and
-- — operationalising the joint liability from Phase 5a — savings can be applied
-- to cover a member's outstanding loan ('liability_coverage'). Coverage runs
-- through the normal payment path (capital_pool recovers), so this ledger only
-- tracks the GROUP's money, never the lender's capital pool directly.
--
-- A single append-only ledger per group; balance_after is the running group
-- savings balance. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS group_savings_transactions (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,  -- attributed member (null = group-level)
  type           VARCHAR(24) NOT NULL,   -- contribution | withdrawal | liability_coverage | adjustment
  amount         NUMERIC NOT NULL CHECK (amount > 0),
  direction      SMALLINT NOT NULL,      -- +1 increases savings, -1 decreases
  balance_after  NUMERIC NOT NULL,
  loan_id        INTEGER REFERENCES loans(id) ON DELETE SET NULL,    -- set for liability_coverage
  txn_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  created_by     INTEGER,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_savings_group  ON group_savings_transactions(group_id, id);
CREATE INDEX IF NOT EXISTS idx_group_savings_client ON group_savings_transactions(client_id);

COMMIT;
