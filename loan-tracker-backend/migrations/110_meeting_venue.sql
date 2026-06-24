-- 110: Separate Venue from Location on welfare meetings.
--
-- group_meetings.location historically held "where it's held" as one free-text
-- field. Welfares that rotate between towns want both the town (Location, e.g.
-- "Kitengela") and the specific place (Venue, e.g. "Doctors Plaza"). Add a
-- dedicated venue column; location keeps its meaning (town/area). Idempotent.

BEGIN;

ALTER TABLE group_meetings ADD COLUMN IF NOT EXISTS venue text;

COMMIT;
