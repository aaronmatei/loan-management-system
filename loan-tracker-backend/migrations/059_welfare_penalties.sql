-- 059: Welfare/chama settings + configurable penalty engine
--
-- Each chama (a tenant of kind='welfare') configures its own penalty rules:
-- a fixed fee, a percentage, or a per-day amount/percentage, per trigger
-- (late contribution, late loan, absent/late attendance, missed meeting).
-- Assessments are the payable ledger of penalties applied to members; paying
-- one posts into the welfare pool as income (member_pool_transactions type
-- 'penalty'). Idempotent.

BEGIN;

-- Per-chama welfare configuration (one row per welfare tenant).
CREATE TABLE IF NOT EXISTS welfare_settings (
  tenant_id                INTEGER PRIMARY KEY,
  contribution_frequency   VARCHAR(20) NOT NULL DEFAULT 'monthly', -- weekly | biweekly | monthly
  contribution_amount      NUMERIC,                  -- default expected per member per cycle
  contribution_grace_days  INTEGER NOT NULL DEFAULT 0,
  attendance_grace_minutes INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS penalty_rules (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL,
  trigger    VARCHAR(30) NOT NULL,  -- contribution_late | loan_late | attendance_absent | attendance_late | meeting_missed
  calc_type  VARCHAR(20) NOT NULL,  -- fixed | percentage | daily_fixed | daily_percentage
  amount     NUMERIC,               -- for fixed / daily_fixed (KES)
  rate       NUMERIC,               -- for percentage / daily_percentage (%)
  cap        NUMERIC,               -- optional maximum per assessment
  active     BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS penalty_assessments (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
  rule_id     INTEGER,               -- the rule applied (nullable for ad-hoc)
  trigger     VARCHAR(30) NOT NULL,
  source_type VARCHAR(30),           -- contribution_schedule | member_loan | meeting | manual
  source_id   INTEGER,
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'outstanding', -- outstanding | paid | waived
  description TEXT,
  assessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_penalty_rules_tenant ON penalty_rules(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_penalty_assessments_tenant ON penalty_assessments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_penalty_assessments_member ON penalty_assessments(member_id);

COMMIT;
