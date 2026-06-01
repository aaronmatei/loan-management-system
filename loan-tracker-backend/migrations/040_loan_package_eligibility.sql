-- Loan package eligibility filters.
--
-- Three optional gates a package can impose on which clients may
-- apply. ALL columns default to "no restriction" so existing packages
-- read unchanged.
--
--   min_credit_score
--     Client's credit_score must be >= this value. Unrated clients
--     (NULL credit_score) FAIL any min_credit_score check — admins
--     who want first-loan products should leave this NULL.
--
--   allowed_client_types
--     Empty array = any type. Otherwise the client's client_type
--     must be in the list ('individual' / 'group' / 'business').
--     Stored as text[] so a single GIN index handles all lookups.
--
--   allowed_branch_ids
--     Empty array = any branch. Otherwise the client's branch_id
--     must be in the list. Used by lenders who run different
--     products at different branches (e.g. CBD-only Boda Boda).
--
-- All three are evaluated server-side at apply time (rejection is
-- 400), AND the portal packages list endpoint annotates each row
-- with an `eligibility` block so customers see badges + reasons up
-- front rather than hitting the wall on submit.

ALTER TABLE loan_packages
  ADD COLUMN IF NOT EXISTS min_credit_score INTEGER
    CHECK (min_credit_score IS NULL OR min_credit_score >= 0);

ALTER TABLE loan_packages
  ADD COLUMN IF NOT EXISTS allowed_client_types TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE loan_packages
  ADD COLUMN IF NOT EXISTS allowed_branch_ids INTEGER[] NOT NULL DEFAULT '{}';
