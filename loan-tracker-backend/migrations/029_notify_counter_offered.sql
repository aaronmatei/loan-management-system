-- Adds the per-tenant customer SMS/Email toggles for the
-- counter-offer lifecycle event. The other 9 lifecycle toggles
-- were created in migration 013; this fills the gap so the
-- notificationDispatcher can gate counter-offer SMS/Email the
-- same way it gates all the others.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS notify_counter_offered_sms   BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_counter_offered_email BOOLEAN DEFAULT TRUE;

-- Backfill: anyone who joined before this migration ran inherits TRUE
-- so existing tenants don't silently lose the counter-offer message.
UPDATE tenants
   SET notify_counter_offered_sms   = COALESCE(notify_counter_offered_sms,   TRUE),
       notify_counter_offered_email = COALESCE(notify_counter_offered_email, TRUE);
