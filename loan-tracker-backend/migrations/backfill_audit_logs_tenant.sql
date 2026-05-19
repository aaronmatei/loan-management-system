-- Backfill audit_logs.tenant_id for pre-multitenancy rows.
--
-- logAudit() did not populate tenant_id until the staff-route tenant
-- scoping work, so every historical audit row has tenant_id IS NULL.
-- All of those rows predate multi-tenancy, when only the original
-- lender (tenant 1 = techtsadong) existed, so they belong to tenant 1.
--
-- Without this backfill, scoping the audit read endpoints by
-- al.tenant_id would hide the entire historical audit trail from the
-- tenant-1 admin. Idempotent + transactional; safe to re-run.

BEGIN;

UPDATE audit_logs
SET tenant_id = 1
WHERE tenant_id IS NULL;

COMMIT;
