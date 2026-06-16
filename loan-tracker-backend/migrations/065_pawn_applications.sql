-- 065: Pawn applications (customer-initiated, online)
--
-- A pawn customer can request a loan against an item online BEFORE bringing it
-- in. Staff review the request, optionally make an offer, then convert it into a
-- real pawn loan when the item is presented (loan_id links the created loan).
-- Lifecycle: pending → approved | rejected | withdrawn → converted. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS pawn_applications (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  client_id        integer NOT NULL,          -- the customer's client at this pawnshop
  item_description text NOT NULL,
  item_category    varchar(60),
  condition        varchar(40),
  serial_number    varchar(120),
  estimated_value  numeric(12,2),             -- customer's own estimate
  requested_amount numeric(12,2),             -- how much they're asking for
  photos           jsonb,
  status           varchar(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|withdrawn|converted
  offered_amount   numeric(12,2),             -- staff's offer at approval
  review_notes     text,
  reviewed_by      integer,
  reviewed_at      timestamp,
  loan_id          integer,                   -- the pawn loan created on conversion
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pawn_apps_tenant ON pawn_applications(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pawn_apps_client ON pawn_applications(client_id);

COMMIT;
