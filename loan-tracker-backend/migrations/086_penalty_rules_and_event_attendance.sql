-- 086: fines come from the Penalties module (penalty_rules) instead of inline,
-- and "events" (e.g. dowry hand-outs) reuse the Meetings attendance engine,
-- linked to their pool payout. Idempotent.

BEGIN;

-- A contribution/event references the penalty rule it uses (its fine values are
-- still snapshotted onto the cycle so past cycles don't change when a rule does).
ALTER TABLE contribution_plans  ADD COLUMN IF NOT EXISTS penalty_rule_id integer REFERENCES penalty_rules(id) ON DELETE SET NULL;
ALTER TABLE contribution_cycles ADD COLUMN IF NOT EXISTS penalty_rule_id integer REFERENCES penalty_rules(id) ON DELETE SET NULL;

-- A short name for a meeting/gathering ("what were we attending").
ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS title varchar(120);

-- Link a benefit-pool payout to the gathering (meeting) where it was handed out.
ALTER TABLE benefit_pool_ledger ADD COLUMN IF NOT EXISTS meeting_id integer REFERENCES group_meetings(id) ON DELETE SET NULL;

COMMIT;
