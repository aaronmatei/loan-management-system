-- 067: Pawn auctions (disposal workflow)
--
-- A formal alternative to the quick "forfeit": overdue items go through
-- schedule → sale → settlement. Settlement recovers what the borrower owed
-- into the capital pool, records any SURPLUS (owed back to the customer) or
-- DEFICIENCY (shortfall the shop absorbs / customer still owes).
-- Statuses: scheduled → completed | cancelled. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS pawn_auctions (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  loan_id       integer NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'scheduled', -- scheduled|completed|cancelled
  auction_date  date,
  reserve_price numeric(12,2),
  sale_price    numeric(12,2),
  buyer_name    varchar(120),
  fees          numeric(12,2) NOT NULL DEFAULT 0,
  amount_owed   numeric(12,2),   -- outstanding snapshot at completion
  recovered     numeric(12,2) NOT NULL DEFAULT 0, -- credited back to the pool
  surplus       numeric(12,2) NOT NULL DEFAULT 0, -- net sale above what was owed → customer
  deficiency    numeric(12,2) NOT NULL DEFAULT 0, -- shortfall below what was owed
  notes         text,
  created_by    integer,
  completed_by  integer,
  created_at    timestamp NOT NULL DEFAULT NOW(),
  updated_at    timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pawn_auctions_tenant ON pawn_auctions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pawn_auctions_loan   ON pawn_auctions(loan_id);

COMMIT;
