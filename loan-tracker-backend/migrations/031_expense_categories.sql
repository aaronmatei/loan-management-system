-- Per-tenant expense categories. Seeds 10 defaults for every existing
-- tenant so the Expenses page is immediately usable; tenants can disable
-- defaults (is_active = false) or add their own.
--
-- Categories cover the common operating-expense buckets a small lender
-- runs into: salaries, communication, transport, transaction fees, etc.

CREATE TABLE IF NOT EXISTS expense_categories (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL,
  icon         VARCHAR(40),
  is_default   BOOLEAN NOT NULL DEFAULT false,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant
  ON expense_categories (tenant_id, is_active);

-- Seed defaults for every existing tenant.
INSERT INTO expense_categories (tenant_id, name, icon, is_default, sort_order)
SELECT t.id, c.name, c.icon, true, c.sort_order
  FROM tenants t
 CROSS JOIN (
   VALUES
     ('Salaries & Wages',                'users',       10),
     ('Communication (Airtime, SMS, Internet)', 'phone', 20),
     ('Office Supplies & Equipment',     'package',     30),
     ('Transport & Travel',              'car',         40),
     ('Printing & Stationery',           'printer',     50),
     ('Transaction Charges',             'credit-card', 60),
     ('Default Follow-up Costs',         'alert-triangle', 70),
     ('Rent & Utilities',                'home',        80),
     ('Marketing & Promotion',           'megaphone',   90),
     ('Platform Billing',                'receipt',     95),
     ('Other',                           'more-horizontal', 100)
 ) AS c(name, icon, sort_order)
 ON CONFLICT (tenant_id, name) DO NOTHING;
