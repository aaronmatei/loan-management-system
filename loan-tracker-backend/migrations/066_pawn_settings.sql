-- 066: Per-pawnshop settings (valuation / interest / auction rules)
--
-- One row per pawnbroker tenant. Drives defaults for new pledges (LTV, monthly
-- fee, term) and the auction queue (how long past maturity before an item is
-- auction-eligible). One row per tenant. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS pawn_settings (
  tenant_id                 integer PRIMARY KEY,
  default_ltv_percent       numeric(5,2)  NOT NULL DEFAULT 50,
  default_monthly_fee_percent numeric(6,3) NOT NULL DEFAULT 10,
  default_duration_months   integer       NOT NULL DEFAULT 1,
  grace_days                integer       NOT NULL DEFAULT 0,   -- after maturity before "overdue"
  auction_notice_days       integer       NOT NULL DEFAULT 14,  -- overdue beyond this → auction-eligible
  created_at                timestamp NOT NULL DEFAULT NOW(),
  updated_at                timestamp NOT NULL DEFAULT NOW()
);

COMMIT;
