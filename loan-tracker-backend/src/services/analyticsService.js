// Advanced analytics service powering /api/analytics/tenant and
// /api/analytics/platform. Distinct from the existing per-chart
// endpoints in routes/analytics.js (revenue-trends, portfolio-breakdown,
// top-clients, geographic, loan-distribution, default-trend,
// payment-methods, kpis) — those still serve pages/Analytics.jsx
// untouched. This file is the data layer behind the bundled
// /api/analytics/tenant + /platform aggregates and the PDF/Excel
// portfolio-report exports.
//
// All public methods take an explicit tenantId (or none for platform).
// We do NOT pull from req here — scoping lives in the route handler
// so this stays unit-testable and reusable from cron/CLI later if
// needed. Platform-level methods always filter out is_demo tenants
// (and the founding LenderFest tenant id=1 for the leaderboard).

import { query } from "../config/database.js";
import logger from "../config/logger.js";

class AnalyticsService {
  // ============================================================
  // TENANT-LEVEL
  // ============================================================

  // Portfolio overview KPIs. dateFrom/dateTo are optional ISO date
  // strings that constrain BOTH the loan-start window and the
  // payment-date window.
  //
  // Match the Dashboard's source-of-truth methodology so figures
  // never disagree between pages:
  //  - "Disbursed" counts only loans in (active/completed/defaulted);
  //    pending applications are NOT money out yet.
  //  - "Collected" excludes overpayment_portion (those are refunds,
  //    not income).
  //  - "Interest earned" prorates the post-refund payment amount,
  //    not the gross.
  async getTenantPortfolioKPIs(tenantId, dateFrom, dateTo) {
    const loans = await query(
      `SELECT
         COUNT(DISTINCT l.id)::int                                         AS total_loans,
         COUNT(DISTINCT CASE WHEN l.status='active' THEN l.id END)::int    AS active_loans,
         COUNT(DISTINCT CASE WHEN l.status='completed' THEN l.id END)::int AS completed_loans,
         COUNT(DISTINCT l.client_id)::int                                  AS unique_borrowers,
         COALESCE(SUM(l.principal_amount), 0)                              AS total_disbursed,
         COALESCE(SUM(l.total_interest), 0)                                AS total_interest_expected,
         COALESCE(SUM(l.processing_fee), 0)                                AS processing_fees,
         COALESCE(SUM(l.total_amount_due), 0)                              AS total_portfolio_value
       FROM loans l
       WHERE l.tenant_id = $1
         AND l.status IN ('active', 'completed', 'defaulted')
         AND ($2::date IS NULL OR l.disbursed_at::date >= $2)
         AND ($3::date IS NULL OR l.disbursed_at::date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    // Collected, fines and interest aggregated in two round-trips.
    //  - total_collected:  amount_paid net of overpayment (refunded)
    //  - fines_collected:  penalty_portion (late-payment fines income)
    //  - interest_earned:  loan-interest share of the post-penalty,
    //                      post-overpayment principal+interest portion.
    //                      Penalty is fines income, not loan interest,
    //                      so it must be excluded from the prorated base.
    const collections = await query(
      `SELECT
         COALESCE(SUM(t.amount_paid - COALESCE(t.overpayment_portion, 0)), 0)::float AS total_collected,
         COALESCE(SUM(COALESCE(t.penalty_portion, 0)), 0)::float                     AS fines_collected,
         COUNT(t.id)::int                                                            AS payment_count
       FROM transactions t
       WHERE t.tenant_id = $1
         AND t.payment_status = 'completed'
         AND ($2::date IS NULL OR t.payment_date >= $2)
         AND ($3::date IS NULL OR t.payment_date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    // Interest earned — for each transaction in the window,
    // attribute a share of its loan's lifetime cash-interest based
    // on the transaction's cash share. Per-loan cash-interest =
    // per-row LEAST(LEAST(amount_paid, amount_due), interest_room)
    // — the same waiver-aware formula the capital-pool booking
    // uses, so Reports and Dashboard agree.
    //
    // Why share-by-cash, not by ps.actual_payment_date:
    // schedule rows' actual_payment_date is unreliable as a
    // window key — the loan-reschedule path (loans.js) sets it
    // to the row's DUE date for already-paid rows, not to the
    // transaction's payment_date. Loan 317 example: cash arrived
    // 2022-04-27, row 1's actual_payment_date got stamped
    // 2022-05-05 (its due date), so the 500 of April interest
    // fell into May. transactions.payment_date is the cash
    // truth, so window the txns and prorate each one's share
    // of the loan's lifetime interest by its cash share.
    //
    // Accepted approximation: on multi-txn loans, each txn gets
    // an equal interest density (interest_earned ÷ total_cash).
    // Reality may skew interest toward early txns (when balance
    // is higher under reducing-balance), but cash-share is
    // accurate on aggregate and well-defined in SQL.
    const interest = await query(
      `WITH loan_interest AS (
         SELECT ps.loan_id,
                SUM(LEAST(
                  LEAST(ps.amount_paid, ps.amount_due),
                  GREATEST(
                    0,
                    COALESCE(ps.interest_portion, 0) - COALESCE(ps.interest_paid, 0)
                  )
                )) AS earned
         FROM payment_schedules ps GROUP BY ps.loan_id
       ),
       loan_cash AS (
         SELECT loan_id,
                SUM(amount_paid
                    - COALESCE(penalty_portion, 0)
                    - COALESCE(overpayment_portion, 0)) AS total_cash
         FROM transactions
         WHERE payment_status = 'completed'
         GROUP BY loan_id
       )
       SELECT COALESCE(SUM(
         CASE
           WHEN COALESCE(lc.total_cash, 0) > 0
           THEN COALESCE(li.earned, 0)
                * (t.amount_paid
                   - COALESCE(t.penalty_portion, 0)
                   - COALESCE(t.overpayment_portion, 0))
                / lc.total_cash
           ELSE 0
         END
       ), 0)::float AS interest_earned
       FROM transactions t
       LEFT JOIN loan_interest li ON li.loan_id = t.loan_id
       LEFT JOIN loan_cash lc ON lc.loan_id = t.loan_id
       WHERE t.tenant_id = $1
         AND t.payment_status = 'completed'
         AND ($2::date IS NULL OR t.payment_date >= $2)
         AND ($3::date IS NULL OR t.payment_date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    // Waivers applied in the window — economically a forgone-income
    // cost (the lender chose not to collect what was owed), so Reports
    // surfaces this as a separate cost line and folds it into Net
    // Profit. Approved-status waivers count from approved_at; the
    // historical pre-approval-flow rows (auto-applied by admin) still
    // surface because the route writes them as status='approved' with
    // approved_at set.
    // Same explicit-vs-fallback pattern used by /api/capital/status:
    // new waivers store interest_total / principal_total in the
    // allocation JSON, so we read those directly; older rows fall
    // back to a proportional split via the loan's contractual ratio
    // so historical reporting still nets correctly.
    const waivers = await query(
      `SELECT
         COALESCE(SUM(w.amount), 0)::float                    AS waivers_applied,
         COUNT(*)::int                                        AS waivers_count,
         COALESCE(SUM(COALESCE((w.allocation->>'penalty_total')::float, 0)), 0)::float
                                                              AS waivers_penalty,
         COALESCE(SUM(
           COALESCE(
             (w.allocation->>'interest_total')::float,
             COALESCE((w.allocation->>'amount_total')::float, 0)
               * (l.total_interest / NULLIF(l.total_amount_due, 0))
           )
         ), 0)::float                                         AS waivers_interest,
         COALESCE(SUM(
           COALESCE(
             (w.allocation->>'principal_total')::float,
             COALESCE((w.allocation->>'amount_total')::float, 0)
               * GREATEST(
                   0,
                   l.total_amount_due - COALESCE(l.total_interest, 0)
                 ) / NULLIF(l.total_amount_due, 0)
           )
         ), 0)::float                                         AS waivers_principal,
         -- Principal write-off (treasury lens, used by Reports'
         -- Net Profit calc). Prefers the admin's declared
         -- principal_total on the waiver allocation; falls back
         -- to (total_amount_due − total_interest) / total_amount_due
         -- — the row-composition ratio that stays correct after
         -- reducing-balance recompute, unlike the old
         -- principal_amount/total_amount_due ratio which inflated
         -- writeoff once a knockdown shrunk total_amount_due.
         -- Penalty-only waivers contribute zero here because they
         -- don't touch amount_due at all.
         COALESCE(SUM(
           COALESCE(
             (w.allocation->>'principal_total')::float,
             COALESCE((w.allocation->>'amount_total')::float, 0)
               * GREATEST(
                   0,
                   l.total_amount_due - COALESCE(l.total_interest, 0)
                 ) / NULLIF(l.total_amount_due, 0)
           )
         ), 0)::float                                         AS principal_written_off_by_ratio,
         -- Same contract-ratio lens for the interest side — used by
         -- Reports' "Interest from Loans" tile so that
         --   Initial (contractual)
         --   − Waived (by ratio, this field)
         --   = Cash interest collected
         -- reconciles. Differs from waivers_interest (admin-declared)
         -- when a type=interest waiver was applied to a row whose
         -- contractual interest share was smaller than amount_total.
         COALESCE(SUM(
           COALESCE((w.allocation->>'amount_total')::float, 0)
             * (l.total_interest / NULLIF(l.total_amount_due, 0))
         ), 0)::float                                         AS waivers_interest_by_ratio
       FROM loan_waivers w
       JOIN loans l ON l.id = w.loan_id
      WHERE l.tenant_id = $1
        AND w.status = 'approved'
        AND ($2::date IS NULL OR w.approved_at::date >= $2)
        AND ($3::date IS NULL OR w.approved_at::date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    const k = loans.rows[0];
    const c = collections.rows[0];
    const totalLoans = parseInt(k.total_loans, 10) || 0;
    const totalDisbursed = parseFloat(k.total_disbursed) || 0;

    return {
      total_loans: totalLoans,
      active_loans: parseInt(k.active_loans, 10) || 0,
      completed_loans: parseInt(k.completed_loans, 10) || 0,
      unique_borrowers: parseInt(k.unique_borrowers, 10) || 0,
      total_disbursed: totalDisbursed,
      total_interest_expected: parseFloat(k.total_interest_expected) || 0,
      processing_fees: parseFloat(k.processing_fees) || 0,
      total_portfolio_value: parseFloat(k.total_portfolio_value) || 0,
      total_collected: parseFloat(c.total_collected) || 0,
      fines_collected: parseFloat(c.fines_collected) || 0,
      payment_count: parseInt(c.payment_count, 10) || 0,
      interest_earned: parseFloat(interest.rows[0].interest_earned) || 0,
      waivers_applied: parseFloat(waivers.rows[0].waivers_applied) || 0,
      waivers_count: parseInt(waivers.rows[0].waivers_count, 10) || 0,
      waivers_interest: parseFloat(waivers.rows[0].waivers_interest) || 0,
      waivers_penalty: parseFloat(waivers.rows[0].waivers_penalty) || 0,
      waivers_principal: parseFloat(waivers.rows[0].waivers_principal) || 0,
      principal_written_off_by_ratio:
        parseFloat(waivers.rows[0].principal_written_off_by_ratio) || 0,
      waivers_interest_by_ratio:
        parseFloat(waivers.rows[0].waivers_interest_by_ratio) || 0,
      avg_loan_size: totalLoans > 0 ? totalDisbursed / totalLoans : 0,
    };
  }

  // Portfolio at Risk: outstanding balance of active loans that have
  // at least one overdue scheduled payment, divided by total
  // outstanding. Outstanding here is the same per-loan remaining
  // balance the Loans list uses — total_amount_due net of
  // cash-toward-amount_due (penalty + overpayment do NOT pay down
  // amount_due) net of waivers' amount_total. Without those two
  // nets a waived loan stays in PAR forever even though it owes
  // nothing.
  async getPortfolioAtRisk(tenantId) {
    const result = await query(
      `SELECT
         COALESCE(SUM(
           GREATEST(
             l.total_amount_due
             - COALESCE(paid.toward_amount_due, 0)
             - COALESCE(wv.waived_amount_total, 0),
             0
           )
         ), 0)::float                                                   AS total_outstanding,
         COALESCE(SUM(
           CASE WHEN overdue.has_overdue THEN
             GREATEST(
               l.total_amount_due
               - COALESCE(paid.toward_amount_due, 0)
               - COALESCE(wv.waived_amount_total, 0),
               0
             )
           ELSE 0 END
         ), 0)::float                                                   AS par_amount,
         COUNT(DISTINCT l.id)::int                                      AS total_active,
         COUNT(DISTINCT CASE WHEN overdue.has_overdue THEN l.id END)::int AS at_risk_count
       FROM loans l
       LEFT JOIN (
         SELECT loan_id,
                SUM(amount_paid
                    - COALESCE(penalty_portion, 0)
                    - COALESCE(overpayment_portion, 0)) AS toward_amount_due
         FROM transactions WHERE payment_status = 'completed'
         GROUP BY loan_id
       ) paid ON paid.loan_id = l.id
       LEFT JOIN (
         SELECT loan_id,
                SUM(COALESCE((allocation->>'amount_total')::float, 0))
                  AS waived_amount_total
         FROM loan_waivers WHERE status = 'approved'
         GROUP BY loan_id
       ) wv ON wv.loan_id = l.id
       LEFT JOIN (
         SELECT loan_id, true AS has_overdue
         FROM payment_schedules WHERE status = 'overdue'
         GROUP BY loan_id
       ) overdue ON overdue.loan_id = l.id
       WHERE l.tenant_id = $1 AND l.status = 'active'`,
      [tenantId],
    );

    const d = result.rows[0];
    const totalOutstanding = parseFloat(d.total_outstanding) || 0;
    const parAmount = parseFloat(d.par_amount) || 0;
    return {
      total_outstanding: totalOutstanding,
      par_amount: parAmount,
      par_percentage:
        totalOutstanding > 0
          ? ((parAmount / totalOutstanding) * 100).toFixed(1)
          : "0.0",
      total_active: parseInt(d.total_active, 10) || 0,
      at_risk_count: parseInt(d.at_risk_count, 10) || 0,
    };
  }

  // Expense roll-ups for a date window — total + this-month + last-month.
  // dateFrom/dateTo are inclusive YYYY-MM-DD strings; both null means
  // all-time. Used by the Reports & Dashboard surfaces.
  async getExpenseStats(tenantId, dateFrom = null, dateTo = null) {
    const r = await query(
      `SELECT
         COALESCE(SUM(amount), 0)::float AS total_in_window,
         COALESCE(SUM(amount) FILTER (
           WHERE date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE)
         ), 0)::float AS total_this_month,
         COALESCE(SUM(amount) FILTER (
           WHERE date_trunc('month', expense_date) =
                 date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
         ), 0)::float AS total_last_month,
         COUNT(*)::int AS count_in_window
       FROM expenses
       WHERE tenant_id = $1
         AND ($2::date IS NULL OR expense_date >= $2)
         AND ($3::date IS NULL OR expense_date <= $3)`,
      [tenantId, dateFrom, dateTo],
    );
    return r.rows[0];
  }

  // Income vs Expenses monthly trend — what the cash-flow chart on
  // Reports needs in one shot. Income = interest portion of payments
  // + penalty (fines) portion (same formulas the KPIs use). Expenses
  // = SUM(amount) from the expenses ledger. Both bucketed by their
  // respective dates, joined to a months series so empty months still
  // render as zero.
  // Income vs expenses trend. Bucket granularity depends on the
  // selected range:
  //   • from/to spanning > 31 days (e.g. a Year-mode period) →
  //     monthly buckets so the x-axis reads "Jan/Feb/Mar…"
  //     instead of 365 daily ticks (the bug the user spotted:
  //     selecting "2026" rendered "07 Jan, 21 Jan, 04 Feb…")
  //   • from/to ≤ 31 days (a Month-mode period) → daily buckets
  //     so per-day shape is visible
  //   • no range → fall back to last N months ending today.
  //
  // Income per bucket = interest portion of cash receipts + penalty
  // income. Interest uses the per-transaction LEAST cap (cumulative
  // cash before this txn vs. the loan's remaining amount-due space)
  // so reducing-balance principal knockdown — cash that overshot
  // the row to wipe future installments — doesn't get ratio-split
  // into phantom interest income. Same fix as interest_earned in
  // getTenantPortfolioKPIs.
  async getIncomeVsExpensesTrend(tenantId, months = 6, from = null, to = null) {
    // Income sources joined to a single date column so they can
    // be bucketed together: cash interest (each transaction gets
    // a share of its loan's lifetime cash-interest proportional
    // to its cash share) plus penalty income. Dated by
    // t.payment_date — the actual cash date, not the schedule's
    // actual_payment_date which can be stamped to the row's due
    // date by the loan-reschedule path (loans.js).
    const incomeCte = `
      loan_interest AS (
        SELECT ps.loan_id,
               SUM(LEAST(
                 LEAST(ps.amount_paid, ps.amount_due),
                 GREATEST(
                   0,
                   COALESCE(ps.interest_portion, 0) - COALESCE(ps.interest_paid, 0)
                 )
               )) AS earned
        FROM payment_schedules ps
        JOIN loans l ON l.id = ps.loan_id
        WHERE l.tenant_id = $1
        GROUP BY ps.loan_id
      ),
      loan_cash AS (
        SELECT t.loan_id,
               SUM(t.amount_paid
                   - COALESCE(t.penalty_portion, 0)
                   - COALESCE(t.overpayment_portion, 0)) AS total_cash
        FROM transactions t
        WHERE t.tenant_id = $1 AND t.payment_status = 'completed'
        GROUP BY t.loan_id
      ),
      income_events AS (
        SELECT
          t.payment_date::date AS d,
          CASE
            WHEN COALESCE(lc.total_cash, 0) > 0
            THEN COALESCE(li.earned, 0)
                 * (t.amount_paid
                    - COALESCE(t.penalty_portion, 0)
                    - COALESCE(t.overpayment_portion, 0))
                 / lc.total_cash
            ELSE 0
          END AS amount
        FROM transactions t
        LEFT JOIN loan_interest li ON li.loan_id = t.loan_id
        LEFT JOIN loan_cash     lc ON lc.loan_id = t.loan_id
        WHERE t.tenant_id = $1 AND t.payment_status = 'completed'
        UNION ALL
        SELECT
          t.payment_date::date AS d,
          COALESCE(t.penalty_portion, 0) AS amount
        FROM transactions t
        WHERE t.tenant_id = $1 AND t.payment_status = 'completed'
      )`;

    if (from && to) {
      // Decide bucketing from the range span (inclusive of both ends).
      const spanDays =
        Math.round(
          (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24),
        ) + 1;
      const useMonthlyBuckets = spanDays > 31;
      const bucket = useMonthlyBuckets
        ? { trunc: "month", step: "1 month", fmt: "Mon YYYY" }
        : { trunc: "day", step: "1 day", fmt: "DD Mon" };
      const r = await query(
        `WITH ${incomeCte},
         buckets AS (
           SELECT generate_series(
             date_trunc('${bucket.trunc}', $2::date),
             date_trunc('${bucket.trunc}', $3::date),
             '${bucket.step}'::interval
           ) AS b
         ),
         income AS (
           SELECT date_trunc('${bucket.trunc}', d) AS b,
                  COALESCE(SUM(amount), 0)::float AS amount
           FROM income_events
           WHERE d >= $2::date AND d <= $3::date
           GROUP BY 1
         ),
         outflow AS (
           SELECT date_trunc('${bucket.trunc}', expense_date) AS b,
                  COALESCE(SUM(amount), 0)::float AS amount
           FROM expenses
           WHERE tenant_id = $1
             AND expense_date >= $2::date AND expense_date <= $3::date
           GROUP BY 1
         )
         SELECT
           TO_CHAR(buckets.b, '${bucket.fmt}') AS month,
           buckets.b                           AS month_sort,
           COALESCE(income.amount, 0)          AS income,
           COALESCE(outflow.amount, 0)         AS expenses,
           COALESCE(income.amount, 0) - COALESCE(outflow.amount, 0) AS net
         FROM buckets
         LEFT JOIN income  ON income.b  = buckets.b
         LEFT JOIN outflow ON outflow.b = buckets.b
         ORDER BY buckets.b`,
        [tenantId, from, to],
      );
      return r.rows.map((x) => ({
        month: x.month,
        income: parseFloat(x.income) || 0,
        expenses: parseFloat(x.expenses) || 0,
        net: parseFloat(x.net) || 0,
      }));
    }

    // Monthly series — last N months ending today.
    const r = await query(
      `WITH ${incomeCte},
       months AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE) - (INTERVAL '1 month' * ($2 - 1)),
           date_trunc('month', CURRENT_DATE),
           '1 month'::interval
         ) AS m
       ),
       income AS (
         SELECT date_trunc('month', d) AS m,
                COALESCE(SUM(amount), 0)::float AS amount
           FROM income_events
          GROUP BY 1
       ),
       outflow AS (
         SELECT date_trunc('month', expense_date) AS m,
                COALESCE(SUM(amount), 0)::float AS amount
         FROM expenses
         WHERE tenant_id = $1
         GROUP BY 1
       )
       SELECT
         TO_CHAR(months.m, 'Mon YYYY') AS month,
         COALESCE(income.amount, 0)    AS income,
         COALESCE(outflow.amount, 0)   AS expenses,
         COALESCE(income.amount, 0) - COALESCE(outflow.amount, 0) AS net
       FROM months
       LEFT JOIN income  ON income.m  = months.m
       LEFT JOIN outflow ON outflow.m = months.m
       ORDER BY months.m`,
      [tenantId, months],
    );
    return r.rows.map((x) => ({
      month: x.month,
      income: parseFloat(x.income) || 0,
      expenses: parseFloat(x.expenses) || 0,
      net: parseFloat(x.net) || 0,
    }));
  }

  // Collection trend. Granularity follows the range:
  //   • from/to > 31 days → monthly buckets (Year-mode period)
  //   • from/to ≤ 31 days → daily buckets (Month-mode period)
  //   • no range → last N months ending today.
  async getCollectionTrend(tenantId, months = 6, from = null, to = null) {
    if (from && to) {
      const spanDays =
        Math.round(
          (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24),
        ) + 1;
      const trunc = spanDays > 31 ? "month" : "day";
      const fmt = spanDays > 31 ? "Mon YYYY" : "DD Mon";
      const result = await query(
        `SELECT
           TO_CHAR(date_trunc('${trunc}', t.payment_date), '${fmt}') AS month,
           date_trunc('${trunc}', t.payment_date)                    AS month_sort,
           COALESCE(SUM(t.amount_paid - COALESCE(t.overpayment_portion, 0)), 0)::float AS collected
         FROM transactions t
         WHERE t.tenant_id = $1
           AND t.payment_status = 'completed'
           AND t.payment_date >= $2::date
           AND t.payment_date <= $3::date
         GROUP BY date_trunc('${trunc}', t.payment_date)
         ORDER BY date_trunc('${trunc}', t.payment_date)`,
        [tenantId, from, to],
      );
      return result.rows.map((r) => ({
        month: r.month,
        collected: parseFloat(r.collected),
      }));
    }
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', t.payment_date), 'Mon YYYY') AS month,
         date_trunc('month', t.payment_date)                      AS month_sort,
         COALESCE(SUM(t.amount_paid - COALESCE(t.overpayment_portion, 0)), 0)::float AS collected
       FROM transactions t
       WHERE t.tenant_id = $1
         AND t.payment_status = 'completed'
         AND t.payment_date >= date_trunc('month', NOW())
                              - (INTERVAL '1 month' * $2)
       GROUP BY date_trunc('month', t.payment_date)
       ORDER BY month_sort`,
      [tenantId, months],
    );
    return result.rows.map((r) => ({
      month: r.month,
      collected: parseFloat(r.collected),
    }));
  }

  // Disbursement trend. Same daily/monthly split as the collection
  // trend. Bucketed by `disbursed_at` (not application start_date)
  // and restricted to status IN (active/completed/defaulted) so a
  // pending application never inflates the trend — matches the
  // Dashboard's /dashboard/monthly-trends loansTrend query.
  async getDisbursementTrend(tenantId, months = 6, from = null, to = null) {
    if (from && to) {
      const spanDays =
        Math.round(
          (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24),
        ) + 1;
      const trunc = spanDays > 31 ? "month" : "day";
      const fmt = spanDays > 31 ? "Mon YYYY" : "DD Mon";
      const result = await query(
        `SELECT
           TO_CHAR(date_trunc('${trunc}', disbursed_at), '${fmt}') AS month,
           date_trunc('${trunc}', disbursed_at)                    AS month_sort,
           COUNT(*)::int                                           AS loan_count,
           COALESCE(SUM(principal_amount), 0)::float               AS disbursed
         FROM loans
         WHERE tenant_id = $1
           AND status IN ('active', 'completed', 'defaulted')
           AND disbursed_at IS NOT NULL
           AND disbursed_at::date >= $2::date
           AND disbursed_at::date <= $3::date
         GROUP BY date_trunc('${trunc}', disbursed_at)
         ORDER BY date_trunc('${trunc}', disbursed_at)`,
        [tenantId, from, to],
      );
      return result.rows.map((r) => ({
        month: r.month,
        loan_count: parseInt(r.loan_count, 10),
        disbursed: parseFloat(r.disbursed),
      }));
    }
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', disbursed_at), 'Mon YYYY') AS month,
         date_trunc('month', disbursed_at)                      AS month_sort,
         COUNT(*)::int                                          AS loan_count,
         COALESCE(SUM(principal_amount), 0)::float              AS disbursed
       FROM loans
       WHERE tenant_id = $1
         AND status IN ('active', 'completed', 'defaulted')
         AND disbursed_at IS NOT NULL
         AND disbursed_at >= date_trunc('month', NOW())
                            - (INTERVAL '1 month' * $2)
       GROUP BY date_trunc('month', disbursed_at)
       ORDER BY month_sort`,
      [tenantId, months],
    );
    return result.rows.map((r) => ({
      month: r.month,
      loan_count: parseInt(r.loan_count, 10),
      disbursed: parseFloat(r.disbursed),
    }));
  }

  // Snapshot of outstanding balance + currently-overdue installments +
  // defaulted loans. Snapshot = present-day state regardless of the
  // date range filter (just like the Dashboard). Mirrors the Dashboard
  // query in routes/dashboard.js so the figures match — both views
  // sum the per-loan remaining balance with cash-toward-amount_due
  // and waivers netted out.
  async getOverdueDefaultedSnapshot(tenantId) {
    const outstanding = await query(
      `SELECT
         COALESCE(SUM(
           GREATEST(
             l.total_amount_due
             - COALESCE(p.toward_amount_due, 0)
             - COALESCE(wv.waived_amount_total, 0),
             0
           )
         ), 0)::float                                                   AS outstanding_balance
       FROM loans l
       LEFT JOIN (
         SELECT loan_id,
                SUM(amount_paid
                    - COALESCE(penalty_portion, 0)
                    - COALESCE(overpayment_portion, 0)) AS toward_amount_due
           FROM transactions
          WHERE payment_status = 'completed'
          GROUP BY loan_id
       ) p ON p.loan_id = l.id
       LEFT JOIN (
         SELECT loan_id,
                SUM(COALESCE((allocation->>'amount_total')::float, 0))
                  AS waived_amount_total
           FROM loan_waivers
          WHERE status = 'approved'
          GROUP BY loan_id
       ) wv ON wv.loan_id = l.id
       WHERE l.tenant_id = $1
         AND l.status IN ('active', 'completed', 'defaulted')`,
      [tenantId],
    );

    const overdue = await query(
      `SELECT
         COUNT(*)::int                                                AS overdue_count,
         COUNT(DISTINCT ps.loan_id)::int                              AS overdue_loans,
         COALESCE(SUM(ps.amount_due - COALESCE(ps.amount_paid, 0)), 0)::float AS overdue_amount
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.tenant_id = $1
         AND (
           ps.status = 'overdue'
           OR (ps.status = 'pending' AND ps.due_date < CURRENT_DATE)
         )
         AND ps.amount_due > COALESCE(ps.amount_paid, 0)`,
      [tenantId],
    );

    const defaulted = await query(
      `SELECT
         COUNT(*)::int                                                          AS defaulted_count,
         COALESCE(SUM(
           GREATEST(
             l.total_amount_due
             - COALESCE(p.toward_amount_due, 0)
             - COALESCE(wv.waived_amount_total, 0),
             0
           )
         ), 0)::float                                                           AS defaulted_amount,
         COALESCE(SUM(principal_amount), 0)::float                              AS defaulted_principal
       FROM loans l
       LEFT JOIN (
         SELECT loan_id,
                SUM(amount_paid
                    - COALESCE(penalty_portion, 0)
                    - COALESCE(overpayment_portion, 0)) AS toward_amount_due
           FROM transactions
          WHERE payment_status = 'completed'
          GROUP BY loan_id
       ) p ON p.loan_id = l.id
       LEFT JOIN (
         SELECT loan_id,
                SUM(COALESCE((allocation->>'amount_total')::float, 0))
                  AS waived_amount_total
           FROM loan_waivers
          WHERE status = 'approved'
          GROUP BY loan_id
       ) wv ON wv.loan_id = l.id
       WHERE l.tenant_id = $1 AND l.status = 'defaulted'`,
      [tenantId],
    );

    return {
      outstanding_balance: parseFloat(outstanding.rows[0].outstanding_balance),
      overdue_count: overdue.rows[0].overdue_count,
      overdue_loans: overdue.rows[0].overdue_loans,
      overdue_amount: parseFloat(overdue.rows[0].overdue_amount),
      defaulted_count: defaulted.rows[0].defaulted_count,
      defaulted_amount: parseFloat(defaulted.rows[0].defaulted_amount),
      defaulted_principal: parseFloat(defaulted.rows[0].defaulted_principal),
    };
  }

  // Aging buckets: payments still owed, grouped by days past due.
  async getAgingAnalysis(tenantId) {
    const result = await query(
      `SELECT
         CASE
           WHEN CURRENT_DATE - due_date <= 0 THEN 'Current'
           WHEN CURRENT_DATE - due_date BETWEEN 1 AND 30 THEN '1-30 days'
           WHEN CURRENT_DATE - due_date BETWEEN 31 AND 60 THEN '31-60 days'
           WHEN CURRENT_DATE - due_date BETWEEN 61 AND 90 THEN '61-90 days'
           ELSE '90+ days'
         END                                            AS bucket,
         COUNT(*)::int                                  AS count,
         COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0)::float
                                                        AS amount
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.tenant_id = $1
         AND ps.status IN ('pending', 'overdue', 'partial')
       GROUP BY bucket
       ORDER BY MIN(CURRENT_DATE - due_date)`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      bucket: r.bucket,
      count: parseInt(r.count, 10),
      amount: parseFloat(r.amount),
    }));
  }

  // Loan officer leaderboard. Uses loans.created_by (the actual column
  // name — the spec's `created_by_user_id` doesn't exist here).
  async getLoanOfficerPerformance(tenantId) {
    const result = await query(
      `SELECT
         u.id,
         u.first_name || ' ' || u.last_name      AS officer_name,
         COUNT(DISTINCT l.id)::int               AS loans_created,
         COALESCE(SUM(l.principal_amount), 0)::float AS total_disbursed
       FROM users u
       LEFT JOIN loans l ON l.created_by = u.id AND l.tenant_id = $1
       WHERE u.tenant_id = $1
         AND u.role IN ('loan_officer', 'manager', 'admin')
       GROUP BY u.id, u.first_name, u.last_name
       HAVING COUNT(DISTINCT l.id) > 0
       ORDER BY total_disbursed DESC`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      officer_name: r.officer_name,
      loans_created: parseInt(r.loans_created, 10),
      total_disbursed: parseFloat(r.total_disbursed),
    }));
  }

  // Status distribution — feeds the loan-status pie chart. Already
  // covered by /portfolio-breakdown for Analytics.jsx, but kept here
  // so the new bundled /tenant endpoint is self-contained and the
  // PDF/Excel exports don't have to make two round-trips.
  async getLoanStatusDistribution(tenantId) {
    const result = await query(
      `SELECT status,
              COUNT(*)::int                              AS count,
              COALESCE(SUM(principal_amount), 0)::float  AS amount
         FROM loans WHERE tenant_id = $1
         GROUP BY status`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
      amount: parseFloat(r.amount),
    }));
  }

  // ============================================================
  // PLATFORM-LEVEL
  // ============================================================

  // High-level KPIs for the platform-admin dashboard. is_demo tenants
  // are excluded everywhere — they're seed data, not real revenue.
  async getPlatformKPIs(dateFrom, dateTo) {
    const tenants = await query(
      `SELECT
         COUNT(*)::int                                                   AS total_tenants,
         COUNT(*) FILTER (WHERE status = 'active')::int                  AS active_tenants,
         COUNT(*) FILTER (WHERE status = 'suspended')::int               AS suspended_tenants,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS new_this_month
       FROM tenants
       WHERE COALESCE(is_demo, false) = false`,
    );

    const revenue = await query(
      `SELECT
         COALESCE(SUM(amount_paid), 0)::float        AS total_revenue,
         COALESCE(SUM(CASE WHEN status IN ('pending','overdue')
                           THEN total_amount - COALESCE(amount_paid, 0)
                      END), 0)::float                AS outstanding,
         COUNT(*)::int                               AS total_invoices
       FROM invoices
       WHERE ($1::date IS NULL OR issued_date >= $1)
         AND ($2::date IS NULL OR issued_date <= $2)`,
      [dateFrom || null, dateTo || null],
    );

    const platformLoans = await query(
      `SELECT
         COUNT(*)::int AS total_loans,
         -- "Disbursed" = money actually paid out. Pending / under_review /
         -- approved / rejected / counter_offered loans have NOT been
         -- disbursed, so they must not inflate this figure.
         COALESCE(SUM(principal_amount)
           FILTER (WHERE l.status IN ('active','completed','defaulted')), 0)::float
           AS total_disbursed
       FROM loans l
       JOIN tenants t ON l.tenant_id = t.id
       WHERE COALESCE(t.is_demo, false) = false`,
    );

    return {
      tenants: {
        total_tenants: parseInt(tenants.rows[0].total_tenants, 10),
        active_tenants: parseInt(tenants.rows[0].active_tenants, 10),
        suspended_tenants: parseInt(tenants.rows[0].suspended_tenants, 10),
        new_this_month: parseInt(tenants.rows[0].new_this_month, 10),
      },
      revenue: {
        total_revenue: parseFloat(revenue.rows[0].total_revenue),
        outstanding: parseFloat(revenue.rows[0].outstanding),
        total_invoices: parseInt(revenue.rows[0].total_invoices, 10),
      },
      platform_loans: {
        total_loans: parseInt(platformLoans.rows[0].total_loans, 10),
        total_disbursed: parseFloat(platformLoans.rows[0].total_disbursed),
      },
    };
  }

  // Monthly revenue trend driven by actual invoice payments — the
  // platform's real cash receipts, not what was invoiced.
  async getPlatformRevenueTrend(months = 6) {
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', payment_date), 'Mon YYYY') AS month,
         date_trunc('month', payment_date)                      AS month_sort,
         COALESCE(SUM(amount), 0)::float                        AS revenue
       FROM invoice_payments
       WHERE payment_date >= date_trunc('month', NOW())
                            - (INTERVAL '1 month' * $1)
       GROUP BY date_trunc('month', payment_date)
       ORDER BY month_sort`,
      [months],
    );
    return result.rows.map((r) => ({
      month: r.month,
      revenue: parseFloat(r.revenue),
    }));
  }

  // Tenant leaderboard by disbursement volume. Excludes (a) demo
  // tenants and (b) whichever tenant owns the LenderFest platform admins
  // — the spec assumed id=1 but in this DB id=1 is a real lender, so
  // we detect the platform tenant by its is_platform_admin users
  // instead.
  async getTenantLeaderboard() {
    const result = await query(
      `SELECT
         t.id, t.business_name, t.brand_color, t.status,
         -- Rank by real disbursement volume: only loans actually paid out
         -- (active/completed/defaulted), never pending applications.
         COUNT(DISTINCT l.id) FILTER (
           WHERE l.status IN ('active','completed','defaulted'))::int AS loans,
         COALESCE(SUM(l.principal_amount)
           FILTER (WHERE l.status IN ('active','completed','defaulted')), 0)::float
           AS disbursed,
         -- Interest the tenant is contracted to earn on disbursed loans.
         COALESCE(SUM(l.total_interest)
           FILTER (WHERE l.status IN ('active','completed','defaulted')), 0)::float
           AS contract_interest,
         -- Cash actually collected from borrowers (net of refundable
         -- overpayment — matches the staff Payments "collected" figure).
         -- Correlated subquery so the loans join above doesn't fan it out.
         COALESCE((
           SELECT SUM(tx.amount_paid - COALESCE(tx.overpayment_portion, 0))
           FROM transactions tx
           WHERE tx.tenant_id = t.id
         ), 0)::float                                       AS total_collected,
         -- Interest actually earned to date — the SAME per-installment
         -- formula the loan summary uses: waiver-covered interest plus the
         -- cash share of each installment's interest (flat per-installment
         -- share x fraction paid), capped at the installment's interest.
         -- NOT SUM(interest_paid): that column holds ONLY *waiver* interest
         -- (written by waiverService), so summing it reports zero for any
         -- tenant without interest waivers.
         COALESCE((
           SELECT SUM(LEAST(
             l2.total_interest / NULLIF(l2.loan_duration_months, 0),
             COALESCE(ps.interest_paid, 0)
               + (l2.total_interest / NULLIF(l2.loan_duration_months, 0))
                 * LEAST(1, ps.amount_paid / NULLIF(ps.amount_due, 0))
           ))
           FROM payment_schedules ps
           JOIN loans l2 ON l2.id = ps.loan_id
           WHERE ps.tenant_id = t.id
         ), 0)::float                                       AS interest_collected,
         COALESCE((
           SELECT SUM(i.amount_paid)
           FROM invoices i
           WHERE i.tenant_id = t.id AND i.status = 'paid'
         ), 0)::float                                       AS fees_paid
       FROM tenants t
       LEFT JOIN loans l ON l.tenant_id = t.id
       WHERE COALESCE(t.is_demo, false) = false
         AND NOT EXISTS (
           SELECT 1 FROM users u
           WHERE u.tenant_id = t.id AND u.is_platform_admin = true
         )
       GROUP BY t.id, t.business_name, t.brand_color, t.status
       ORDER BY disbursed DESC
       LIMIT 20`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      business_name: r.business_name,
      brand_color: r.brand_color,
      status: r.status,
      loans: parseInt(r.loans, 10),
      disbursed: parseFloat(r.disbursed),
      contract_interest: parseFloat(r.contract_interest),
      total_collected: parseFloat(r.total_collected),
      interest_collected: parseFloat(r.interest_collected),
      fees_paid: parseFloat(r.fees_paid),
    }));
  }
}

export default new AnalyticsService();
