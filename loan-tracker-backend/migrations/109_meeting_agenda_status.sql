-- Agenda items now carry an approval status. Admin-added items are 'approved'
-- (the official agenda); member suggestions start 'suggested' until the admin
-- approves them (→ 'approved') or rejects them (deleted).
BEGIN;
ALTER TABLE meeting_agenda_items ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'approved';
-- Existing member-suggested items go back to pending approval; admin items stay approved.
UPDATE meeting_agenda_items SET status = 'suggested' WHERE suggested_by_member IS NOT NULL;
COMMIT;
