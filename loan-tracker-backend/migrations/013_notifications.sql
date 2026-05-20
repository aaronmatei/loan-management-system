-- 013: Per-tenant notification preferences + reminder cadence
--
-- Adds 18 boolean toggles to tenants (9 lifecycle events × {sms,email})
-- plus two cadence integers used by the daily cron job:
--   • reminder_days_before          — how many days before due to nudge
--   • overdue_reminder_frequency_days — re-nudge cadence after due date
--
-- All booleans default TRUE so existing tenants keep getting
-- notifications. Cadence defaults: remind 3 days before, re-nudge
-- every 3 days while overdue.
--
-- We deliberately don't create new sms_notifications/email_notifications
-- tables — the existing sms_logs / email_logs already carry the
-- message_type column the spec called event_type. They just need the
-- new event-type strings (application_under_review, payment_reminder,
-- payment_overdue) which are TEXT and don't require a schema change.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS notify_application_submitted_sms   BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_application_submitted_email BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_under_review_sms            BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_under_review_email          BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_approved_sms                BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_approved_email              BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_rejected_sms                BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_rejected_email              BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_disbursed_sms               BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_disbursed_email             BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_payment_sms                 BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_payment_email               BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_reminder_sms                BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_reminder_email              BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_overdue_sms                 BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_overdue_email               BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_completed_sms               BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_completed_email             BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reminder_days_before               INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS overdue_reminder_frequency_days    INTEGER DEFAULT 3;

-- Backfill: if a pre-existing row already had NULL (unlikely given
-- DEFAULT but cheap), set to the platform default.
UPDATE tenants
   SET notify_application_submitted_sms   = COALESCE(notify_application_submitted_sms,   TRUE),
       notify_application_submitted_email = COALESCE(notify_application_submitted_email, TRUE),
       notify_under_review_sms            = COALESCE(notify_under_review_sms,            TRUE),
       notify_under_review_email          = COALESCE(notify_under_review_email,          TRUE),
       notify_approved_sms                = COALESCE(notify_approved_sms,                TRUE),
       notify_approved_email              = COALESCE(notify_approved_email,              TRUE),
       notify_rejected_sms                = COALESCE(notify_rejected_sms,                TRUE),
       notify_rejected_email              = COALESCE(notify_rejected_email,              TRUE),
       notify_disbursed_sms               = COALESCE(notify_disbursed_sms,               TRUE),
       notify_disbursed_email             = COALESCE(notify_disbursed_email,             TRUE),
       notify_payment_sms                 = COALESCE(notify_payment_sms,                 TRUE),
       notify_payment_email               = COALESCE(notify_payment_email,               TRUE),
       notify_reminder_sms                = COALESCE(notify_reminder_sms,                TRUE),
       notify_reminder_email              = COALESCE(notify_reminder_email,              TRUE),
       notify_overdue_sms                 = COALESCE(notify_overdue_sms,                 TRUE),
       notify_overdue_email               = COALESCE(notify_overdue_email,               TRUE),
       notify_completed_sms               = COALESCE(notify_completed_sms,               TRUE),
       notify_completed_email             = COALESCE(notify_completed_email,             TRUE),
       reminder_days_before               = COALESCE(reminder_days_before,               3),
       overdue_reminder_frequency_days    = COALESCE(overdue_reminder_frequency_days,    3);

COMMIT;
