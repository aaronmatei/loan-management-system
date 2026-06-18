-- 079: when an event's funds are actually needed (the event date), distinct
-- from the collection deadline (due_date). Idempotent.

BEGIN;

ALTER TABLE welfare_events
  ADD COLUMN IF NOT EXISTS needed_by date;

COMMIT;
