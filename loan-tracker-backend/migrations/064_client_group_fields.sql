-- 064: Group/business detail fields on clients
--
-- A "group" (chama/savings group) is modelled as a client with
-- client_type='group' (business_name = the group's name). These optional
-- columns capture the extra group details the client form now collects:
-- registration number, meeting cadence, and member count. registration_no
-- also applies to client_type='business'. Idempotent.

BEGIN;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS registration_no   VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meeting_frequency VARCHAR(20);  -- weekly | biweekly | monthly | quarterly
ALTER TABLE clients ADD COLUMN IF NOT EXISTS member_count      INTEGER;

COMMIT;
