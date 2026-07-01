-- Platform plan catalog: named subscription tiers (name, monthly price,
-- features) a tenant can be assigned to for a future subscription model,
-- coexisting with the current per-tenant interest-fee billing. A tenant with
-- plan_id set is "on a plan" (counts toward MRR); null = on the fee model.
CREATE TABLE IF NOT EXISTS plans (
  id            serial PRIMARY KEY,
  name          varchar(60) NOT NULL,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  features      text[] NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id integer;

-- Seed the default tiers only when the catalog is empty (idempotent).
INSERT INTO plans (name, monthly_price, features, sort_order)
SELECT * FROM (VALUES
  ('Trial',      0::numeric,      ARRAY['30 days','Up to 50 loans','Community support'],                1),
  ('Starter',    18000::numeric,  ARRAY['Up to 1,000 loans','5 staff seats','SMS + M-Pesa'],            2),
  ('Growth',     45000::numeric,  ARRAY['Unlimited loans','15 seats','White-label portal','Priority support'], 3),
  ('Enterprise', 120000::numeric, ARRAY['Everything in Growth','Unlimited seats','Dedicated CSM','SLA + audit'], 4)
) v(name, monthly_price, features, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM plans);
