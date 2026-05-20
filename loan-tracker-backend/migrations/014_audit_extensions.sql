-- 014: Extend audit_logs schema (existing table from add_audit_logs.sql +
-- add_multitenancy.sql gets new columns the new code expects).
--
-- New columns are all NULLABLE so the existing 43 call sites keep
-- working unchanged. action_category is derived from the existing
-- `action` field at backfill time (everything before the first dot,
-- or 'system' for actions without a category prefix).
--
-- severity defaults to 'info' going forward — the column allows NULL
-- for the legacy rows so we don't have to backfill every one of them.

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS action_category    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS entity_label       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS severity           VARCHAR(20) DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS status             VARCHAR(20) DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS user_role          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_platform_admin  BOOLEAN     DEFAULT FALSE;

-- Backfill action_category for existing rows from the existing action
-- field. Patterns observed in the 43 call sites:
--   'login', 'login_failed', 'logout'                       → 'auth'
--   'application_*', 'status_changed' (on loan entity), ... → 'loan'
--   'payment_recorded', 'refund_processed'                  → 'payment'
--   'created'/'updated'/'deleted' on entity_type            → from entity_type
--   anything else                                            → 'system'
UPDATE audit_logs
   SET action_category =
     CASE
       WHEN action ILIKE 'login%' OR action = 'logout'           THEN 'auth'
       WHEN action ILIKE 'application%'                          THEN 'application'
       WHEN action ILIKE 'payment%' OR action ILIKE 'refund%'    THEN 'payment'
       WHEN action ILIKE 'ledger%' OR action ILIKE 'capital%'    THEN 'capital'
       WHEN action ILIKE 'backup%'                               THEN 'backup'
       WHEN action ILIKE 'email%' OR action ILIKE 'sms%'         THEN 'messaging'
       WHEN entity_type IN ('client','loan','payment','user','tenant')
            THEN entity_type
       ELSE 'system'
     END
 WHERE action_category IS NULL;

-- entity_label backfill: prefer entity_code if set, otherwise leave NULL.
UPDATE audit_logs
   SET entity_label = entity_code
 WHERE entity_label IS NULL AND entity_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_logs(severity);

COMMIT;
