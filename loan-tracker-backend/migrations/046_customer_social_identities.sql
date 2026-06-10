-- 046: Social login for borrowers (Google / Apple / Facebook)
--
-- A borrower's platform_customers account stays phone+ID-first (lending needs
-- both). Social login is a convenience layer: one row per linked provider.
-- A single account can link several providers; (provider, provider_user_id)
-- is globally unique. password_hash is already nullable, so social-only
-- accounts work.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS customer_social_identities (
  id               SERIAL PRIMARY KEY,
  customer_id      INTEGER NOT NULL
                     REFERENCES platform_customers(id) ON DELETE CASCADE,
  provider         VARCHAR(20) NOT NULL,   -- google | apple | facebook
  provider_user_id VARCHAR(255) NOT NULL,  -- the provider's stable subject id
  email            VARCHAR(255),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_identities_customer
  ON customer_social_identities(customer_id);

COMMIT;
