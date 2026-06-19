-- 087: a meeting/event picks its attendance fine rule (like a contribution picks
-- its late-fine rule). Applied to late + absent attendees. Idempotent.

BEGIN;
ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS penalty_rule_id integer REFERENCES penalty_rules(id) ON DELETE SET NULL;
COMMIT;
