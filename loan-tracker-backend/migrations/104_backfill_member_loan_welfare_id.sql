-- Loans issued via member-request approval / the "issue from pool" quick modal
-- were created without welfare_id (issueMemberLoan didn't set it), so the admin
-- Loans list — which filters by welfare_id — couldn't see them. Code is fixed
-- going forward; backfill the orphaned rows from the member's welfare.
BEGIN;
UPDATE member_loans l
   SET welfare_id = m.welfare_id
  FROM members m
 WHERE m.id = l.member_id
   AND l.welfare_id IS NULL
   AND m.welfare_id IS NOT NULL;
COMMIT;
