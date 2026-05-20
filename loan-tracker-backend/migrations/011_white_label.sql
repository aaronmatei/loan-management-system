-- White-label tiers + per-tenant branding/customization fields.
-- Additive, nullable, idempotent. (010 is taken by the onboarding
-- migration — this is 011.)

BEGIN;

-- Tier: 'basic' | 'pro' | 'enterprise'
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label_tier        VARCHAR(20) DEFAULT 'basic';

-- Pro tier customizations
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hide_platform_branding  BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url             TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_sender_name       VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sms_sender_id           VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_signature         TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS report_header_text      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS report_footer_text      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS support_email           VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS support_phone           VARCHAR(20);

-- Enterprise tier customizations
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain           VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_email_domain     VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS terms_url               TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_url             TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_portal_title     VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_portal_tagline   VARCHAR(200);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_login_image_url  TEXT;

-- Partial index for the custom domain lookup (only non-null rows).
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain
  ON tenants(custom_domain) WHERE custom_domain IS NOT NULL;

COMMIT;

SELECT id, business_name, subdomain, white_label_tier, hide_platform_branding
FROM tenants ORDER BY id;
