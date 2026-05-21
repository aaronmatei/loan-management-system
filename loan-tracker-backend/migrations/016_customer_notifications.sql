-- 016: Customer (portal) notifications
--
-- A server-side notification feed for portal customers, replacing the
-- client-derived feed. Rows are generated idempotently from source data
-- (payments, application decisions, disbursals, overdue + due-soon schedules)
-- via a per-customer dedupe_key, so the generator can run repeatedly (on
-- fetch and on a daily cron) without creating duplicates.
--
-- is_read drives the unread badge; is_dismissed hides an item (server-side,
-- so it stays dismissed across devices).
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_notifications (
  id                   SERIAL PRIMARY KEY,
  platform_customer_id INTEGER NOT NULL REFERENCES platform_customers(id) ON DELETE CASCADE,
  tenant_id            INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id              INTEGER REFERENCES loans(id) ON DELETE CASCADE,
  type                 VARCHAR(30) NOT NULL,
  amount               NUMERIC(12,2),
  dedupe_key           VARCHAR(120) NOT NULL,
  is_read              BOOLEAN DEFAULT FALSE,
  is_dismissed         BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMP DEFAULT NOW(),
  UNIQUE (platform_customer_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_cust_notif_customer
  ON customer_notifications(platform_customer_id, created_at DESC);

COMMIT;
