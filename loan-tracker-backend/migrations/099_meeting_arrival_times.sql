-- Meeting start time + grace period, and per-member arrival time + apology.
-- The admin records when each member arrived; the system marks late when arrival
-- is past start_time + grace_minutes. No arrival recorded = absent, unless an
-- apology was logged (excused, exempt from fines).
BEGIN;

ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE member_attendance ADD COLUMN IF NOT EXISTS arrival_time time;
ALTER TABLE member_attendance ADD COLUMN IF NOT EXISTS apology boolean NOT NULL DEFAULT false;

COMMIT;
