-- ============================================================
-- Loan application workflow. Adds the lifecycle columns to the
-- loans table. Idempotent — safe to run multiple times. Existing
-- rows keep status='active' (no backfill needed). Mirrored in
-- init.sql for fresh installs.
-- ============================================================

ALTER TABLE loans ADD COLUMN IF NOT EXISTS application_date DATE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursed_by INTEGER REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursement_method VARCHAR(30);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS disbursement_reference VARCHAR(100);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS application_source VARCHAR(50) DEFAULT 'walk_in';

-- Applications have no start/end date until disbursement, so the
-- original NOT NULL constraints must be relaxed. DROP NOT NULL is a
-- no-op if already nullable (idempotent).
ALTER TABLE loans ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE loans ALTER COLUMN end_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_application_date ON loans(application_date);
