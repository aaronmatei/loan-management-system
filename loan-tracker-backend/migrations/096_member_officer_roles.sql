-- Welfare officer roles (chama chair / treasurer / secretary). A member is an
-- ordinary 'member' by default; officers are a member-level distinction (not a
-- staff role) and are elected via the decisions/voting feature. Partial unique
-- indexes enforce at most one active chair/treasurer/secretary per welfare.
BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'member';

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_chair_per_welfare
  ON members(welfare_id) WHERE role = 'chair' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_treasurer_per_welfare
  ON members(welfare_id) WHERE role = 'treasurer' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_secretary_per_welfare
  ON members(welfare_id) WHERE role = 'secretary' AND status = 'active';

COMMIT;
