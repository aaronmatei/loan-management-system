-- Client type — Individual / Group / Business.
--
-- Stored on BOTH platform_customers (the cross-tenant identity row;
-- captured at portal sign-up) and clients (the per-tenant lender
-- record). Per-tenant value defaults to whatever the customer
-- self-identified as on registration, but staff can edit it per
-- lender (e.g. one tenant treats a chama as a "group", another as a
-- "business").
--
-- Existing rows are backfilled by inferring from business_name:
--   business_name IS NOT NULL  →  'business'
--   else                       →  'individual'
-- "group" is not in the heuristic — admins can switch a row to
-- 'group' manually if appropriate.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(20) NOT NULL DEFAULT 'individual'
    CHECK (client_type IN ('individual', 'group', 'business'));

ALTER TABLE platform_customers
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(20) NOT NULL DEFAULT 'individual'
    CHECK (client_type IN ('individual', 'group', 'business'));

UPDATE clients
   SET client_type = 'business'
 WHERE business_name IS NOT NULL
   AND TRIM(business_name) <> ''
   AND client_type = 'individual';

UPDATE platform_customers
   SET client_type = 'business'
 WHERE business_name IS NOT NULL
   AND TRIM(business_name) <> ''
   AND client_type = 'individual';

CREATE INDEX IF NOT EXISTS idx_clients_client_type
  ON clients (tenant_id, client_type);
