-- ============================================================
-- MULTI-TENANCY MIGRATION  —  REVIEW COPY, NOT YET APPLIED
-- ============================================================
-- Converts the single-tenant schema to shared-DB/shared-schema
-- multi-tenancy. Existing data becomes tenant_id = 1 (Tech Tsadong).
--
-- ⚠️  DESTRUCTIVE on 501 clients / 763 loans / 4,949 transactions.
-- ⚠️  Take/confirm a backup first:
--        pg_dump -U aron loan_tracker > backup_before_multitenancy.sql
--     (backup_before_multitenancy_20260519.sql already exists, 2.0MB.)
-- ⚠️  Wrapped in a single transaction — a failure rolls the WHOLE
--     thing back, so the DB is never left half-migrated.
-- ⚠️  Idempotent (IF [NOT] EXISTS / WHERE NOT EXISTS guards) so it
--     can be safely re-run.
-- ⚠️  After this, the JWT payload changes — every existing session
--     (incl. admin@techtsadong.com) must log in again.
-- Apply with:  psql -U aron -d loan_tracker -v ON_ERROR_STOP=1 \
--                   -f migrations/add_multitenancy.sql
-- ============================================================

BEGIN;

-- ---- 1. tenants table -------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  tenant_code VARCHAR(20) UNIQUE NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(100),
  subdomain VARCHAR(50) UNIQUE NOT NULL,
  registration_number VARCHAR(100),
  tax_pin VARCHAR(20),
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) UNIQUE NOT NULL,
  contact_phone VARCHAR(20),
  physical_address TEXT,
  city VARCHAR(100),
  county VARCHAR(100),
  country VARCHAR(50) DEFAULT 'Kenya',
  plan VARCHAR(50) DEFAULT 'trial',
  status VARCHAR(20) DEFAULT 'active',
  trial_ends_at TIMESTAMP,
  subscription_starts_at TIMESTAMP,
  platform_fee_percentage DECIMAL(5, 2) DEFAULT 5.00,
  monthly_base_fee DECIMAL(10, 2) DEFAULT 0,
  max_clients INTEGER DEFAULT 100,
  max_loans INTEGER DEFAULT 100,
  max_users INTEGER DEFAULT 3,
  payment_paybill VARCHAR(20),
  payment_reference VARCHAR(50),
  total_interest_earned DECIMAL(15, 2) DEFAULT 0,
  total_platform_fees_paid DECIMAL(15, 2) DEFAULT 0,
  total_platform_fees_owed DECIMAL(15, 2) DEFAULT 0,
  last_billing_date DATE,
  logo_url TEXT,
  brand_color VARCHAR(7) DEFAULT '#4F46E5',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);

-- ---- 2. founding tenant (existing data) — idempotent -----------------
-- Inserted only if absent. Being the first row it takes id = 1, which
-- the backfill below depends on. 0% platform fee, 100-year trial.
INSERT INTO tenants (
  tenant_code, business_name, subdomain,
  contact_name, contact_email, contact_phone,
  plan, status, platform_fee_percentage,
  max_clients, max_loans, max_users, trial_ends_at
)
SELECT 'TECH001', 'Tech Tsadong Lenders', 'techtsadong',
       'Administrator', 'admin@techtsadong.com', '+254700000000',
       'enterprise', 'active', 0,
       100000, 100000, 100, NOW() + INTERVAL '100 years'
WHERE NOT EXISTS (
  SELECT 1 FROM tenants WHERE subdomain = 'techtsadong'
);

-- ---- 3. add tenant_id to every tenant-owned table --------------------
ALTER TABLE clients              ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE loans                ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE transactions         ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE payment_schedules    ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE users                ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE capital_pool         ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE capital_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE sms_logs             ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE email_logs           ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE audit_logs           ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE notifications        ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE company_settings     ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);
ALTER TABLE backups              ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id);

-- ---- 4. backfill all existing rows to the founding tenant ------------
UPDATE clients              SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE loans                SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE transactions         SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE payment_schedules    SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE users                SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE capital_pool         SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE capital_transactions SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE sms_logs             SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE email_logs           SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE audit_logs           SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE notifications        SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE company_settings     SET tenant_id = 1 WHERE tenant_id IS NULL;
UPDATE backups              SET tenant_id = 1 WHERE tenant_id IS NULL;

-- ---- 5. enforce NOT NULL on the core operational tables --------------
-- (Only the tables every row of which must belong to a tenant. Log /
-- backup / platform tables stay nullable so platform-level rows are
-- possible.)
ALTER TABLE clients           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE loans             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE transactions      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_schedules ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE capital_pool      ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_tenant      ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loans_tenant        ON loans(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant ON transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant        ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant        ON audit_logs(tenant_id);

-- ---- 6. re-scope unique keys by tenant -------------------------------
-- Verified before writing this migration: ZERO duplicate
-- client_code / phone_number / loan_code / transaction_code, so these
-- ADD CONSTRAINTs cannot fail on the 6,000+ existing rows.
-- NOTE: phone_number was previously only app-enforced (no DB UNIQUE);
-- this adds a real DB-level (tenant, phone) uniqueness — intended.
ALTER TABLE clients      DROP CONSTRAINT IF EXISTS clients_client_code_key;
ALTER TABLE clients      DROP CONSTRAINT IF EXISTS clients_phone_number_key;
ALTER TABLE loans        DROP CONSTRAINT IF EXISTS loans_loan_code_key;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_code_key;

ALTER TABLE clients      DROP CONSTRAINT IF EXISTS clients_tenant_code_unique;
ALTER TABLE clients      DROP CONSTRAINT IF EXISTS clients_tenant_phone_unique;
ALTER TABLE loans        DROP CONSTRAINT IF EXISTS loans_tenant_code_unique;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tenant_code_unique;

ALTER TABLE clients      ADD CONSTRAINT clients_tenant_code_unique  UNIQUE (tenant_id, client_code);
ALTER TABLE clients      ADD CONSTRAINT clients_tenant_phone_unique UNIQUE (tenant_id, phone_number);
ALTER TABLE loans        ADD CONSTRAINT loans_tenant_code_unique    UNIQUE (tenant_id, loan_code);
ALTER TABLE transactions ADD CONSTRAINT transactions_tenant_code_unique UNIQUE (tenant_id, transaction_code);

-- ---- 7. platform (super) admins --------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE;
UPDATE users SET is_platform_admin = TRUE WHERE email = 'admin@techtsadong.com';

COMMIT;

-- Post-apply sanity (run manually, not part of the transaction):
--   SELECT COUNT(*) FROM clients WHERE tenant_id IS NULL;        -- expect 0
--   SELECT COUNT(*) FROM loans   WHERE tenant_id <> 1;           -- expect 0
--   SELECT id, tenant_code, subdomain FROM tenants;              -- expect TECH001 id=1
--   SELECT email, is_platform_admin, tenant_id FROM users;
