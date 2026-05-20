-- Billing system: invoices, invoice payments, billing activity log
-- + per-tenant billing settings. Transactional + idempotent
-- (IF NOT EXISTS everywhere); safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,

  billing_month INTEGER NOT NULL,
  billing_year  INTEGER NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,

  interest_earned DECIMAL(15,2) NOT NULL DEFAULT 0,
  fee_percentage  DECIMAL(5,2)  NOT NULL DEFAULT 5.00,
  amount_due      DECIMAL(15,2) NOT NULL,

  base_fee     DECIMAL(15,2) DEFAULT 0,
  addon_fees   DECIMAL(15,2) DEFAULT 0,
  discount     DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL,

  -- pending | paid | overdue | cancelled | partial
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  amount_paid      DECIMAL(15,2) DEFAULT 0,
  paid_at          TIMESTAMP,
  payment_method   VARCHAR(30),
  payment_reference VARCHAR(100),
  paid_by_user_id  INTEGER REFERENCES users(id),

  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date    DATE NOT NULL,

  notes          TEXT,
  internal_notes TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(tenant_id, billing_month, billing_year)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant   ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount     DECIMAL(15,2) NOT NULL,
  payment_method    VARCHAR(30) NOT NULL,
  payment_reference VARCHAR(100),
  payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by_user_id INTEGER REFERENCES users(id),
  notes      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_enabled            BOOLEAN DEFAULT TRUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_fee_percentage     DECIMAL(5,2) DEFAULT 5.00;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_base_fee           DECIMAL(15,2) DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_day_of_month       INTEGER DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_grace_period_days  INTEGER DEFAULT 14;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_suspend_after_days INTEGER DEFAULT 30;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_invoice_date          DATE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_contact_email      VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_contact_phone      VARCHAR(20);

-- Founding tenant (Tech Tsadong) is the SaaS owner — never billed.
UPDATE tenants
   SET billing_fee_percentage = 0,
       billing_enabled = FALSE
 WHERE id = 1;

CREATE TABLE IF NOT EXISTS billing_activities (
  id SERIAL PRIMARY KEY,
  tenant_id  INTEGER REFERENCES tenants(id),
  invoice_id INTEGER REFERENCES invoices(id),
  activity_type VARCHAR(50) NOT NULL,
  details JSONB,
  performed_by_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_activities_tenant ON billing_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_activities_date   ON billing_activities(created_at DESC);

COMMIT;

-- Verify (outside the transaction; the migration itself is committed).
SELECT
  (SELECT COUNT(*) FROM invoices) AS invoices,
  (SELECT COUNT(*) FROM tenants WHERE billing_enabled = true) AS billable_tenants,
  (SELECT COUNT(*) FROM tenants WHERE billing_enabled = false) AS unbilled_tenants;
