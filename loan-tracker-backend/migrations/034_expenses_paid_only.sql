-- Refactor the Platform Billing auto-sync flow:
--   * The "Platform Billing" category is hidden from the user-facing
--     Record-expense dropdown (is_system flag) since auto-imported
--     rows shouldn't be hand-created.
--   * Expense rows now mirror PAYMENTS made against an invoice, not
--     the invoice itself — amount = amount_paid, not total_amount.
--   * Mirror rows for unpaid invoices are cleared out; paid/partial
--     ones are realigned to amount_paid.

ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

UPDATE expense_categories
   SET is_system = true, updated_at = NOW()
 WHERE name = 'Platform Billing';

-- Drop mirror rows where the underlying invoice has nothing paid yet
-- (those were created under the old "auto-sync on generate" flow).
DELETE FROM expenses e
 USING invoices i
 WHERE e.invoice_id = i.id
   AND COALESCE(i.amount_paid, 0) <= 0;

-- Re-align rows for invoices that have payments: amount becomes
-- amount_paid, date becomes the first payment date when we can find
-- it (falls back to issued_date if no invoice_payments rows are
-- recorded), description reflects the current invoice status.
UPDATE expenses e
   SET amount       = i.amount_paid,
       description  = 'LoanFix invoice ' || i.invoice_number
                      || ' · ' || COALESCE(i.status, 'pending')
                      || ' · paid ' ||
                      to_char(COALESCE(p.first_paid, i.issued_date), 'DD Mon YYYY'),
       expense_date = COALESCE(p.first_paid::date, i.issued_date::date),
       updated_at   = NOW()
  FROM invoices i
  LEFT JOIN LATERAL (
    SELECT MIN(payment_date) AS first_paid
      FROM invoice_payments
     WHERE invoice_id = i.id
  ) p ON true
 WHERE e.invoice_id = i.id
   AND COALESCE(i.amount_paid, 0) > 0;
