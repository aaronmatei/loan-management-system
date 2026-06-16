-- 068: branch on loans (multi-branch support)
--
-- Pawnshops (and lenders) run multiple branches. A loan/pledge belongs to the
-- branch that booked it. Backfill from the borrower's branch. Nullable + ON
-- DELETE SET NULL so archiving/removing a branch never orphans a loan. Idempotent.

BEGIN;

ALTER TABLE loans ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES branches(id) ON DELETE SET NULL;

UPDATE loans l SET branch_id = c.branch_id
  FROM clients c
 WHERE l.client_id = c.id AND l.branch_id IS NULL AND c.branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loans_branch ON loans(branch_id);

COMMIT;
