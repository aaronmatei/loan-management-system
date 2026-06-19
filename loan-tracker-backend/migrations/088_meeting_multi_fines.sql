-- 088: fines live ON the contribution/event/meeting (defined when you create it),
-- not as shared penalty_rules. A meeting carries TWO fixed fines: one for late,
-- one for absent. (Contributions already store their late fine inline.) Idempotent.

BEGIN;
ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS fine_late   numeric;
ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS fine_absent numeric;
COMMIT;
