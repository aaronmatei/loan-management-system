-- 074: let a welfare MEMBER own a portal login
--
-- A person in the portal is one platform_customers row. Borrower links carry a
-- per-tenant client_id; a welfare member has no client row, so a member link
-- carries a member_id instead. Relax client_id to NULL and add member_id, with
-- a CHECK that every link is exactly one of the two. Idempotent.

BEGIN;

ALTER TABLE customer_tenant_links ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE customer_tenant_links
  ADD COLUMN IF NOT EXISTS member_id integer REFERENCES members(id) ON DELETE SET NULL;

-- One welfare member maps to at most one portal customer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctl_member
  ON customer_tenant_links(member_id) WHERE member_id IS NOT NULL;

-- A link is either a borrower (client_id) or a member (member_id), never neither.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ctl_client_or_member'
  ) THEN
    ALTER TABLE customer_tenant_links
      ADD CONSTRAINT ctl_client_or_member
      CHECK (client_id IS NOT NULL OR member_id IS NOT NULL);
  END IF;
END $$;

COMMIT;
