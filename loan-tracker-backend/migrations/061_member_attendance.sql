-- 061: Welfare meeting attendance over the members roster
--
-- Welfare meetings reuse group_meetings (a meeting belongs to the welfare's
-- group), but attendance must be tracked against the welfare `members` roster,
-- not the lender client-based group_meeting_attendance. Absent/late statuses
-- drive attendance penalties via the penalty engine. One row per
-- (meeting, member). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_attendance (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  welfare_id  INTEGER NOT NULL,
  meeting_id  INTEGER NOT NULL REFERENCES group_meetings(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'present', -- present | late | absent | excused
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_member_attendance_meeting ON member_attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_member_attendance_member ON member_attendance(member_id);

COMMIT;
