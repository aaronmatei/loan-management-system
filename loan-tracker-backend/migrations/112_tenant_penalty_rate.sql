-- Per-lender default penalty interest rate (monthly %, charged on the overdue
-- balance). Previously a fixed 5% platform default baked into loan creation;
-- now configurable per lender via Loan Settings, surfaced to borrowers on the
-- lender page, and used to seed the loan form. Existing tenants keep 5%.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS penalty_rate numeric(5,2) DEFAULT 5.00;
