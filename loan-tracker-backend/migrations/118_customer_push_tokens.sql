-- Expo push tokens for the LenderFest mobile app. One row per device; a
-- customer can have several. Keyed by platform_customer_id (the cross-tenant
-- identity), so a single token receives pushes for every lender/welfare the
-- customer belongs to. Token is UNIQUE so re-registering the same device
-- upserts (and can move the device to a different account if reinstalled).
CREATE TABLE IF NOT EXISTS customer_push_tokens (
  id                   SERIAL PRIMARY KEY,
  platform_customer_id INTEGER NOT NULL REFERENCES platform_customers(id) ON DELETE CASCADE,
  token                TEXT    NOT NULL UNIQUE,
  platform             TEXT,           -- 'ios' | 'android' | 'web'
  device_name          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_push_tokens_customer
  ON customer_push_tokens(platform_customer_id);
