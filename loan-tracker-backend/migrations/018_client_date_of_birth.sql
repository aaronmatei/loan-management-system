-- 018_client_date_of_birth.sql
--
-- Borrower demographics: capture a client's date of birth on the tenant's
-- own `clients` record. Until now DOB only lived on platform_customers
-- (customer portal), which most tenant clients aren't linked to — so the
-- dashboard had no way to bucket loans by borrower age. This adds the
-- column directly to clients so the "Loans by Age" chart (active /
-- completed / defaulted by age group) can be computed per tenant.
--
-- Nullable on purpose: existing clients have no DOB and it stays optional
-- on the Add/Edit Client form; the age chart simply ignores NULL DOBs.

BEGIN;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMIT;

-- Verify
SELECT COUNT(*) AS clients_total,
       COUNT(date_of_birth) AS clients_with_dob
FROM clients;
