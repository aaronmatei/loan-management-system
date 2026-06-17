-- 076: payment reversal (void) metadata
--
-- A completed payment can be reversed (e.g. a member meant 3,700 but paid
-- 37,000). We SOFT-void it — payment_status='voided' so the financial record is
-- never destroyed; every total already filters payment_status='completed', so a
-- voided row drops out of the books automatically. These columns capture who/
-- when/why for the audit trail and the "Reversed" badge. Idempotent.

BEGIN;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_at   timestamp;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_by   integer;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS void_reason text;

COMMIT;
