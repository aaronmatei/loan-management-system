-- 025: Make sure sms_logs / email_logs always have tenant_id
-- Several writers (paymentService, payments.js refunds, loans.js approve+
-- disburse) historically inserted without tenant_id, so per-tenant
-- communication-cost reporting would undercount. Two-part fix:
--
--   1. Backfill historical rows from their linked loan or client.
--   2. A BEFORE INSERT trigger fills tenant_id from loan_id (preferred)
--      then client_id whenever it's NULL — so any future writer that
--      forgets stays correct automatically.
--
-- Platform-level emails (daily summary, invoice run summary) intentionally
-- have no loan/client link, so tenant_id stays NULL — those aren't a
-- tenant's expense.

BEGIN;

UPDATE sms_logs s
   SET tenant_id = COALESCE(
         (SELECT tenant_id FROM loans   WHERE id = s.loan_id),
         (SELECT tenant_id FROM clients WHERE id = s.client_id)
       )
 WHERE s.tenant_id IS NULL;

UPDATE email_logs e
   SET tenant_id = COALESCE(
         (SELECT tenant_id FROM loans   WHERE id = e.loan_id),
         (SELECT tenant_id FROM clients WHERE id = e.client_id)
       )
 WHERE e.tenant_id IS NULL;

CREATE OR REPLACE FUNCTION public.fill_log_tenant_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    IF NEW.loan_id IS NOT NULL THEN
      SELECT l.tenant_id INTO NEW.tenant_id FROM public.loans l WHERE l.id = NEW.loan_id;
    END IF;
    IF NEW.tenant_id IS NULL AND NEW.client_id IS NOT NULL THEN
      SELECT c.tenant_id INTO NEW.tenant_id FROM public.clients c WHERE c.id = NEW.client_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sms_logs_fill_tenant ON public.sms_logs;
CREATE TRIGGER sms_logs_fill_tenant
  BEFORE INSERT ON public.sms_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_log_tenant_id();

DROP TRIGGER IF EXISTS email_logs_fill_tenant ON public.email_logs;
CREATE TRIGGER email_logs_fill_tenant
  BEFORE INSERT ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_log_tenant_id();

COMMIT;
