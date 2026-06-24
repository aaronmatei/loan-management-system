-- Member RSVP / attendance confirmations for a SCHEDULED meeting.
-- Distinct from member_attendance (the admin-recorded actual attendance after
-- a meeting is held). Used to gauge quorum (50% + 1 of active non-exempt
-- members) before a meeting; if quorum isn't confirmed the admin can suspend
-- the meeting (group_meetings.status = 'suspended') and schedule another.
CREATE TABLE IF NOT EXISTS meeting_confirmations (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  welfare_id   INTEGER NOT NULL,
  meeting_id   INTEGER NOT NULL REFERENCES group_meetings(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  attending    BOOLEAN NOT NULL,          -- true = will attend, false = can't
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_confirmations_meeting ON meeting_confirmations (meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_confirmations_member  ON meeting_confirmations (member_id);
