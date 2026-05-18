-- ============================================================
-- Backup history. Idempotent — safe to run multiple times.
-- Mirrored in init.sql for fresh installs.
-- ============================================================

CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  backup_type VARCHAR(20) DEFAULT 'manual',   -- manual | scheduled | pre_restore | uploaded
  status VARCHAR(20) DEFAULT 'success',        -- success | failed | in_progress
  error_message TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_date ON backups(created_at DESC);
