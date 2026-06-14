-- 055: Member contributions pool (separate from the lending capital pool)
--
-- Some tenants (SACCO / welfare style) run a members' fund alongside their loan
-- book: members are their OWN roster (not loan customers) who contribute to a
-- shared pool. This pool is entirely separate from capital_pool — contributions
-- and withdrawals here never touch the lender's lending capital.
--
-- member_pool_transactions is a single append-only ledger of the pool's cash,
-- with a running balance_after (the pool balance). A member's own savings
-- balance is the net of their contribution/withdrawal/dividend rows. The
-- loan_disbursed / loan_repayment types + member_loan_id are reserved for
-- Part 2 (lending from the pool). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS members (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL,
  member_no            VARCHAR(30),
  first_name           VARCHAR(60) NOT NULL,
  last_name            VARCHAR(60) NOT NULL,
  phone_number         VARCHAR(20),
  id_number            VARCHAR(30),
  email                VARCHAR(120),
  status               VARCHAR(20) NOT NULL DEFAULT 'active', -- active | inactive
  monthly_contribution NUMERIC,        -- expected periodic contribution
  joined_at            DATE NOT NULL DEFAULT CURRENT_DATE,
  notes                TEXT,
  created_by           INTEGER,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_pool_transactions (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL,
  member_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  type           VARCHAR(24) NOT NULL,  -- contribution | withdrawal | dividend | adjustment | loan_disbursed | loan_repayment
  amount         NUMERIC NOT NULL CHECK (amount > 0),
  direction      SMALLINT NOT NULL,     -- +1 increases pool, -1 decreases
  balance_after  NUMERIC NOT NULL,      -- running pool balance
  member_loan_id INTEGER,               -- Part 2
  txn_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  created_by     INTEGER,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_tenant ON members(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_member_pool_tenant ON member_pool_transactions(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_member_pool_member ON member_pool_transactions(member_id);

COMMIT;
