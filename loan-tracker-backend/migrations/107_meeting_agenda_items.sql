-- Per-meeting agenda items. Members suggest items (appended); a member may edit
-- only their own, an admin may edit/reorder/delete any (harmonize). Minutes reuse
-- welfare_documents (category='minutes', meeting_id set) — no new table needed.
BEGIN;
CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  welfare_id          integer NOT NULL,
  meeting_id          integer NOT NULL REFERENCES group_meetings(id) ON DELETE CASCADE,
  content             text NOT NULL,
  position            integer NOT NULL DEFAULT 0,
  suggested_by_member integer REFERENCES members(id) ON DELETE SET NULL,
  suggested_by_user   integer,
  author_name         varchar(120),
  created_at          timestamp NOT NULL DEFAULT NOW(),
  updated_at          timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_agenda_items ON meeting_agenda_items(meeting_id, position, id);
COMMIT;
