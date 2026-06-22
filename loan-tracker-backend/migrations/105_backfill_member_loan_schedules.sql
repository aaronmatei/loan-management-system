-- Loans issued via issueMemberLoan (member-request approval / "issue from pool")
-- never got an installment schedule, so their repayment history showed empty.
-- Code is fixed going forward; backfill a flat-amortized schedule for the
-- affected loans (those are always flat). Only loans with nothing paid yet, so
-- we never fabricate a misleading paid/unpaid split.
BEGIN;
INSERT INTO member_loan_schedules
  (tenant_id, member_loan_id, payment_number, due_date, amount_due, interest_portion, principal_portion, balance_after, status)
SELECT
  l.tenant_id,
  l.id,
  gs.n,
  (COALESCE(l.disbursed_at, l.created_at)::date + (gs.n || ' month')::interval)::date,
  CASE WHEN gs.n < l.duration_months
       THEN round(l.principal / l.duration_months, 2) + round(l.total_interest / l.duration_months, 2)
       ELSE (l.principal     - round(l.principal     / l.duration_months, 2) * (l.duration_months - 1))
          + (l.total_interest - round(l.total_interest / l.duration_months, 2) * (l.duration_months - 1))
  END,
  CASE WHEN gs.n < l.duration_months
       THEN round(l.total_interest / l.duration_months, 2)
       ELSE l.total_interest - round(l.total_interest / l.duration_months, 2) * (l.duration_months - 1)
  END,
  CASE WHEN gs.n < l.duration_months
       THEN round(l.principal / l.duration_months, 2)
       ELSE l.principal - round(l.principal / l.duration_months, 2) * (l.duration_months - 1)
  END,
  CASE WHEN gs.n < l.duration_months
       THEN round(l.total_amount_due - (round(l.principal / l.duration_months, 2) + round(l.total_interest / l.duration_months, 2)) * gs.n, 2)
       ELSE 0
  END,
  'pending'
FROM member_loans l
CROSS JOIN generate_series(1, l.duration_months) AS gs(n)
WHERE l.duration_months > 0
  AND l.status IN ('active', 'defaulted')
  AND COALESCE(l.amount_paid, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM member_loan_schedules s WHERE s.member_loan_id = l.id);
COMMIT;
