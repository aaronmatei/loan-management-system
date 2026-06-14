-- 050: Salary / check-off advances
--
-- A salary advance is a normal installment loan (standard application →
-- approval → disburse flow, loan_type='salary' from its package) repaid by
-- employer check-off — the employer deducts the instalment from the borrower's
-- payslip and remits it. This table holds the employment + check-off details,
-- separate from pawn's loan_collateral and logbook's loan_vehicle_security.
--
-- max_deduction_percent caps the instalment as a share of net pay (affordability
-- / the Kenyan "two-thirds rule"); it's stored per loan so the assessment is
-- reproducible. One record per loan. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS loan_salary_details (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL,
  loan_id               INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  employer_name         VARCHAR(120) NOT NULL,
  employer_contact      VARCHAR(120),
  staff_number          VARCHAR(60),
  net_monthly_pay       NUMERIC NOT NULL,
  payday_day            INTEGER,                 -- day of month salary is paid (1-31)
  max_deduction_percent NUMERIC NOT NULL DEFAULT 50,
  check_off_status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | active | stopped | completed
  notes                 TEXT,
  activated_at          TIMESTAMP,
  stopped_at            TIMESTAMP,
  created_by            INTEGER,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id)
);

CREATE INDEX IF NOT EXISTS idx_loan_salary_loan   ON loan_salary_details(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_salary_tenant ON loan_salary_details(tenant_id, check_off_status);

COMMIT;
