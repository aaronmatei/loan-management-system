-- 045: Loan underwriting + CRB credit checks
--
-- Underwriting slots into the existing application lifecycle (pending →
-- under_review → approved/rejected). It surfaces a risk worksheet (internal
-- score, CRB result, existing exposure, KYC, repayment history) for the
-- officer's manual decision.
--
--   • credit_checks — one row per CRB pull. The latest for a client feeds the
--     worksheet. `source` distinguishes a real bureau API call from an
--     officer-keyed manual entry or an internal estimate (the stub provider).
--   • loans.*       — the underwriting decision recorded on the application.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS credit_checks (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  client_id   INTEGER NOT NULL,
  loan_id     INTEGER,
  provider    VARCHAR(40)  NOT NULL DEFAULT 'manual',
  source      VARCHAR(20)  NOT NULL DEFAULT 'manual',  -- api | manual | estimate
  reference   VARCHAR(120),
  national_id VARCHAR(40),
  score       INTEGER,
  grade       VARCHAR(8),
  status      VARCHAR(20),   -- clear | listed | defaulted | no_hit | unknown
  report      JSONB,
  checked_by  INTEGER,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_checks_client ON credit_checks(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_checks_loan   ON credit_checks(loan_id);

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS risk_grade         VARCHAR(8),
  ADD COLUMN IF NOT EXISTS underwriting_notes TEXT,
  ADD COLUMN IF NOT EXISTS underwritten_by    INTEGER,
  ADD COLUMN IF NOT EXISTS underwritten_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS credit_check_id    INTEGER;

COMMIT;
