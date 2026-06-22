-- Welfare investments — a chama typically parks idle funds in a Money Market
-- Fund. The admin records the amount invested and updates the current balance;
-- the difference (current − invested) is investment income (gain/loss). A simple
-- manual tracker, surfaced as a dashboard card; not posted to the pool ledger.
BEGIN;

CREATE TABLE IF NOT EXISTS welfare_investments (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name            varchar(120) NOT NULL,                 -- e.g. "CIC Money Market Fund"
  amount_invested numeric(15,2) NOT NULL DEFAULT 0,
  current_balance numeric(15,2) NOT NULL DEFAULT 0,
  notes           text,
  created_by      integer,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_investments_welfare ON welfare_investments(welfare_id);

COMMIT;
