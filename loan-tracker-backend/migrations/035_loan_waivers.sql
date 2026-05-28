-- Loan waivers: lender-initiated forgiveness of part of what the
-- borrower owes. No cash moves; the outstanding balance just drops
-- and the waived amount is a non-cash loss for the lender.
--
-- Workflow:
--   Admin records waiver        → status='approved' instantly
--   Manager/Officer requests    → status='pending', awaits admin
--   Admin approves              → status='approved', allocation runs
--   Admin rejects               → status='rejected'
--   Admin reverses (later)      → status='reversed', allocation undone

CREATE TABLE IF NOT EXISTS loan_waivers (
  id              SERIAL PRIMARY KEY,
  loan_id         INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Intent metadata. allocation is computed at approval time and
  -- still uses the penalty-first → amount_due rule regardless of
  -- the chosen type; type is only used for reporting buckets.
  type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('penalty', 'interest', 'principal', 'mixed')),
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reason          TEXT NOT NULL,
  notes           TEXT,

  -- Workflow state.
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'reversed')),

  -- Request leg.
  requested_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at    TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Approval leg (admin signs off; same row when admin self-records).
  approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMP,

  -- Rejection leg.
  rejected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_at     TIMESTAMP,
  rejection_reason TEXT,

  -- Reversal leg.
  reversed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversed_at     TIMESTAMP,
  reversal_reason TEXT,

  -- Snapshot of what was applied so reversal is exact:
  -- {
  --   "penalty_total":   number,
  --   "amount_total":    number,
  --   "schedules": [
  --     { "schedule_id": 1, "penalty_paid_delta": 100, "amount_paid_delta": 200,
  --       "set_status_waived": true }
  --   ]
  -- }
  allocation      JSONB,

  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waivers_loan
  ON loan_waivers (loan_id);
CREATE INDEX IF NOT EXISTS idx_waivers_pending
  ON loan_waivers (tenant_id, status)
  WHERE status = 'pending';

-- Capital pool: track total waived (non-cash loss) so the dashboard
-- and reports can surface it without polluting collected / interest
-- earned.
ALTER TABLE capital_pool
  ADD COLUMN IF NOT EXISTS total_waived NUMERIC(15,2) NOT NULL DEFAULT 0;

-- Loans: mark how a completed loan was closed so reports can
-- distinguish paid-off from written-off.
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS completed_via VARCHAR(20)
    CHECK (completed_via IN ('paid', 'waived'));
