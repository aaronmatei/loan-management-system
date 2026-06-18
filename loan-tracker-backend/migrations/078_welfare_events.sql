-- 078: Welfare EVENTS — an ad-hoc payout to a member (sickness, bereavement,
-- ceremony), funded by a SEPARATE "events pool" the members contribute into.
-- Distinct from the savings pool (member_pool_transactions): event money never
-- credits a member's savings equity.
--
-- Also categorises contribution cycles so only the compulsory 'savings' cycle
-- credits equity; everything else (e.g. a future events cycle) does not.
-- Idempotent.

BEGIN;

-- Only 'savings' contribution cycles credit member equity (welfarePoolService
-- SAVINGS_TYPES). Existing cycles default to 'savings' = current behaviour.
ALTER TABLE contribution_cycles
  ADD COLUMN IF NOT EXISTS category varchar(20) NOT NULL DEFAULT 'savings';

-- An event: a payout of `amount` to a beneficiary member. Funded from the
-- events pool; a shortfall is collected from members (equal shares) or — phase 2
-- — bridged from the savings pool.
CREATE TABLE IF NOT EXISTS welfare_events (
  id                    serial PRIMARY KEY,
  tenant_id             integer NOT NULL,
  welfare_id            integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title                 varchar(120) NOT NULL,
  description           text,
  beneficiary_member_id integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  amount                numeric NOT NULL CHECK (amount > 0),  -- N: amount needed / to disburse
  due_date              date,                                 -- shortfall collection deadline
  funding_mode          varchar(20),                          -- pool | collect | bridge
  shortfall_amount      numeric NOT NULL DEFAULT 0,           -- S = N - events-pool balance at decision
  bridged_amount        numeric NOT NULL DEFAULT 0,           -- borrowed from savings (phase 2)
  bridge_repaid         numeric NOT NULL DEFAULT 0,
  disbursed_amount      numeric NOT NULL DEFAULT 0,
  disbursed_at          timestamp,
  status                varchar(20) NOT NULL DEFAULT 'open',  -- open|collecting|disbursed|settled|closed
  notes                 text,
  created_by            integer,
  created_at            timestamp NOT NULL DEFAULT NOW(),
  updated_at            timestamp NOT NULL DEFAULT NOW()
);

-- Per-member shares of an event's shortfall (mirrors contribution_schedules).
CREATE TABLE IF NOT EXISTS welfare_event_shares (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  event_id    integer NOT NULL REFERENCES public.welfare_events(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount_due  numeric NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  status      varchar(20) NOT NULL DEFAULT 'pending',  -- pending|partial|paid
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, member_id)
);

-- The events pool's money trail. Its own running balance — the events pool is
-- SEPARATE from the savings pool.
CREATE TABLE IF NOT EXISTS welfare_event_ledger (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  welfare_id    integer NOT NULL,
  event_id      integer REFERENCES public.welfare_events(id) ON DELETE SET NULL,
  member_id     integer REFERENCES public.members(id) ON DELETE SET NULL,
  type          varchar(24) NOT NULL,  -- contribution | payout | bridge_in | bridge_repay
  amount        numeric NOT NULL CHECK (amount > 0),
  direction     smallint NOT NULL,     -- +1 into the pool, -1 out
  balance_after numeric NOT NULL,
  txn_date      date NOT NULL DEFAULT CURRENT_DATE,
  description   text,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_welfare_events_welfare ON public.welfare_events(welfare_id, status);
CREATE INDEX IF NOT EXISTS idx_welfare_event_shares_event ON public.welfare_event_shares(event_id);
CREATE INDEX IF NOT EXISTS idx_welfare_event_shares_member ON public.welfare_event_shares(member_id);
CREATE INDEX IF NOT EXISTS idx_welfare_event_ledger_welfare ON public.welfare_event_ledger(welfare_id, id);

COMMIT;
