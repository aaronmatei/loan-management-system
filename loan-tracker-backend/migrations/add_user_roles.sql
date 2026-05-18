-- ============================================================
-- Multi-user roles. Adds the columns the user-management feature
-- needs to the existing users table. Idempotent — safe to run
-- multiple times. role stays VARCHAR(20) (fits 'loan_officer');
-- valid values: 'admin' | 'manager' | 'loan_officer' | 'viewer'.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
