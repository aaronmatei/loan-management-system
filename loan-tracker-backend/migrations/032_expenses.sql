-- The expenses ledger. One row per recorded expense; tenants enter
-- these manually (no auto-creation in this phase). is_recurring is a
-- TAG, not an automation switch — it just lets the user identify
-- recurring outflows in the table and filter on them.

CREATE TABLE IF NOT EXISTS expenses (
  id                SERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id       INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  description       TEXT,
  expense_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method    VARCHAR(40),
  reference         VARCHAR(80),
  is_recurring      BOOLEAN NOT NULL DEFAULT false,
  recurrence_period VARCHAR(20), -- 'monthly' | 'weekly' | 'quarterly' | 'yearly' (null when one-off)
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON expenses (tenant_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON expenses (category_id);
