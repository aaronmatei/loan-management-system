-- Loan packages — pre-configured loan products per tenant.
--
-- A package locks the financial mechanics (interest_rate,
-- processing_fee_rate, interest_method) and range-validates the
-- amount + duration, so the borrower gets a real "product" rather
-- than a free-form bespoke loan. Admin can still create off-product
-- loans by leaving the package picker blank (loans.package_id NULL).
--
-- interest_method (NEW): 'flat' is the existing behavior (interest
-- spread evenly across all installments — total_interest =
-- principal × annualRate × years). 'reducing' is amortized: each
-- installment is the same EMI, but the interest portion declines
-- as the balance shrinks (standard for SACCOs / banks).
--
-- Both columns are added to `loans` so off-product custom loans can
-- still pick a method, and existing loans default to 'flat' (which
-- matches what was already computed).

CREATE TABLE IF NOT EXISTS loan_packages (
  id                     SERIAL PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                   VARCHAR(80)  NOT NULL,
  description            TEXT,

  -- Financial mechanics — locked on the loan when the package is picked.
  -- annual_interest_rate as a percent (e.g. 18 = 18% p.a.), to match
  -- the rest of the codebase. interest_rate column on loans stores the
  -- MONTHLY rate (annual / 12) — the existing convention.
  annual_interest_rate   NUMERIC(6,2) NOT NULL CHECK (annual_interest_rate >= 0),
  processing_fee_rate    NUMERIC(5,2) NOT NULL DEFAULT 0
                           CHECK (processing_fee_rate >= 0 AND processing_fee_rate <= 100),
  interest_method        VARCHAR(20)  NOT NULL DEFAULT 'flat'
                           CHECK (interest_method IN ('flat', 'reducing')),

  -- Validated ranges. A loan whose principal_amount or
  -- loan_duration_months falls outside is rejected at create time.
  min_amount             NUMERIC(15,2) NOT NULL CHECK (min_amount > 0),
  max_amount             NUMERIC(15,2) NOT NULL CHECK (max_amount >= min_amount),
  min_duration_months    INTEGER       NOT NULL CHECK (min_duration_months > 0),
  max_duration_months    INTEGER       NOT NULL
                           CHECK (max_duration_months >= min_duration_months),

  active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Per-tenant uniqueness on active name (archived names can be reused).
CREATE UNIQUE INDEX IF NOT EXISTS loan_packages_tenant_name_active_unique
  ON loan_packages (tenant_id, lower(name))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_loan_packages_tenant
  ON loan_packages (tenant_id);

-- Loans now carry the chosen package (nullable for off-product) and
-- the method that was applied. Both default to NULL / 'flat' so
-- existing loans read unchanged.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS package_id INTEGER
    REFERENCES loan_packages(id) ON DELETE SET NULL;

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS interest_method VARCHAR(20) NOT NULL DEFAULT 'flat'
    CHECK (interest_method IN ('flat', 'reducing'));

CREATE INDEX IF NOT EXISTS idx_loans_package
  ON loans (package_id) WHERE package_id IS NOT NULL;
