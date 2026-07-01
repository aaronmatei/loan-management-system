-- Default late-payment fee is now 0 (no fee) instead of the old hardcoded 500.
-- Lenders opt in via Loan Settings. Every existing tenant currently carries the
-- untouched 500 default (none deliberately chose it), so reset those to 0 too.
ALTER TABLE tenants ALTER COLUMN late_payment_fee SET DEFAULT 0;
UPDATE tenants SET late_payment_fee = 0 WHERE late_payment_fee = 500;
