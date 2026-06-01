-- Credit score column on clients — populated lazily.
--
-- The actual scoring formula lives in src/utils/creditScore.js and runs
-- whenever GET /clients/:id/credit-profile is called. That endpoint
-- now writes the result back to this column so the Clients list can
-- show the score without re-running the (expensive, multi-table)
-- aggregate per row. NULL = "not computed yet" — the list renders it
-- as "—" until staff view the profile (which refreshes it).
--
-- No CHECK constraint: the calculator already clamps to 0..100 and we
-- want flexibility if the scale changes later.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS credit_score INTEGER;
