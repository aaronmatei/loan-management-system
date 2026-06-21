-- Welfare decisions: governance votes (motions) the whole group decides on —
-- rule changes, spending approvals, electing/removing officers. One member, one
-- vote. A decision passes when approvals reach the quorum threshold
-- (quorum_percent of active members). The `election` type + target columns are
-- used by Phase 4 to assign an officer role when an election passes.
BEGIN;

CREATE TABLE IF NOT EXISTS welfare_decisions (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  welfare_id       integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type             varchar(20) NOT NULL DEFAULT 'motion',   -- motion | election
  title            varchar(160) NOT NULL,
  description      text,
  status           varchar(20) NOT NULL DEFAULT 'open',     -- open | passed | rejected | cancelled
  quorum_percent   integer NOT NULL DEFAULT 50,             -- % of active members who must APPROVE to pass
  closes_at        timestamp,                               -- optional deadline
  opened_by_member integer REFERENCES members(id) ON DELETE SET NULL,
  opened_by_user   integer,                                 -- staff opener (users.id)
  opened_by_name   varchar(120),
  target_member_id integer REFERENCES members(id) ON DELETE SET NULL, -- election: who is being elected
  target_role      varchar(20),                             -- election: chair|treasurer|secretary
  resolved_at      timestamp,
  created_at       timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_decisions_welfare ON welfare_decisions(welfare_id, created_at DESC);

CREATE TABLE IF NOT EXISTS welfare_decision_votes (
  id          serial PRIMARY KEY,
  decision_id integer NOT NULL REFERENCES welfare_decisions(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  vote        varchar(10) NOT NULL,                         -- approve | reject | abstain
  comment     text,
  voted_at    timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (decision_id, member_id)
);

COMMIT;
