-- ============================================================
-- Add editable text fields to loans.
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================

ALTER TABLE loans ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS purpose TEXT;
