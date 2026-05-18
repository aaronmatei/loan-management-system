-- ============================================================
-- Loan agreement support. Safe to run multiple times.
-- ============================================================

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS agreement_signed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agreement_signed_date DATE,
  ADD COLUMN IF NOT EXISTS agreement_witnessed_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS guarantor_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS guarantor_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS guarantor_id_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS collateral_description TEXT,
  ADD COLUMN IF NOT EXISTS late_payment_fee NUMERIC(10, 2) DEFAULT 500,
  ADD COLUMN IF NOT EXISTS penalty_rate NUMERIC(5, 2) DEFAULT 5.00;

CREATE TABLE IF NOT EXISTS company_settings (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL DEFAULT 'Your Company',
  company_address TEXT,
  company_phone VARCHAR(20),
  company_email VARCHAR(100),
  company_website VARCHAR(100),
  company_logo_url TEXT,
  business_registration_number VARCHAR(50),
  tax_pin VARCHAR(20),
  agreement_terms TEXT,
  bank_name VARCHAR(100),
  bank_account_number VARCHAR(50),
  bank_branch VARCHAR(100),
  mpesa_paybill VARCHAR(20),
  mpesa_till_number VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed a single default row only if the table is empty (idempotent)
INSERT INTO company_settings (
  company_name, company_address, company_phone, company_email,
  business_registration_number, agreement_terms
)
SELECT
  'Your Company Name',
  'P.O Box 12345-00100, Nairobi, Kenya',
  '+254700000000',
  'info@yourcompany.com',
  'BN/2025/12345',
  'Default terms - update via Settings page'
WHERE NOT EXISTS (SELECT 1 FROM company_settings);
