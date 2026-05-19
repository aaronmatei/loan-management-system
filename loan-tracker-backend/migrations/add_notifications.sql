-- ============================================================
-- In-app notifications. The notifications table already exists as
-- a legacy SMS/email delivery log (client_id/channel/status/...);
-- this upgrades it in place to the in-app schema. Idempotent —
-- safe to run multiple times. Legacy columns are left nullable
-- and unused (the table has always had 0 rows; SMS/email actually
-- log to sms_logs / email_logs). Mirrored in init.sql.
-- ============================================================

-- Fresh databases that never ran init.sql get the full table here.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  icon VARCHAR(20),
  link VARCHAR(255),
  metadata JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Existing (legacy) databases: add the in-app columns. message and
-- created_at already exist and are compatible. New columns are
-- nullable on this path (the service always supplies them); adding
-- NOT NULL to a pre-existing table is unnecessary risk.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS icon VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread
  ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notif_date
  ON notifications(created_at DESC);
