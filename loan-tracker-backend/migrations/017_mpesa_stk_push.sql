-- 017_mpesa_stk_push.sql
--
-- M-Pesa STK Push (Lipa Na M-Pesa Online via Safaricom Daraja).
-- One-tap repayment for customers and one-tap invoice settlement for
-- tenants. We build in SANDBOX first using the platform's Daraja
-- credentials (env vars); the per-tenant columns below let a tenant
-- supply their OWN approved production shortcode later with no further
-- schema change.
--
-- Renumbered from the design's "015" — 015_demo_mode.sql and
-- 016_referral_program.sql already exist.

BEGIN;

-- ============================================================
-- M-PESA TRANSACTIONS (STK Push request + callback tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,

  -- What is being paid for
  purpose VARCHAR(30) NOT NULL,        -- 'loan_repayment' | 'tenant_invoice'
  loan_id INTEGER REFERENCES loans(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  customer_id INTEGER,                 -- portal customer who initiated (nullable)
  initiated_by_user_id INTEGER REFERENCES users(id),

  -- Request details
  phone_number VARCHAR(20) NOT NULL,   -- normalized 2547XXXXXXXX
  amount DECIMAL(15,2) NOT NULL,
  account_reference VARCHAR(64),       -- shown on customer's statement
  transaction_desc VARCHAR(128),

  -- Daraja identifiers
  merchant_request_id VARCHAR(64),
  checkout_request_id VARCHAR(64) UNIQUE,   -- the key we match callbacks on

  -- Result
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- pending | success | failed | cancelled | timeout
  result_code INTEGER,                 -- 0 = success
  result_desc TEXT,
  mpesa_receipt_number VARCHAR(32),    -- e.g. "QABC123XYZ"
  transaction_date TIMESTAMP,
  paid_phone_number VARCHAR(20),

  -- Raw payloads for audit/debugging
  request_payload JSONB,
  callback_payload JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mpesa_tx_checkout ON mpesa_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_tx_status   ON mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_tx_loan     ON mpesa_transactions(loan_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_tx_invoice  ON mpesa_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_tx_tenant   ON mpesa_transactions(tenant_id);

-- ============================================================
-- PER-TENANT M-PESA CONFIG (future production per-tenant shortcodes).
-- For now everything uses the platform sandbox env vars; these columns
-- let a tenant supply approved credentials later without a migration.
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_shortcode VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_passkey VARCHAR(128);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_consumer_key VARCHAR(128);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_consumer_secret VARCHAR(128);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mpesa_use_platform_credentials BOOLEAN DEFAULT TRUE;

COMMIT;

-- Verify
SELECT
  (SELECT COUNT(*) FROM mpesa_transactions) AS mpesa_tx_count,
  (SELECT COUNT(*) FROM tenants WHERE mpesa_enabled = true) AS mpesa_enabled_tenants;
