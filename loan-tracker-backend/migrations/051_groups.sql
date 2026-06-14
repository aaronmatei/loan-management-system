-- 051: Group / chama lending (Model A — joint-liability group of member loans)
--
-- A group is an organizing + guarantee wrapper. Each MEMBER is an ordinary
-- client who takes their own loan (loan_type='group', loans.group_id set); the
-- group co-guarantees all member loans. There is no group-level capital pool —
-- member loans disburse/collect through the normal flow, and the group "balance"
-- is a computed rollup of its member loans.
--
-- Officials (chair/treasurer/secretary) are a role on group_members, so no
-- circular FK back from groups. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS groups (
  id                SERIAL PRIMARY KEY,
  tenant_id         INTEGER NOT NULL,
  group_code        VARCHAR(30),
  name              VARCHAR(120) NOT NULL,
  branch_id         INTEGER,
  registration_no   VARCHAR(60),
  meeting_frequency VARCHAR(20),                       -- weekly | biweekly | monthly | ...
  status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | dormant | closed
  notes             TEXT,
  created_by        INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'member',  -- member | chairperson | treasurer | secretary
  status      VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | exited
  joined_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, client_id)
);

-- Member loans point back at their group (nullable; only group loans set it).
ALTER TABLE loans ADD COLUMN IF NOT EXISTS group_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_groups_tenant        ON groups(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_group  ON group_members(group_id, status);
CREATE INDEX IF NOT EXISTS idx_group_members_client ON group_members(client_id);
CREATE INDEX IF NOT EXISTS idx_loans_group          ON loans(group_id);

COMMIT;
