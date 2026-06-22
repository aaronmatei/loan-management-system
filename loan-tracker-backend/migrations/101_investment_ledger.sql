-- Investment ledger: a chama updates the interest earned monthly and sometimes
-- withdraws. Track deposits / interest / withdrawals as transactions so income
-- (= total interest earned) is independent of withdrawals. Cached aggregates on
-- welfare_investments keep the dashboard read cheap.
BEGIN;

ALTER TABLE welfare_investments ADD COLUMN IF NOT EXISTS interest_earned numeric(15,2) NOT NULL DEFAULT 0;
ALTER TABLE welfare_investments ADD COLUMN IF NOT EXISTS withdrawn       numeric(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS welfare_investment_transactions (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  investment_id integer NOT NULL REFERENCES welfare_investments(id) ON DELETE CASCADE,
  type          varchar(20) NOT NULL,        -- deposit | interest | withdrawal
  amount        numeric(15,2) NOT NULL,
  balance_after numeric(15,2) NOT NULL,
  note          text,
  txn_date      date NOT NULL DEFAULT CURRENT_DATE,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_investment_txns ON welfare_investment_transactions(investment_id, id);

-- Backfill existing investments: the principal is a deposit, the gap between
-- current balance and amount invested is interest earned to date.
UPDATE welfare_investments SET interest_earned = round(current_balance - amount_invested, 2), withdrawn = 0;
INSERT INTO welfare_investment_transactions (tenant_id, investment_id, type, amount, balance_after, note, txn_date)
SELECT tenant_id, id, 'deposit', amount_invested, amount_invested, 'Initial investment', created_at::date
  FROM welfare_investments WHERE amount_invested > 0;
INSERT INTO welfare_investment_transactions (tenant_id, investment_id, type, amount, balance_after, note, txn_date)
SELECT tenant_id, id, 'interest', round(current_balance - amount_invested, 2), current_balance, 'Interest to date', created_at::date
  FROM welfare_investments WHERE round(current_balance - amount_invested, 2) <> 0;

COMMIT;
