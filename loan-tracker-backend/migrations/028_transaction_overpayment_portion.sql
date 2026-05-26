-- 028: Track the overpaid portion on each transaction
-- transactions.amount_paid records gross client payment (so receipts and the
-- ledger reflect what the client actually handed over). The slice of that
-- payment that exceeded the still-owed balance is overpayment — refunded to
-- the client, NOT collected by the lender. Recording it per-transaction
-- lets every "total collected" calculation cleanly exclude it.
--
--   "Total Paid"      = SUM(amount_paid)                                — gross
--   "Total Collected" = SUM(amount_paid - penalty_portion - overpayment) — net
--                     OR equivalently SUM(amount_paid - overpayment)    — net-of-refund
--
-- Backfill: derive overpayment_portion for historic rows from a running
-- balance — for each loan, walk transactions oldest-first, treat principal
-- as the post-penalty portion, and any excess over the still-owed balance
-- at the time is that transaction's overpaid amount.

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS overpayment_portion NUMERIC(12,2) DEFAULT 0;

UPDATE transactions SET overpayment_portion = 0 WHERE overpayment_portion IS NULL;

WITH ordered AS (
  SELECT
    t.id,
    l.total_amount_due                                          AS total_due,
    t.amount_paid - COALESCE(t.penalty_portion, 0)              AS principal_toward,
    COALESCE(
      SUM(t.amount_paid - COALESCE(t.penalty_portion, 0)) OVER (
        PARTITION BY t.loan_id
        ORDER BY t.payment_date, t.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    )                                                            AS running_before
  FROM transactions t
  JOIN loans l ON l.id = t.loan_id
  WHERE t.payment_status = 'completed'
),
calc AS (
  SELECT
    id,
    GREATEST(
      0,
      principal_toward - GREATEST(0, total_due - running_before)
    ) AS overpaid_this
  FROM ordered
)
UPDATE transactions t
   SET overpayment_portion = ROUND(calc.overpaid_this, 2)
  FROM calc
 WHERE t.id = calc.id;

COMMIT;
