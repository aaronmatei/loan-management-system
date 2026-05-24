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
// (and the founding LoanFix tenant id=1 for the leaderboard).

import { query } from "../config/database.js";
import logger from "../config/logger.js";

class AnalyticsService {
  // ============================================================
  // TENANT-LEVEL
  // ============================================================

  // Portfolio overview KPIs. dateFrom/dateTo are optional ISO date
  // strings that constrain BOTH the loan-start window and the
  // payment-date window.
  async getTenantPortfolioKPIs(tenantId, dateFrom, dateTo) {
    const loans = await query(
      `SELECT
         COUNT(DISTINCT l.id)::int                                   AS total_loans,
         COUNT(DISTINCT CASE WHEN l.status='active' THEN l.id END)::int    AS active_loans,
         COUNT(DISTINCT CASE WHEN l.status='completed' THEN l.id END)::int AS completed_loans,
         COUNT(DISTINCT l.client_id)::int                            AS unique_borrowers,
         COALESCE(SUM(l.principal_amount), 0)                        AS total_disbursed,
         COALESCE(SUM(l.total_interest), 0)                          AS total_interest_expected,
         COALESCE(SUM(l.total_amount_due), 0)                        AS total_portfolio_value
       FROM loans l
       WHERE l.tenant_id = $1
         AND ($2::date IS NULL OR l.start_date >= $2)
         AND ($3::date IS NULL OR l.start_date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    const collections = await query(
      `SELECT
         COALESCE(SUM(t.amount_paid), 0)::float AS total_collected,
         COUNT(t.id)::int                       AS payment_count
       FROM transactions t
       WHERE t.tenant_id = $1
         AND t.payment_status = 'completed'
         AND ($2::date IS NULL OR t.payment_date >= $2)
         AND ($3::date IS NULL OR t.payment_date <= $3)`,
      [tenantId, dateFrom || null, dateTo || null],
    );

    // Interest portion of payments — same allocation formula used by
    // services/billingService.calculateTenantInterest. Kept here so
    // this method is self-contained for ad-hoc date ranges (billing's
    // helper is bound to calendar months).
    const interest = await query(
      `SELECT COALESCE(SUM(
         t.amount_paid * (l.total_interest / NULLIF(l.total_amount_due, 0))
       ), 0)::float AS interest_earned
       FROM transactions t
       JOIN loans l ON t.loan_id = l.id
       WHERE t.tenant_id = $1
         AND t.payment_status = 'completed'
         AND ($2::date IS NULL OR t.payment_date >= $2)
         AND ($3::date IS NULL OR t.payment_date <= $3)`,
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
      total_portfolio_value: parseFloat(k.total_portfolio_value) || 0,
      total_collected: parseFloat(c.total_collected) || 0,
      payment_count: parseInt(c.payment_count, 10) || 0,
      interest_earned: parseFloat(interest.rows[0].interest_earned) || 0,
      avg_loan_size: totalLoans > 0 ? totalDisbursed / totalLoans : 0,
    };
  }

  // Portfolio at Risk: outstanding balance of active loans that have
  // at least one overdue scheduled payment, divided by total
  // outstanding. Table is `payment_schedules` (plural) — the spec said
  // singular, which doesn't exist in this DB.
  async getPortfolioAtRisk(tenantId) {
    const result = await query(
      `SELECT
         COALESCE(SUM(l.total_amount_due - COALESCE(paid.total_paid, 0)), 0)::float
           AS total_outstanding,
         COALESCE(SUM(
           CASE WHEN overdue.has_overdue THEN
             l.total_amount_due - COALESCE(paid.total_paid, 0)
           ELSE 0 END
         ), 0)::float                                                   AS par_amount,
         COUNT(DISTINCT l.id)::int                                      AS total_active,
         COUNT(DISTINCT CASE WHEN overdue.has_overdue THEN l.id END)::int AS at_risk_count
       FROM loans l
       LEFT JOIN (
         SELECT loan_id, SUM(amount_paid) AS total_paid
         FROM transactions WHERE payment_status = 'completed'
         GROUP BY loan_id
       ) paid ON paid.loan_id = l.id
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

  // Monthly collection trend over the last N months.
  async getCollectionTrend(tenantId, months = 6) {
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', t.payment_date), 'Mon YYYY') AS month,
         date_trunc('month', t.payment_date)                      AS month_sort,
         COALESCE(SUM(t.amount_paid), 0)::float                   AS collected
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

  // Monthly disbursement trend over the last N months.
  async getDisbursementTrend(tenantId, months = 6) {
    const result = await query(
      `SELECT
         TO_CHAR(date_trunc('month', start_date), 'Mon YYYY') AS month,
         date_trunc('month', start_date)                      AS month_sort,
         COUNT(*)::int                                        AS loan_count,
         COALESCE(SUM(principal_amount), 0)::float            AS disbursed
       FROM loans
       WHERE tenant_id = $1
         AND start_date >= date_trunc('month', NOW())
                          - (INTERVAL '1 month' * $2)
       GROUP BY date_trunc('month', start_date)
       ORDER BY month_sort`,
      [tenantId, months],
    );
    return result.rows.map((r) => ({
      month: r.month,
      loan_count: parseInt(r.loan_count, 10),
      disbursed: parseFloat(r.disbursed),
    }));
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
  // tenants and (b) whichever tenant owns the LoanFix platform admins
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
      fees_paid: parseFloat(r.fees_paid),
    }));
  }
}

export default new AnalyticsService();
