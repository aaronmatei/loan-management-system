-- 053: Group meetings + attendance (Phase 5c)
--
-- Table-banking / chama groups meet regularly; attendance affects members'
-- standing. A meeting belongs to a group; attendance is one row per member per
-- meeting. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS group_meetings (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  meeting_date DATE NOT NULL,
  location     VARCHAR(120),
  agenda       TEXT,
  notes        TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | held | cancelled
  created_by   INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_meeting_attendance (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  meeting_id  INTEGER NOT NULL REFERENCES group_meetings(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL DEFAULT 'present', -- present | absent | apology | late
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_group_meetings_group ON group_meetings(group_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting ON group_meeting_attendance(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_client ON group_meeting_attendance(client_id);

COMMIT;
