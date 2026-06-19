-- 085: contributions split into POOLS. Monthly = a "savings" pool (members own
-- their balance — stays in member_pool_transactions, untouched). Quarterly &
-- one-off emergencies = "benefit" pools that collect contributions AND disburse
-- lump sums to member beneficiaries — tracked in their own ledger here so the
-- savings pool's accounting is never affected. Idempotent.

BEGIN;

-- savings | benefit. Monthly stays savings; quarterly/emergencies are benefit.
ALTER TABLE contribution_plans  ADD COLUMN IF NOT EXISTS pool_kind varchar(16) NOT NULL DEFAULT 'savings';

-- Which pool a cycle's payments land in. 'savings' → member_pool_transactions;
-- anything else (e.g. 'plan-7', 'oneoff') → benefit_pool_ledger.
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS pool_key varchar(32) NOT NULL DEFAULT 'savings';
-- For benefit one-offs (emergencies): who receives the payout.
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS beneficiary_member_id integer REFERENCES members(id) ON DELETE SET NULL;

-- Benefit-pool ledger: contributions in (+), payouts to beneficiaries out (-),
-- with a running balance per (welfare_id, pool_key).
CREATE TABLE IF NOT EXISTS benefit_pool_ledger (
  id           SERIAL PRIMARY KEY,
  tenant_id    integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  welfare_id   integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  pool_key     varchar(32) NOT NULL,
  member_id    integer REFERENCES members(id) ON DELETE SET NULL, -- contributor, or beneficiary for payouts
  type         varchar(24) NOT NULL,            -- contribution | payout | adjustment
  cycle_id     integer REFERENCES contribution_cycles(id) ON DELETE SET NULL,
  amount       numeric(14,2) NOT NULL,
  direction    smallint NOT NULL,               -- +1 in, -1 out
  balance_after numeric(14,2) NOT NULL,
  txn_date     date NOT NULL DEFAULT CURRENT_DATE,
  description  text,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_benefit_pool_ledger_pool ON benefit_pool_ledger (welfare_id, pool_key, id);

COMMIT;
