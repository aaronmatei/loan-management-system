-- 090: Member loans → lender parity.
--
-- Adds the product link, interest method, fees, overdue-penalty terms, the
-- start/end date range, a denormalised welfare_id (for scoping), and the
-- multi-stage approval workflow columns.
--
-- The `status` column stays free-text (no CHECK) — it now ranges over the
-- lender machine: pending → under_review → approved → active → completed,
-- plus rejected / counter_offered / defaulted. Existing rows are 'active'
-- (= disbursed) and read unchanged. The legacy quick-issue path keeps
-- creating 'active'; the new workflow starts at 'pending'. Idempotent.

BEGIN;

ALTER TABLE member_loans
  ADD COLUMN IF NOT EXISTS product_id          INTEGER REFERENCES member_loan_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS welfare_id          INTEGER,
  ADD COLUMN IF NOT EXISTS interest_method     VARCHAR(20)  NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS processing_fee_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_disbursed       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS late_fee            NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_rate        NUMERIC(6,3)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purpose             TEXT,
  ADD COLUMN IF NOT EXISTS start_date          DATE,
  ADD COLUMN IF NOT EXISTS end_date            DATE,
  ADD COLUMN IF NOT EXISTS reviewed_by         INTEGER,
  ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_by         INTEGER,
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_by         INTEGER,
  ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT,
  ADD COLUMN IF NOT EXISTS disbursed_by        INTEGER,
  ADD COLUMN IF NOT EXISTS counter_principal   NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS counter_rate        NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS counter_duration_months INTEGER,
  ADD COLUMN IF NOT EXISTS counter_notes       TEXT;

-- Backfill welfare_id for existing loans from their member.
UPDATE member_loans ml
   SET welfare_id = m.welfare_id
  FROM members m
 WHERE m.id = ml.member_id AND ml.welfare_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_loans_welfare ON member_loans(welfare_id, status);

COMMIT;
