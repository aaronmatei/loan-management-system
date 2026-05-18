-- ============================================================
-- Audit log. Upgrades the legacy minimal audit_logs table
-- (table_name/record_id/JSON) defined in init.sql to the rich
-- schema the audit feature needs. Idempotent — safe to run
-- multiple times and against either an old or fresh database.
-- ============================================================

-- Fresh databases that never ran init.sql get the full table here.
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER,
  entity_code VARCHAR(100),
  description TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Existing databases already have a legacy audit_logs table (created
-- by init.sql with table_name/record_id/JSON columns). Add the new
-- columns and widen/retype the shared ones. The legacy table_name /
-- record_id columns are intentionally LEFT IN PLACE (nullable, unused)
-- — nothing in the codebase reads them, so dropping is unnecessary
-- risk; they simply stay null going forward.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_email  VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_name   VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id   INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_code VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address  VARCHAR(45);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent  TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata    JSONB;

-- Widen action (legacy VARCHAR(20)) and move JSON -> JSONB. Re-running
-- these is harmless (no-op when the type already matches).
ALTER TABLE audit_logs ALTER COLUMN action TYPE VARCHAR(50);
ALTER TABLE audit_logs
  ALTER COLUMN old_values TYPE JSONB USING old_values::text::jsonb;
ALTER TABLE audit_logs
  ALTER COLUMN new_values TYPE JSONB USING new_values::text::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(created_at DESC);
