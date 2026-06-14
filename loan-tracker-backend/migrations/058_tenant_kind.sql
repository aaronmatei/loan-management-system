-- 058: Tenant kind — distinguish lenders from self-registering welfare accounts
--
-- A welfare (chama/SACCO-style savings + credit group) can now self-register and
-- log into its own portal, separate from lender tenants. It reuses the tenant
-- engine (auth, subdomain, users) but kind='welfare' drives a welfare-only
-- experience (members, contributions pool, pool lending) with lender features
-- (clients, loan packages, lending capital, billing) hidden.
--
-- Existing tenants are lenders. Idempotent.

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'lender';

COMMIT;
