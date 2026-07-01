-- Platform-wide settings (key/value). Kept deliberately small — only settings
-- that are actually wired into behaviour live here. Today: the billing defaults
-- a new lender tenant is created with (read by the signup flow in tenants.js).
CREATE TABLE IF NOT EXISTS platform_settings (
  key        varchar(60) PRIMARY KEY,
  value      text,
  updated_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value)
SELECT * FROM (VALUES
  ('default_fee_percent', '5'),
  ('default_base_fee',    '0')
) v(key, value)
ON CONFLICT (key) DO NOTHING;
