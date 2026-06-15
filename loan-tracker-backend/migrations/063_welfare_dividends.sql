-- 063: Welfare dividends / share-out
--
-- A share-out distributes the pool's retained surplus (pool balance above the
-- members' savings principal — i.e. accumulated penalty + loan-interest income)
-- to members, pro-rata by savings or split equally. Each member's share is paid
-- out as a 'dividend' member_pool_transactions row (direction -1, cash leaves
-- the pool). Dividends are NOT savings principal, so the savings calc excludes
-- them. This header table records each share-out event. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS dividend_distributions (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  welfare_id    integer NOT NULL,
  total_amount  numeric(15,2) NOT NULL,
  basis         varchar(20) NOT NULL DEFAULT 'savings', -- 'savings' | 'equal'
  member_count  integer NOT NULL DEFAULT 0,
  notes         text,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dividend_dist_welfare ON dividend_distributions(welfare_id);

-- Link each dividend ledger row back to its distribution for per-event breakdown.
ALTER TABLE member_pool_transactions ADD COLUMN IF NOT EXISTS dividend_distribution_id integer;

COMMIT;
