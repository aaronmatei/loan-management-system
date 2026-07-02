-- Extend support ticketing beyond tenant->platform to a second channel:
-- customer->tenant (a borrower raising an issue to their lender, or a welfare
-- member to their welfare admin — both are portal customers scoped to a tenant).
--   channel = 'platform' : tenant staff -> platform admin (the original flow)
--   channel = 'tenant'   : portal customer -> that tenant's staff (new)
-- platform_customer_id identifies the borrower/member on a 'tenant'-channel
-- ticket. Message author_type is free text — the new value is 'customer'.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS channel varchar(12) NOT NULL DEFAULT 'platform';
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS platform_customer_id integer;

CREATE INDEX IF NOT EXISTS idx_support_tickets_channel
  ON support_tickets(tenant_id, channel);
CREATE INDEX IF NOT EXISTS idx_support_tickets_customer
  ON support_tickets(platform_customer_id);
