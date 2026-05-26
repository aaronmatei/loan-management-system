-- 026: Recompute capital_pool totals from authoritative loan data
-- The disbursement accounting changed (loans.js): we now record the FULL
-- principal in total_disbursed and the processing fee in
-- total_interest_earned, so outstanding_principal = disbursed - collected
-- no longer goes negative when a fee was retained. This recomputes the
-- three running totals on every existing capital_pool row from the loans
-- + transactions that are now in the database. initial_capital is NOT
-- touched.

BEGIN;

WITH per_loan AS (
  SELECT
    l.tenant_id,
    l.principal_amount                AS principal,
    COALESCE(l.processing_fee, 0)     AS fee,
    COALESCE(l.total_interest, 0)     AS total_interest,
    COALESCE(l.total_amount_due, 0)   AS total_due,
    COALESCE(
      (SELECT SUM(amount_paid) FROM transactions
        WHERE loan_id = l.id AND payment_status = 'completed'), 0
    )                                  AS paid
  FROM loans l
  WHERE l.status IN ('active', 'completed', 'defaulted')
),
agg AS (
  SELECT
    tenant_id,
    SUM(principal)::numeric                                                                              AS disbursed,
    SUM(CASE WHEN total_due > 0 THEN paid * principal      / total_due ELSE 0 END)::numeric             AS collected_principal,
    SUM(CASE WHEN total_due > 0 THEN paid * total_interest / total_due ELSE 0 END)::numeric             AS interest_from_payments,
    SUM(fee)::numeric                                                                                    AS fees_earned
  FROM per_loan
  GROUP BY tenant_id
)
UPDATE capital_pool cp
   SET total_disbursed       = ROUND(COALESCE(agg.disbursed, 0), 2),
       total_collected       = ROUND(COALESCE(agg.collected_principal, 0), 2),
       total_interest_earned = ROUND(
         COALESCE(agg.interest_from_payments, 0) + COALESCE(agg.fees_earned, 0), 2),
       updated_at = NOW()
  FROM agg
 WHERE cp.tenant_id = agg.tenant_id;

-- Tenants with a pool but no disbursed loans go to zero (in case prior bad
-- state left non-zero totals).
UPDATE capital_pool cp
   SET total_disbursed = 0,
       total_collected = 0,
       total_interest_earned = 0,
       updated_at = NOW()
 WHERE NOT EXISTS (
   SELECT 1 FROM loans l
    WHERE l.tenant_id = cp.tenant_id
      AND l.status IN ('active', 'completed', 'defaulted')
 );

COMMIT;
