-- 093: Guarantors backing a member loan.
--
-- Richer than the lender's flat guarantor_* columns on `loans`, because a
-- chama guarantor is usually ANOTHER member — guarantor_member_id links to
-- members(id); the free-text fields cover non-member guarantors. Multiple
-- guarantors per loan. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS member_loan_guarantors (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL,
  member_loan_id      INTEGER NOT NULL REFERENCES member_loans(id) ON DELETE CASCADE,
  guarantor_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  guarantor_name      VARCHAR(120),
  guarantor_phone     VARCHAR(30),
  guarantor_id_number VARCHAR(40),
  guaranteed_amount   NUMERIC(14,2),
  status              VARCHAR(20) NOT NULL DEFAULT 'active', -- active | released
  created_by          INTEGER,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_loan_guarantors_loan
  ON member_loan_guarantors(member_loan_id);

COMMIT;
