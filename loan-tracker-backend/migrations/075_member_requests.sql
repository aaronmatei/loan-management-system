-- 075: member-initiated requests (loan + savings withdrawal)
--
-- A welfare member can request a loan from the chama pool or a withdrawal of
-- their savings; a welfare admin approves or rejects. Kept in their own tables
-- (NOT a 'pending' member_loans row) so pool/listing/allocation logic keeps
-- assuming member_loans are real, issued loans. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loan_requests (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL,
  member_id       integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  principal       numeric(14,2) NOT NULL,
  duration_months integer NOT NULL DEFAULT 1,
  interest_rate   numeric(6,3),
  purpose         text,
  status          varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     integer,
  decision_notes  text,
  issued_loan_id  integer REFERENCES member_loans(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  decided_at      timestamp
);
CREATE INDEX IF NOT EXISTS idx_mlr_welfare_status ON member_loan_requests(welfare_id, status);
CREATE INDEX IF NOT EXISTS idx_mlr_member ON member_loan_requests(member_id);

CREATE TABLE IF NOT EXISTS member_withdrawal_requests (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL,
  member_id       integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL,
  reason          text,
  status          varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     integer,
  decision_notes  text,
  pool_txn_id     integer REFERENCES member_pool_transactions(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  decided_at      timestamp
);
CREATE INDEX IF NOT EXISTS idx_mwr_welfare_status ON member_withdrawal_requests(welfare_id, status);
CREATE INDEX IF NOT EXISTS idx_mwr_member ON member_withdrawal_requests(member_id);

COMMIT;
