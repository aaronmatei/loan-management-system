-- Branches: per-tenant operational units (e.g. "Westlands", "CBD").
-- Every tenant gets a "Main" branch auto-seeded so existing clients
-- and create-flows that don't yet pick a branch stay valid.
--
-- A client belongs to exactly one branch. Branches are soft-archived
-- via `active = false` (we never delete — clients reference them
-- via FK) and uniqueness on name is per-tenant + active row only.

CREATE TABLE IF NOT EXISTS branches (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(80) NOT NULL,
  code        VARCHAR(20),
  location    VARCHAR(120),
  phone       VARCHAR(20),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Per-tenant uniqueness on the active name. Archived branches with
-- the same name don't block re-use.
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_name_active_unique
  ON branches (tenant_id, lower(name))
  WHERE active;

-- Only one default branch per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_default_unique
  ON branches (tenant_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_branches_tenant
  ON branches (tenant_id);

-- Seed a "Main" default branch for every existing tenant.
INSERT INTO branches (tenant_id, name, is_default, active)
SELECT t.id, 'Main', TRUE, TRUE
  FROM tenants t
 WHERE NOT EXISTS (
         SELECT 1 FROM branches b WHERE b.tenant_id = t.id
       );

-- Clients now carry a branch. Nullable for the transition, but the
-- backfill below points every existing client at their tenant's
-- default branch so the column reads as effectively-required.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS branch_id INTEGER
    REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_branch
  ON clients (branch_id);

UPDATE clients c
   SET branch_id = b.id
  FROM branches b
 WHERE b.tenant_id = c.tenant_id
   AND b.is_default
   AND c.branch_id IS NULL;
