-- Wire Platform Billing invoices into the expenses ledger. Each
-- invoice gets a mirror row in expenses under the "Platform Billing"
-- category so tenants see their LoanFix bills alongside their other
-- operating expenses without manually duplicating them.
--
-- The link is invoice_id (FK + UNIQUE per tenant) so re-syncing is
-- idempotent and edits/deletes can ripple back through code.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS invoice_id INTEGER
    REFERENCES invoices(id) ON DELETE SET NULL;

-- One mirror row per (tenant, invoice) max.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_expenses_invoice
  ON expenses (tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Backfill: for every existing invoice that doesn't already have a
-- mirror row, create one under the tenant's "Platform Billing"
-- category. Description carries the invoice number + status for
-- traceability. recorded_by is NULL (system, not a human).
INSERT INTO expenses (
  tenant_id, category_id, amount, description, expense_date,
  payment_method, reference, is_recurring, recurrence_period,
  recorded_by, invoice_id
)
SELECT
  i.tenant_id,
  c.id,
  i.total_amount,
  'LoanFix invoice ' || i.invoice_number
    || ' · ' || COALESCE(i.status, 'pending'),
  COALESCE(i.issued_date, i.created_at)::date,
  NULL,
  i.invoice_number,
  true,
  'monthly',
  NULL,
  i.id
FROM invoices i
JOIN expense_categories c
  ON c.tenant_id = i.tenant_id
 AND c.name = 'Platform Billing'
WHERE COALESCE(i.total_amount, 0) > 0      -- skip zero-amount invoices
  AND NOT EXISTS (
    SELECT 1 FROM expenses e
     WHERE e.tenant_id = i.tenant_id AND e.invoice_id = i.id
  );
