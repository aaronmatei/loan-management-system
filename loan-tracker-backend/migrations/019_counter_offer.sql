-- 019_counter_offer.sql
-- Counter-offer flow: during review a lender can reduce the principal to what
-- the client qualifies for and send it back; the client accepts or rejects.
--
-- Adds a new loans.status value 'counter_offered' (status is varchar(30) with
-- no CHECK constraint, so no enum change is needed) plus the columns below.
-- Idempotent — safe to re-run.

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS requested_amount   numeric(12,2),               -- original principal, snapshotted when an offer is made
  ADD COLUMN IF NOT EXISTS offered_amount     numeric(12,2),               -- the proposed (reduced) principal awaiting client response
  ADD COLUMN IF NOT EXISTS counter_offered_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS counter_offered_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS counter_offer_note text;
