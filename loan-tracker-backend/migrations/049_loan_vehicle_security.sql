-- 049: Vehicle security for logbook loans
--
-- A logbook loan is a normal amortized installment loan (full application →
-- approval → disburse flow, loan_type='logbook' from its package) secured by a
-- vehicle whose LOGBOOK is held under a lien while the vehicle stays with the
-- borrower. This table records the vehicle + the lien, separate from pawn's
-- loan_collateral (different fields and lifecycle: active → released on
-- completion, or repossessed on default).
--
-- One vehicle per logbook loan (Phase 3). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS loan_vehicle_security (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL,
  loan_id             INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  make                VARCHAR(60),
  model               VARCHAR(60),
  year                INTEGER,
  registration_number VARCHAR(40) NOT NULL,
  logbook_number      VARCHAR(60),
  chassis_number      VARCHAR(60),
  engine_number       VARCHAR(60),
  color               VARCHAR(40),
  valuation           NUMERIC NOT NULL,
  logbook_held        BOOLEAN NOT NULL DEFAULT true,   -- lender holds the physical logbook
  storage_location    VARCHAR(120),                    -- where the logbook is kept
  lien_status         VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | released | repossessed
  notes               TEXT,
  released_at         TIMESTAMP,
  repossessed_at      TIMESTAMP,
  created_by          INTEGER,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id)
);

CREATE INDEX IF NOT EXISTS idx_loan_vehicle_loan   ON loan_vehicle_security(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_vehicle_tenant ON loan_vehicle_security(tenant_id, lien_status);

COMMIT;
