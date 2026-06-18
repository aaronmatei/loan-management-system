-- 080: members can REQUEST event funds (amount + the event date). A welfare
-- admin reviews; approval creates a welfare_event (beneficiary = the requester).
-- Mirrors member_loan_requests / member_withdrawal_requests. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_event_requests (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  welfare_id       integer NOT NULL,
  member_id        integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL,
  event_date       date,
  reason           text,
  status           varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      integer,
  decision_notes   text,
  created_event_id integer REFERENCES public.welfare_events(id) ON DELETE SET NULL,
  created_at       timestamp NOT NULL DEFAULT now(),
  decided_at       timestamp
);
CREATE INDEX IF NOT EXISTS idx_member_event_requests_welfare ON public.member_event_requests(welfare_id, status);
CREATE INDEX IF NOT EXISTS idx_member_event_requests_member ON public.member_event_requests(member_id);

COMMIT;
