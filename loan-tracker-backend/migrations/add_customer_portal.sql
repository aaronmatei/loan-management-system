-- ============================================================
-- GLOBAL CUSTOMER PORTAL MIGRATION
-- Additive only. Requires the multitenancy migration (tenants /
-- clients.tenant_id) to already be applied — it is. Transactional
-- + idempotent (IF NOT EXISTS) so it is safe and re-runnable.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS platform_customers (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  id_number VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(10),
  password_hash VARCHAR(255),
  phone_verified BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  otp_code VARCHAR(6),
  otp_expires_at TIMESTAMP,
  otp_attempts INTEGER DEFAULT 0,
  otp_purpose VARCHAR(30),
  profile_photo_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  is_blacklisted_platform BOOLEAN DEFAULT FALSE,
  blacklist_reason TEXT,
  last_login TIMESTAMP,
  registration_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  registration_ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_customers_phone ON platform_customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_platform_customers_id ON platform_customers(id_number);
CREATE INDEX IF NOT EXISTS idx_platform_customers_email ON platform_customers(email);

CREATE TABLE IF NOT EXISTS customer_tenant_links (
  id SERIAL PRIMARY KEY,
  platform_customer_id INTEGER NOT NULL REFERENCES platform_customers(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active',
  linked_at TIMESTAMP DEFAULT NOW(),
  last_activity_at TIMESTAMP,
  UNIQUE (platform_customer_id, tenant_id),
  UNIQUE (platform_customer_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_links_customer ON customer_tenant_links(platform_customer_id);
CREATE INDEX IF NOT EXISTS idx_links_tenant ON customer_tenant_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_links_client ON customer_tenant_links(client_id);

CREATE TABLE IF NOT EXISTS customer_activities (
  id SERIAL PRIMARY KEY,
  platform_customer_id INTEGER REFERENCES platform_customers(id),
  tenant_id INTEGER REFERENCES tenants(id),
  client_id INTEGER REFERENCES clients(id),
  activity_type VARCHAR(50) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_activities_customer ON customer_activities(platform_customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_activities_tenant ON customer_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_activities_date ON customer_activities(created_at DESC);

ALTER TABLE loans ADD COLUMN IF NOT EXISTS submitted_by_customer BOOLEAN DEFAULT FALSE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS platform_customer_id INTEGER REFERENCES platform_customers(id);

CREATE TABLE IF NOT EXISTS customer_invitations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  invitation_code VARCHAR(50) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  email VARCHAR(255),
  sent_via VARCHAR(20),
  status VARCHAR(20) DEFAULT 'pending',
  invited_by INTEGER REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON customer_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON customer_invitations(invitation_code);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS customer_portal_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_self_signup BOOLEAN DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_online_applications BOOLEAN DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS otp_count_this_month INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS otp_quota_per_month INTEGER DEFAULT 100;

COMMIT;
