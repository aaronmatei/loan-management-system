import express from "express";
import bcryptjs from "bcryptjs";
import { query } from "../../config/database.js";
import { verifyCustomer } from "../../middleware/customerAuth.js";
import { validatePassword } from "../../utils/validators.js";
import {
  buildLoanStatementPdf,
  buildClientStatementPdf,
  NotFoundError,
} from "../../utils/pdfDocuments.js";
import logger from "../../config/logger.js";
import smsService from "../../services/smsService.js";
import {
  calculateCreditScore,
  getRiskLevel,
  isRated,
} from "../../utils/creditScore.js";
import notificationDispatcher from "../../services/notificationDispatcher.js";
import { nextLoanCode } from "../../utils/clientCode.js";

const router = express.Router();
router.use(verifyCustomer);

// Customer's linked tenants + platform-wide rollup
router.get("/tenants", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         ctl.tenant_id, ctl.client_id, ctl.linked_at,
         t.business_name, t.subdomain, t.brand_color,
         c.client_code,
         (SELECT COUNT(*) FROM loans
            WHERE client_id = ctl.client_id AND status = 'active') AS active_loans,
         (SELECT COUNT(*) FROM loans
            WHERE client_id = ctl.client_id AND status = 'completed') AS completed_loans,
         (SELECT COALESCE(SUM(
              l.total_amount_due
              - COALESCE((SELECT SUM(tx.amount_paid) FROM transactions tx
                           WHERE tx.loan_id = l.id
                             AND tx.payment_status = 'completed'), 0)), 0)
            FROM loans l
            WHERE l.client_id = ctl.client_id AND l.status = 'active'
         ) AS total_balance
       FROM customer_tenant_links ctl
       JOIN tenants t ON ctl.tenant_id = t.id
       JOIN clients c ON ctl.client_id = c.id
       WHERE ctl.platform_customer_id = $1
         AND ctl.status = 'active' AND t.status = 'active'
       ORDER BY active_loans DESC`,
      [req.platformCustomerId],
    );
    const totalActive = r.rows.reduce(
      (s, t) => s + parseInt(t.active_loans, 10),
      0,
    );
    const totalBalance = r.rows.reduce(
      (s, t) => s + parseFloat(t.total_balance),
      0,
    );
    res.json({
      success: true,
      data: {
        tenants: r.rows,
        platform_stats: {
          total_tenants: r.rows.length,
          total_active_loans: totalActive,
          total_balance: totalBalance,
        },
      },
    });
  } catch (error) {
    logger.error("Get tenants error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Active, portal-enabled, self-signup tenants the customer is NOT
// yet linked to. is_existing_client is a best-effort hint (exact
// phone+id match); the actual auto-link in /auth/add-tenant uses
// phoneVariants so it can still link a 07.../+254... variant.
router.get("/available-tenants", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         t.id, t.business_name, t.subdomain, t.brand_color,
         t.business_type, t.physical_address, t.city, t.county,
         EXISTS(
           SELECT 1 FROM clients c
           WHERE c.tenant_id = t.id
             AND c.phone_number = $1 AND c.id_number = $2
         ) AS is_existing_client
       FROM tenants t
       WHERE t.status = 'active'
         AND t.customer_portal_enabled = true
         AND t.allow_self_signup = true
         AND t.id NOT IN (
           SELECT tenant_id FROM customer_tenant_links
           WHERE platform_customer_id = $3 AND status = 'active'
         )
       ORDER BY is_existing_client DESC, t.business_name ASC`,
      [
        req.customer.phone_number,
        req.customer.id_number,
        req.platformCustomerId,
      ],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Available tenants error:", error);
    res.status(500).json({ error: "Failed to fetch available tenants" });
  }
});

// Public-style directory of EVERY active, portal-enabled lender on the
// platform, with each lender's borrowing terms so the customer can browse
// and filter (min/max amount, interest rate). is_linked / can_self_signup
// drive the contextual action on each card (Apply vs Add). No customer loan
// data here — that lives in "My Loans".
router.get("/lenders", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         t.id AS tenant_id,
         t.business_name, t.subdomain, t.brand_color, t.logo_url,
         t.business_type, t.city, t.county,
         COALESCE(t.default_interest_rate, 50.00) AS default_interest_rate,
         COALESCE(t.min_loan_amount,       1000)  AS min_amount,
         COALESCE(t.max_loan_amount,    1000000)  AS max_amount,
         COALESCE(t.default_loan_duration, 6)     AS default_duration,
         COALESCE(t.allow_self_signup, false)     AS can_self_signup,
         EXISTS(
           SELECT 1 FROM customer_tenant_links ctl
           WHERE ctl.tenant_id = t.id
             AND ctl.platform_customer_id = $1
             AND ctl.status = 'active'
         ) AS is_linked,
         (SELECT ctl.linked_at
            FROM customer_tenant_links ctl
           WHERE ctl.tenant_id = t.id
             AND ctl.platform_customer_id = $1
             AND ctl.status = 'active'
           LIMIT 1) AS linked_at
       FROM tenants t
       WHERE t.status = 'active'
         AND t.customer_portal_enabled = true
         -- Exclude the LoanFix platform owner and the demo sandbox — they
         -- are not real lenders a customer can borrow from.
         AND COALESCE(t.is_demo, false) = false
         AND COALESCE(t.plan, '') <> 'platform'
         AND t.subdomain NOT IN ('platform', 'demo')
       ORDER BY t.business_name ASC`,
      [req.platformCustomerId],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Lenders directory error:", error);
    res.status(500).json({ error: "Failed to fetch lenders" });
  }
});

// One lender's full profile + terms, plus this customer's link state and
// (when linked) their loan counts — the latter gates whether unlinking is
// allowed. Same platform/demo exclusions as the directory.
router.get("/lenders/:id", async (req, res) => {
  try {
    const tenantId = parseInt(req.params.id, 10);
    const r = await query(
      `SELECT
         t.id AS tenant_id,
         t.business_name, t.subdomain, t.brand_color, t.logo_url,
         t.business_type, t.physical_address, t.city, t.county,
         t.contact_email, t.contact_phone,
         COALESCE(t.default_interest_rate, 50.00) AS default_interest_rate,
         COALESCE(t.min_loan_amount,       1000)  AS min_amount,
         COALESCE(t.max_loan_amount,    1000000)  AS max_amount,
         COALESCE(t.default_loan_duration, 6)     AS default_duration,
         COALESCE(t.allow_self_signup, false)     AS can_self_signup
       FROM tenants t
       WHERE t.id = $1 AND t.status = 'active'
         AND t.customer_portal_enabled = true
         AND COALESCE(t.is_demo, false) = false
         AND COALESCE(t.plan, '') <> 'platform'
         AND t.subdomain NOT IN ('platform', 'demo')`,
      [tenantId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Lender not found" });
    }
    const lender = r.rows[0];

    const link = await query(
      `SELECT ctl.client_id, c.client_code, ctl.linked_at
         FROM customer_tenant_links ctl
         JOIN clients c ON ctl.client_id = c.id
        WHERE ctl.platform_customer_id = $1 AND ctl.tenant_id = $2
          AND ctl.status = 'active'`,
      [req.platformCustomerId, tenantId],
    );
    let extra = {
      is_linked: false,
      client_code: null,
      linked_at: null,
      active_loans: 0,
      pending_applications: 0,
      total_loans: 0,
    };
    if (link.rows.length > 0) {
      const counts = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active')::int AS active_loans,
           COUNT(*) FILTER (WHERE status IN ('pending','under_review','approved'))::int
             AS pending_applications,
           COUNT(*)::int AS total_loans
         FROM loans WHERE client_id = $1 AND tenant_id = $2`,
        [link.rows[0].client_id, tenantId],
      );
      extra = {
        is_linked: true,
        client_code: link.rows[0].client_code,
        linked_at: link.rows[0].linked_at,
        active_loans: counts.rows[0].active_loans,
        pending_applications: counts.rows[0].pending_applications,
        total_loans: counts.rows[0].total_loans,
      };
    }
    res.json({ success: true, data: { ...lender, ...extra } });
  } catch (error) {
    logger.error("Lender detail error:", error);
    res.status(500).json({ error: "Failed to fetch lender" });
  }
});

// Unlink the customer from a lender. Allowed only when they have NO active
// loans there. The link row is deleted (not deactivated) so the customer can
// re-link later via /auth/add-tenant, which rejects any existing link row.
router.delete("/lenders/:id/link", async (req, res) => {
  try {
    const tenantId = parseInt(req.params.id, 10);
    const link = await query(
      `SELECT client_id FROM customer_tenant_links
        WHERE platform_customer_id = $1 AND tenant_id = $2 AND status = 'active'`,
      [req.platformCustomerId, tenantId],
    );
    if (link.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "You are not linked to this lender" });
    }
    const clientId = link.rows[0].client_id;
    const counts = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status IN ('pending','under_review','approved'))::int
           AS pending
       FROM loans WHERE client_id = $1 AND tenant_id = $2`,
      [clientId, tenantId],
    );
    const { active, pending } = counts.rows[0];
    if (active > 0 || pending > 0) {
      const parts = [];
      if (active > 0)
        parts.push(`${active} active loan${active !== 1 ? "s" : ""}`);
      if (pending > 0)
        parts.push(
          `${pending} pending application${pending !== 1 ? "s" : ""}`,
        );
      return res.status(400).json({
        error: `You still have ${parts.join(
          " and ",
        )} with this lender. Resolve them before unlinking.`,
      });
    }
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'unlinked_tenant')`,
      [req.platformCustomerId, tenantId, clientId],
    );
    await query(
      `DELETE FROM customer_tenant_links
        WHERE platform_customer_id = $1 AND tenant_id = $2`,
      [req.platformCustomerId, tenantId],
    );
    res.json({ success: true, message: "Lender unlinked" });
  } catch (error) {
    logger.error("Unlink lender error:", error);
    res.status(500).json({ error: "Failed to unlink lender" });
  }
});

// ALL loans across ALL the customer's linked tenants. Authenticated
// as the platform customer (verifyCustomer); scoped strictly to the
// client_ids/tenant_ids the customer is actively linked to.
router.get("/all-loans", async (req, res) => {
  try {
    const { tenant_id, status, sort = "newest" } = req.query;

    const ORDER = {
      newest: "l.created_at DESC",
      oldest: "l.created_at ASC",
      highest_balance:
        "(l.total_amount_due - COALESCE((SELECT SUM(amount_paid) FROM transactions WHERE loan_id = l.id AND payment_status = 'completed'),0)) DESC",
      lowest_balance:
        "(l.total_amount_due - COALESCE((SELECT SUM(amount_paid) FROM transactions WHERE loan_id = l.id AND payment_status = 'completed'),0)) ASC",
    };
    const orderBy = ORDER[sort] || ORDER.newest;

    const links = await query(
      `SELECT client_id, tenant_id FROM customer_tenant_links
       WHERE platform_customer_id = $1 AND status = 'active'`,
      [req.platformCustomerId],
    );
    if (links.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          loans: [],
          summary: {
            total_loans: 0,
            total_active: 0,
            total_completed: 0,
            total_defaulted: 0,
            total_lenders: 0,
            total_balance: 0,
            by_tenant: [],
          },
        },
      });
    }
    const clientIds = links.rows.map((r) => r.client_id);
    const tenantIds = [...new Set(links.rows.map((r) => r.tenant_id))];

    // client_id (a global PK) already pins each loan to one of the
    // customer's own client records; the tenant_id filter is a
    // belt-and-braces guard.
    const params = [clientIds, tenantIds];
    let where =
      "l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])";
    if (tenant_id) {
      params.push(parseInt(tenant_id, 10));
      where += ` AND l.tenant_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      where += ` AND l.status = $${params.length}`;
    }

    const loans = await query(
      `SELECT
         l.*,
         t.business_name   AS tenant_name,
         t.subdomain       AS tenant_subdomain,
         t.brand_color     AS tenant_brand_color,
         c.client_code,
         COALESCE(SUM(tx.amount_paid),0) AS total_paid,
         (SELECT json_build_object(
            'amount_due', ps.amount_due,
            'due_date', ps.due_date,
            'payment_number', ps.payment_number)
          FROM payment_schedules ps
          WHERE ps.loan_id = l.id
            AND ps.status IN ('pending','overdue')
          ORDER BY ps.due_date ASC LIMIT 1) AS next_payment
       FROM loans l
       JOIN tenants t ON l.tenant_id = t.id
       JOIN clients c ON l.client_id = c.id
       LEFT JOIN transactions tx
         ON tx.loan_id = l.id AND tx.payment_status = 'completed'
       WHERE ${where}
       GROUP BY l.id, t.id, c.id
       ORDER BY ${orderBy}`,
      params,
    );

    const summary = (
      await query(
        `SELECT
           COUNT(*)::int AS total_loans,
           COUNT(*) FILTER (WHERE status='active')::int    AS total_active,
           COUNT(*) FILTER (WHERE status='completed')::int  AS total_completed,
           COUNT(*) FILTER (WHERE status='defaulted')::int  AS total_defaulted
         FROM loans
         WHERE client_id = ANY($1::int[]) AND tenant_id = ANY($2::int[])`,
        [clientIds, tenantIds],
      )
    ).rows[0];

    // Per-tenant: balance = active total_due − payments on ACTIVE
    // loans (so a completed loan's payments don't shrink the active
    // outstanding figure — the spec's LIMIT 1 / mixed-scope bug).
    const byTenant = (
      await query(
        `SELECT
           t.id AS tenant_id, t.business_name, t.subdomain, t.brand_color,
           COUNT(l.id)::int AS total_loans,
           COUNT(l.id) FILTER (WHERE l.status='active')::int AS active_loans,
           COALESCE(SUM(l.total_amount_due) FILTER (WHERE l.status='active'),0) AS total_due,
           COALESCE((
             SELECT SUM(tx.amount_paid)
             FROM transactions tx
             JOIN loans la ON tx.loan_id = la.id
             WHERE la.tenant_id = t.id
               AND la.client_id = ANY($1::int[])
               AND la.status = 'active'
               AND tx.payment_status = 'completed'
           ),0) AS total_paid
         FROM tenants t
         LEFT JOIN loans l
           ON l.tenant_id = t.id AND l.client_id = ANY($1::int[])
         WHERE t.id = ANY($2::int[])
         GROUP BY t.id
         ORDER BY active_loans DESC, t.business_name ASC`,
        [clientIds, tenantIds],
      )
    ).rows;

    const totalBalance = byTenant.reduce(
      (s, t) =>
        s + (parseFloat(t.total_due) - parseFloat(t.total_paid)),
      0,
    );

    res.json({
      success: true,
      data: {
        loans: loans.rows,
        summary: {
          ...summary,
          total_lenders: byTenant.length,
          total_balance: totalBalance,
          by_tenant: byTenant,
        },
      },
    });
  } catch (error) {
    logger.error("All loans error:", error);
    res.status(500).json({ error: "Failed to fetch all loans" });
  }
});

// Aggregate analytics for the customer dashboard: credit score (computed
// across ALL their lenders with the shared scoring algorithm), portfolio
// totals, payment behaviour, a 6-month repayment series, and a loan-status
// breakdown for charts. Tenant-less (scoped to the customer's active links).
router.get("/analytics", async (req, res) => {
  try {
    const links = await query(
      `SELECT client_id, tenant_id FROM customer_tenant_links
       WHERE platform_customer_id = $1 AND status = 'active'`,
      [req.platformCustomerId],
    );
    if (links.rows.length === 0) {
      return res.json({ success: true, data: { has_lenders: false } });
    }
    const clientIds = [...new Set(links.rows.map((r) => r.client_id))];
    const tenantIds = [...new Set(links.rows.map((r) => r.tenant_id))];
    const ids = [clientIds, tenantIds];

    const loanAgg = (
      await query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('active','completed','defaulted'))::int AS total_loans,
           COUNT(*) FILTER (WHERE status='active')::int    AS active_loans,
           COUNT(*) FILTER (WHERE status='completed')::int  AS completed_loans,
           COUNT(*) FILTER (WHERE status='defaulted')::int  AS defaulted_loans,
           COUNT(*) FILTER (WHERE status IN ('pending','under_review','approved'))::int AS pending_loans,
           COALESCE(SUM(principal_amount)
             FILTER (WHERE status IN ('active','completed','defaulted')),0) AS total_borrowed
         FROM loans
         WHERE client_id = ANY($1::int[]) AND tenant_id = ANY($2::int[])`,
        ids,
      )
    ).rows[0];

    const repaid = (
      await query(
        `SELECT
           COALESCE(SUM(t.amount_paid),0) AS total_repaid,
           COALESCE(SUM(
             t.amount_paid * (l.total_interest / NULLIF(l.total_amount_due,0))
           ),0) AS interest_paid
         FROM transactions t
         JOIN loans l ON t.loan_id = l.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND t.payment_status = 'completed'`,
        ids,
      )
    ).rows[0];

    const outstanding = (
      await query(
        `SELECT COALESCE(SUM(l.total_amount_due - COALESCE(p.paid,0)),0) AS outstanding
         FROM loans l
         LEFT JOIN (
           SELECT loan_id, SUM(amount_paid) AS paid
           FROM transactions WHERE payment_status='completed' GROUP BY loan_id
         ) p ON p.loan_id = l.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND l.status = 'active'`,
        ids,
      )
    ).rows[0].outstanding;

    const behavior = (
      await query(
        `SELECT
           COUNT(*) FILTER (
             WHERE ps.status='paid' AND ps.actual_payment_date IS NOT NULL
               AND ps.actual_payment_date <= ps.due_date)::int AS on_time,
           COUNT(*) FILTER (
             WHERE ps.status='paid' AND ps.actual_payment_date IS NOT NULL
               AND ps.actual_payment_date > ps.due_date)::int AS late,
           COUNT(*) FILTER (WHERE ps.status='overdue')::int AS missed
         FROM payment_schedules ps
         JOIN loans l ON ps.loan_id = l.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])`,
        ids,
      )
    ).rows[0];

    const monthly = (
      await query(
        `SELECT to_char(m, 'Mon') AS label,
                COALESCE(SUM(t.amount_paid),0) AS amount
         FROM generate_series(
           date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
           date_trunc('month', CURRENT_DATE),
           INTERVAL '1 month'
         ) m
         LEFT JOIN transactions t
           ON date_trunc('month', t.payment_date) = m
          AND t.payment_status='completed'
          AND t.loan_id IN (
            SELECT id FROM loans
            WHERE client_id = ANY($1::int[]) AND tenant_id = ANY($2::int[])
          )
         GROUP BY m ORDER BY m`,
        ids,
      )
    ).rows;

    // Repayment progress for each active loan (largest outstanding first).
    const loanProgress = (
      await query(
        `SELECT l.id, l.loan_code, l.total_amount_due,
                COALESCE(p.paid,0) AS total_paid,
                tn.id AS tenant_id, tn.business_name AS lender, tn.brand_color
         FROM loans l
         JOIN tenants tn ON l.tenant_id = tn.id
         LEFT JOIN (
           SELECT loan_id, SUM(amount_paid) AS paid
           FROM transactions WHERE payment_status='completed' GROUP BY loan_id
         ) p ON p.loan_id = l.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND l.status = 'active'
         ORDER BY (l.total_amount_due - COALESCE(p.paid,0)) DESC
         LIMIT 6`,
        ids,
      )
    ).rows.map((r) => ({
      loan_id: r.id,
      loan_code: r.loan_code,
      lender: r.lender,
      brand_color: r.brand_color,
      tenant_id: r.tenant_id,
      total_due: parseFloat(r.total_amount_due),
      paid: parseFloat(r.total_paid),
    }));

    const totalPayments = behavior.on_time + behavior.late;
    const onTimeRate =
      totalPayments > 0
        ? parseFloat(((behavior.on_time / totalPayments) * 100).toFixed(1))
        : 100;

    const metrics = {
      defaulted_loans_count: loanAgg.defaulted_loans,
      current_overdue_count: behavior.missed,
      late_payments: behavior.late,
      total_payments: totalPayments,
      on_time_rate: onTimeRate,
      completed_loans_count: loanAgg.completed_loans,
    };
    // New borrowers stay on a neutral baseline until their first payment.
    const rated = isRated(metrics);
    const creditScore = rated ? calculateCreditScore(metrics) : null;
    const risk = rated
      ? getRiskLevel(creditScore, loanAgg.defaulted_loans > 0, behavior.missed > 0)
      : { level: "unrated", label: "🆕 Building credit", color: "slate" };

    const statusBreakdown = [
      { status: "active", count: loanAgg.active_loans },
      { status: "completed", count: loanAgg.completed_loans },
      { status: "defaulted", count: loanAgg.defaulted_loans },
      { status: "pending", count: loanAgg.pending_loans },
    ].filter((s) => s.count > 0);

    res.json({
      success: true,
      data: {
        has_lenders: true,
        rated,
        credit_score: creditScore,
        risk,
        stats: {
          total_borrowed: parseFloat(loanAgg.total_borrowed),
          total_repaid: parseFloat(repaid.total_repaid),
          interest_paid: parseFloat(repaid.interest_paid),
          outstanding: parseFloat(outstanding),
          total_loans: loanAgg.total_loans,
          active_loans: loanAgg.active_loans,
          completed_loans: loanAgg.completed_loans,
          defaulted_loans: loanAgg.defaulted_loans,
          pending_loans: loanAgg.pending_loans,
          lenders: tenantIds.length,
          on_time_rate: onTimeRate,
          on_time: behavior.on_time,
          late: behavior.late,
          missed: behavior.missed,
          total_payments: totalPayments,
        },
        monthly_repayments: monthly.map((r) => ({
          label: r.label,
          amount: parseFloat(r.amount),
        })),
        loan_progress: loanProgress,
        status_breakdown: statusBreakdown,
      },
    });
  } catch (error) {
    logger.error("Customer analytics error:", error);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// Every completed payment the customer has made, across all their lenders.
router.get("/payments", async (req, res) => {
  try {
    const links = await query(
      `SELECT client_id, tenant_id FROM customer_tenant_links
       WHERE platform_customer_id = $1 AND status = 'active'`,
      [req.platformCustomerId],
    );
    if (links.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const clientIds = [...new Set(links.rows.map((r) => r.client_id))];
    const tenantIds = [...new Set(links.rows.map((r) => r.tenant_id))];
    const r = await query(
      `SELECT
         t.id, t.transaction_code, t.amount_paid, t.payment_date,
         t.payment_method, t.payment_reference,
         l.id AS loan_id, l.loan_code,
         tn.id AS tenant_id, tn.business_name AS tenant_name,
         tn.brand_color AS tenant_brand_color
       FROM transactions t
       JOIN loans l ON t.loan_id = l.id
       JOIN tenants tn ON t.tenant_id = tn.id
       WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
         AND t.payment_status = 'completed'
       ORDER BY t.payment_date DESC, t.id DESC`,
      [clientIds, tenantIds],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Customer payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
});

// Derived notification feed for the customer: recent payments, application
// decisions, disbursals and overdue alerts across all lenders. Read-only;
// the client tracks "seen" locally for the unread badge.
router.get("/notifications", async (req, res) => {
  try {
    const links = await query(
      `SELECT client_id, tenant_id FROM customer_tenant_links
       WHERE platform_customer_id = $1 AND status = 'active'`,
      [req.platformCustomerId],
    );
    if (links.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const clientIds = [...new Set(links.rows.map((r) => r.client_id))];
    const tenantIds = [...new Set(links.rows.map((r) => r.tenant_id))];
    const r = await query(
      `SELECT * FROM (
         SELECT 'payment' AS type, l.loan_code, t.amount_paid AS amount,
                tn.business_name AS lender, tn.brand_color AS brand_color,
                tn.id AS tenant_id, l.id AS loan_id, t.payment_date::timestamp AS at
         FROM transactions t
         JOIN loans l ON t.loan_id = l.id
         JOIN tenants tn ON t.tenant_id = tn.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND t.payment_status = 'completed'
         UNION ALL
         SELECT 'approved', l.loan_code, l.principal_amount,
                tn.business_name, tn.brand_color, tn.id, l.id, l.approved_at
         FROM loans l JOIN tenants tn ON l.tenant_id = tn.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND l.status = 'approved' AND l.approved_at IS NOT NULL
         UNION ALL
         SELECT 'disbursed', l.loan_code, l.principal_amount,
                tn.business_name, tn.brand_color, tn.id, l.id, l.disbursed_at
         FROM loans l JOIN tenants tn ON l.tenant_id = tn.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND l.disbursed_at IS NOT NULL
         UNION ALL
         SELECT 'rejected', l.loan_code, NULL,
                tn.business_name, tn.brand_color, tn.id, l.id, l.rejected_at
         FROM loans l JOIN tenants tn ON l.tenant_id = tn.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND l.status = 'rejected' AND l.rejected_at IS NOT NULL
         UNION ALL
         SELECT 'overdue', l.loan_code,
                (ps.amount_due - COALESCE(ps.amount_paid,0)) AS amount,
                tn.business_name, tn.brand_color, tn.id, l.id, ps.due_date::timestamp
         FROM payment_schedules ps
         JOIN loans l ON ps.loan_id = l.id
         JOIN tenants tn ON l.tenant_id = tn.id
         WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
           AND ps.status = 'overdue'
       ) ev
       WHERE ev.at IS NOT NULL
       ORDER BY ev.at DESC
       LIMIT 25`,
      [clientIds, tenantIds],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Customer notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Dashboard for the currently selected tenant
router.get("/dashboard", async (req, res) => {
  try {
    if (!req.currentTenantId) {
      return res.status(400).json({ error: "No tenant selected" });
    }
    const cid = req.currentClientId;
    const tid = req.currentTenantId;

    const loans = await query(
      `SELECT l.*, COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.client_id = $1 AND l.tenant_id = $2 AND l.status = 'active'
       GROUP BY l.id ORDER BY l.created_at DESC`,
      [cid, tid],
    );
    const nextPayment = await query(
      `SELECT ps.*, l.loan_code
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.client_id = $1 AND l.tenant_id = $2
         AND ps.status IN ('pending','overdue')
       ORDER BY ps.due_date ASC LIMIT 1`,
      [cid, tid],
    );
    const stats = await query(
      `SELECT
         COUNT(*) AS total_loans,
         COUNT(*) FILTER (WHERE status='active') AS active_loans,
         COUNT(*) FILTER (WHERE status='completed') AS completed_loans,
         COALESCE(SUM(total_amount_due) FILTER (WHERE status='active'),0) AS active_total_due
       FROM loans WHERE client_id = $1 AND tenant_id = $2`,
      [cid, tid],
    );
    const client = await query("SELECT * FROM clients WHERE id = $1", [cid]);
    const tenant = await query(
      "SELECT business_name, subdomain, brand_color FROM tenants WHERE id = $1",
      [tid],
    );
    const applications = await query(
      `SELECT id, loan_code, principal_amount, status, application_date
       FROM loans
       WHERE client_id = $1 AND tenant_id = $2
         AND status IN ('pending','under_review','approved','rejected')
       ORDER BY application_date DESC LIMIT 5`,
      [cid, tid],
    );

    await query(
      `INSERT INTO customer_activities (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'viewed_dashboard')`,
      [req.platformCustomerId, tid, cid],
    );

    res.json({
      success: true,
      data: {
        customer: req.customer,
        tenant: tenant.rows[0],
        client: client.rows[0],
        active_loans: loans.rows,
        next_payment: nextPayment.rows[0] || null,
        stats: stats.rows[0],
        pending_applications: applications.rows,
      },
    });
  } catch (error) {
    logger.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/loans", async (req, res) => {
  try {
    const params = [req.currentClientId, req.currentTenantId];
    let statusClause = "";
    if (req.query.status) {
      params.push(req.query.status);
      statusClause = ` AND l.status = $${params.length}`;
    }
    const r = await query(
      `SELECT l.*, COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.client_id = $1 AND l.tenant_id = $2${statusClause}
       GROUP BY l.id ORDER BY l.created_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Customer loans error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/loans/:id", async (req, res) => {
  try {
    const loan = await query(
      `SELECT l.*,
              c.first_name AS client_first_name,
              c.last_name  AS client_last_name,
              c.phone_number AS client_phone,
              COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       JOIN clients c ON l.client_id = c.id
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.id = $1 AND l.client_id = $2 AND l.tenant_id = $3
       GROUP BY l.id, c.id`,
      [req.params.id, req.currentClientId, req.currentTenantId],
    );
    if (loan.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const schedule = await query(
      "SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
      [req.params.id],
    );
    const txns = await query(
      `SELECT * FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'
       ORDER BY payment_date DESC`,
      [req.params.id],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'viewed_loan',$4)`,
      [
        req.platformCustomerId,
        req.currentTenantId,
        req.currentClientId,
        JSON.stringify({ loan_id: req.params.id }),
      ],
    );
    // Annotate each transaction with running balance / % complete +
    // build the loan-level receipt_summary. Same shape as the staff
    // /payments/loan/:id/summary endpoint so the portal frontend can
    // share rendering logic.
    const loanRow = loan.rows[0];
    const totalDue = parseFloat(loanRow.total_amount_due);
    const totalPaid = parseFloat(loanRow.total_paid || 0);
    const balance = Math.max(0, totalDue - totalPaid);

    const ascTxns = [...txns.rows].reverse();
    let running = 0;
    const annotated = ascTxns.map((t) => {
      running += parseFloat(t.amount_paid || 0);
      const remaining = Math.max(0, totalDue - running);
      return {
        ...t,
        receipt: {
          total_paid_after_this: running,
          remaining_balance_after_this: remaining,
          completion_percentage_after_this:
            totalDue > 0 ? ((running / totalDue) * 100).toFixed(1) : "0",
        },
      };
    });
    const transactionsWithReceipt = annotated.reverse();

    const nextPayment = schedule.rows.find((s) => s.status === "pending");

    res.json({
      success: true,
      data: {
        loan: loanRow,
        schedule: schedule.rows,
        transactions: transactionsWithReceipt,
        receipt_summary: {
          total_paid: totalPaid,
          remaining_balance: balance,
          is_fully_paid: balance === 0,
          next_payment_number: nextPayment?.payment_number || null,
          next_payment_amount: nextPayment
            ? Math.max(
                0,
                parseFloat(nextPayment.amount_due) -
                  parseFloat(nextPayment.amount_paid || 0),
              )
            : 0,
          next_payment_date: nextPayment?.due_date || null,
          completion_percentage:
            totalDue > 0
              ? ((Math.min(totalPaid, totalDue) / totalDue) * 100).toFixed(1)
              : "0",
        },
      },
    });
  } catch (error) {
    logger.error("Customer loan detail error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Profile: global (platform_customers, safe fields — never
// password_hash/otp) + the client record at the currently-selected
// tenant. Shape: { customer, client }.
router.get("/profile", async (req, res) => {
  try {
    const c = req.customer;
    const customer = {
      id: c.id,
      phone_number: c.phone_number,
      email: c.email,
      id_number: c.id_number,
      first_name: c.first_name,
      last_name: c.last_name,
      date_of_birth: c.date_of_birth,
      gender: c.gender,
      profile_photo_url: c.profile_photo_url,
      phone_verified: c.phone_verified,
      email_verified: c.email_verified,
      created_at: c.created_at,
    };
    let client = null;
    if (req.currentClientId) {
      const cr = await query(
        `SELECT cl.*, t.business_name AS tenant_name
         FROM clients cl
         JOIN tenants t ON cl.tenant_id = t.id
         WHERE cl.id = $1 AND cl.tenant_id = $2`,
        [req.currentClientId, req.currentTenantId],
      );
      client = cr.rows[0] || null;
    }
    res.json({ success: true, data: { customer, client } });
  } catch (error) {
    logger.error("Get profile error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const {
      email,
      date_of_birth,
      gender,
      address,
      city,
      county,
      business_type,
      business_name,
    } = req.body;

    // Global (platform_customers)
    await query(
      `UPDATE platform_customers SET
         email = COALESCE($1,email),
         date_of_birth = COALESCE($2,date_of_birth),
         gender = COALESCE($3,gender),
         updated_at = NOW()
       WHERE id = $4`,
      [
        email || null,
        date_of_birth || null,
        gender || null,
        req.platformCustomerId,
      ],
    );

    // Tenant-specific (clients) — scoped to the current tenant.
    if (req.currentClientId) {
      await query(
        `UPDATE clients SET
           email = COALESCE($1,email),
           address = COALESCE($2,address),
           city = COALESCE($3,city),
           county = COALESCE($4,county),
           business_type = COALESCE($5,business_type),
           business_name = COALESCE($6,business_name),
           updated_at = NOW()
         WHERE id = $7 AND tenant_id = $8`,
        [
          email || null,
          address || null,
          city || null,
          county || null,
          business_type || null,
          business_name || null,
          req.currentClientId,
          req.currentTenantId,
        ],
      );
    }

    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'profile_updated')`,
      [req.platformCustomerId, req.currentTenantId, req.currentClientId],
    );

    res.json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    logger.error("Profile update error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Change password (logged-in customer). Enforces the SAME
// validatePassword policy as portal reset-password / staff users
// (>=12 chars, uppercase, digit, special) — deliberately stricter
// than the spec's 6-char rule, which the backend would reject anyway.
router.post("/change-password", async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Both passwords required" });
    }
    if (!validatePassword(new_password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }

    const r = await query(
      "SELECT password_hash FROM platform_customers WHERE id = $1",
      [req.platformCustomerId],
    );
    const ok = await bcryptjs.compare(
      current_password,
      r.rows[0]?.password_hash || "",
    );
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Current password is incorrect" });
    }

    const hash = await bcryptjs.hash(new_password, 10);
    await query(
      "UPDATE platform_customers SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [hash, req.platformCustomerId],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'password_changed')`,
      [req.platformCustomerId, req.currentTenantId, req.currentClientId],
    );

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    logger.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// ── Customer loan applications ────────────────────────────────
// Floor for guarantor/collateral/max-pending policy (no per-tenant
// table for these yet). Rate / amount / duration now come from
// tenants columns added in migration 012.
const LOAN_POLICY = {
  min_amount: 1000,
  max_amount: 1000000,
  min_duration: 1,
  max_duration: 24,
  default_interest_rate: 50.0, // annual % — fallback if DB read fails
  require_guarantor: false,
  require_collateral: false,
  max_pending_applications: 3,
};

router.get("/tenant-policy", async (req, res) => {
  try {
    const t = await query(
      `SELECT business_name, brand_color,
              COALESCE(default_interest_rate, 50.00) AS default_interest_rate,
              COALESCE(min_loan_amount,       1000)  AS min_amount,
              COALESCE(max_loan_amount,    1000000)  AS max_amount,
              COALESCE(default_loan_duration, 6)     AS default_duration
         FROM tenants WHERE id = $1`,
      [req.currentTenantId],
    );
    const row = t.rows[0] || {};
    res.json({
      success: true,
      data: {
        tenant: { business_name: row.business_name, brand_color: row.brand_color },
        policy: {
          ...LOAN_POLICY,
          min_amount: parseFloat(row.min_amount ?? LOAN_POLICY.min_amount),
          max_amount: parseFloat(row.max_amount ?? LOAN_POLICY.max_amount),
          default_interest_rate: parseFloat(
            row.default_interest_rate ?? LOAN_POLICY.default_interest_rate,
          ),
          default_duration: parseInt(row.default_duration ?? 6, 10),
        },
      },
    });
  } catch (error) {
    logger.error("Tenant policy error:", error);
    res.status(500).json({ error: "Failed to fetch tenant policy" });
  }
});

router.post("/applications", async (req, res) => {
  try {
    const {
      principal_amount,
      loan_duration_months,
      annual_interest_rate,
      purpose,
      guarantor_name,
      guarantor_phone,
      guarantor_id_number,
      collateral_description,
      review_notes,
    } = req.body || {};

    if (!principal_amount || !loan_duration_months || !purpose) {
      return res
        .status(400)
        .json({ error: "Amount, duration, and purpose are required" });
    }
    const principal = parseFloat(principal_amount);
    const months = parseInt(loan_duration_months, 10);
    if (!(principal >= LOAN_POLICY.min_amount)) {
      return res.status(400).json({
        error: `Minimum loan amount is KES ${LOAN_POLICY.min_amount.toLocaleString()}`,
      });
    }
    if (principal > LOAN_POLICY.max_amount) {
      return res.status(400).json({
        error: `Maximum loan amount is KES ${LOAN_POLICY.max_amount.toLocaleString()}`,
      });
    }
    if (
      !(
        months >= LOAN_POLICY.min_duration &&
        months <= LOAN_POLICY.max_duration
      )
    ) {
      return res.status(400).json({
        error: `Duration must be between ${LOAN_POLICY.min_duration}-${LOAN_POLICY.max_duration} months`,
      });
    }

    const pending = await query(
      `SELECT COUNT(*) AS count FROM loans
       WHERE client_id = $1 AND tenant_id = $2
         AND status IN ('pending','under_review','approved')`,
      [req.currentClientId, req.currentTenantId],
    );
    if (
      parseInt(pending.rows[0].count, 10) >=
      LOAN_POLICY.max_pending_applications
    ) {
      return res.status(429).json({
        error: `You already have ${LOAN_POLICY.max_pending_applications} pending applications. Please wait for them to be processed.`,
      });
    }

    // App convention: interest_rate is the MONTHLY rate as a percent
    // (annual % = interest_rate * 12). Store annual/12; do money math
    // with the fraction so totals match the portal calculator.
    const annualRate =
      parseFloat(annual_interest_rate) || LOAN_POLICY.default_interest_rate;
    const monthlyPct = parseFloat((annualRate / 12).toFixed(4));
    const monthlyFraction = annualRate / 100 / 12;
    const totalInterest = parseFloat(
      (principal * monthlyFraction * months).toFixed(2),
    );
    const totalAmountDue = parseFloat(
      (principal + totalInterest).toFixed(2),
    );

    // Canonical loan_code (LN-<PREFIX>-<YEAR>-<NNNNN>) via shared
    // helper — same code generator the staff loans.js uses, so
    // customer apps remain indistinguishable in the shared queue.
    const loanCode = await nextLoanCode(query, req.currentTenantId);

    const result = await query(
      `INSERT INTO loans (
         tenant_id, loan_code, client_id, principal_amount, interest_rate,
         loan_duration_months, total_amount_due, total_interest,
         status, purpose,
         guarantor_name, guarantor_phone, guarantor_id_number,
         collateral_description, late_payment_fee, penalty_rate,
         application_date, application_source, review_notes,
         submitted_by_customer, platform_customer_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,500,5.00,
         NOW()::date,'customer_portal',$14,true,$15,NULL)
       RETURNING id, loan_code, status, principal_amount,
                 total_amount_due, loan_duration_months`,
      [
        req.currentTenantId,
        loanCode,
        req.currentClientId,
        principal,
        monthlyPct,
        months,
        totalAmountDue,
        totalInterest,
        purpose,
        guarantor_name || null,
        guarantor_phone || null,
        guarantor_id_number || null,
        collateral_description || null,
        review_notes || null,
        req.platformCustomerId,
      ],
    );
    const loan = result.rows[0];

    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'submitted_application',$4)`,
      [
        req.platformCustomerId,
        req.currentTenantId,
        req.currentClientId,
        JSON.stringify({
          loan_id: loan.id,
          loan_code: loan.loan_code,
          amount: principal,
          months,
        }),
      ],
    );

    // Fire SMS + email via the central dispatcher. Per-tenant prefs
    // gate each channel; sms_logs and email_logs get written.
    try {
      const meta = await query(
        `SELECT pc.phone_number, pc.first_name, pc.last_name, pc.email
           FROM platform_customers pc WHERE pc.id = $1`,
        [req.platformCustomerId],
      );
      const c = meta.rows[0];
      if (c) {
        notificationDispatcher
          .notify("application_submitted", {
            tenantId: req.currentTenantId,
            customer: { ...c, client_id: req.currentClientId },
            data: {
              loan_id: loan.id,
              loan_code: loan.loan_code,
              amount: principal,
              duration_months: months,
            },
          })
          .catch((err) => logger.error("notify error:", err));
      }
    } catch (err) {
      logger.error("Application notification error:", err);
    }

    res.status(201).json({
      success: true,
      message:
        "✅ Application submitted! The lender will review it shortly.",
      data: {
        loan_id: loan.id,
        loan_code: loan.loan_code,
        status: loan.status,
        principal_amount: principal,
        total_amount_due: totalAmountDue,
        duration_months: months,
      },
    });
  } catch (error) {
    logger.error("Customer application error:", error);
    res.status(500).json({ error: "Failed to submit application" });
  }
});

router.get("/applications", async (req, res) => {
  try {
    const r = await query(
      `SELECT l.*,
              ur.first_name AS reviewer_name,
              ua.first_name AS approver_name
       FROM loans l
       LEFT JOIN users ur ON l.reviewed_by = ur.id
       LEFT JOIN users ua ON l.approved_by = ua.id
       WHERE l.client_id = $1 AND l.tenant_id = $2
         AND l.status IN ('pending','under_review','approved','rejected')
       ORDER BY l.application_date DESC NULLS LAST, l.created_at DESC`,
      [req.currentClientId, req.currentTenantId],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Get applications error:", error);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

// Applications across ALL the customer's lenders (tenant-less). Mirrors
// /all-loans' link gathering so "My Applications" works without a lender
// being selected. Each row carries its lender (tenant_*) for display.
router.get("/all-applications", async (req, res) => {
  try {
    const links = await query(
      `SELECT client_id, tenant_id FROM customer_tenant_links
       WHERE platform_customer_id = $1 AND status = 'active'`,
      [req.platformCustomerId],
    );
    if (links.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const clientIds = links.rows.map((r) => r.client_id);
    const tenantIds = [...new Set(links.rows.map((r) => r.tenant_id))];
    const r = await query(
      `SELECT l.*,
              t.business_name AS tenant_name,
              t.subdomain     AS tenant_subdomain,
              t.brand_color   AS tenant_brand_color,
              ur.first_name   AS reviewer_name,
              ua.first_name   AS approver_name
       FROM loans l
       JOIN tenants t ON l.tenant_id = t.id
       LEFT JOIN users ur ON l.reviewed_by = ur.id
       LEFT JOIN users ua ON l.approved_by = ua.id
       WHERE l.client_id = ANY($1::int[]) AND l.tenant_id = ANY($2::int[])
         AND l.status IN ('pending','under_review','approved','rejected')
       ORDER BY l.application_date DESC NULLS LAST, l.created_at DESC`,
      [clientIds, tenantIds],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Get all applications error:", error);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});

router.delete("/applications/:id", async (req, res) => {
  try {
    const lr = await query(
      `SELECT * FROM loans
       WHERE id = $1 AND client_id = $2 AND tenant_id = $3`,
      [req.params.id, req.currentClientId, req.currentTenantId],
    );
    if (lr.rows.length === 0) {
      return res.status(404).json({ error: "Application not found" });
    }
    const loan = lr.rows[0];
    if (loan.status !== "pending") {
      return res.status(400).json({
        error: `Cannot cancel application with status: ${loan.status}`,
      });
    }
    await query(
      `UPDATE loans
       SET status = 'rejected',
           rejection_reason = 'Cancelled by customer',
           rejected_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.currentTenantId],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'cancelled_application',$4)`,
      [
        req.platformCustomerId,
        req.currentTenantId,
        req.currentClientId,
        JSON.stringify({ loan_id: req.params.id, loan_code: loan.loan_code }),
      ],
    );
    res.json({ success: true, message: "Application cancelled" });
  } catch (error) {
    logger.error("Cancel application error:", error);
    res.status(500).json({ error: "Failed to cancel application" });
  }
});

// One row per active customer-tenant link, with the loan policy
// each tenant has configured (migration 012 added the columns).
// COALESCE keeps the endpoint working for any tenant row that
// pre-dates the migration's backfill.
router.get("/calculator-policies", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         t.id AS tenant_id,
         t.business_name, t.subdomain, t.brand_color, t.logo_url,
         c.client_code,
         COALESCE(t.default_interest_rate, 50.00) AS default_interest_rate,
         COALESCE(t.min_loan_amount,       1000)  AS min_amount,
         COALESCE(t.max_loan_amount,    1000000)  AS max_amount,
         24                                       AS max_duration_months,
         COALESCE(t.default_loan_duration, 6)     AS default_duration_months
       FROM customer_tenant_links ctl
       JOIN tenants t ON ctl.tenant_id = t.id
       JOIN clients c ON ctl.client_id = c.id
       WHERE ctl.platform_customer_id = $1
         AND ctl.status = 'active'
       ORDER BY t.business_name`,
      [req.platformCustomerId],
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Calculator policies error:", error);
    res.status(500).json({ error: "Failed to fetch policies" });
  }
});

// Stream a PDF buffer as an attachment (mirrors reports.js servePdf).
const sendPdf = (res, buffer, filename) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`,
  );
  res.send(buffer);
};

// Full account statement (all loans at the current tenant). The
// builder is scoped to (clientId, tenantId); currentClientId is the
// customer's OWN client at the selected tenant, so this is inherently
// self-scoped.
router.get("/statement", async (req, res) => {
  try {
    const { buffer, filename } = await buildClientStatementPdf(
      req.currentClientId,
      req.currentTenantId,
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'downloaded_statement')`,
      [req.platformCustomerId, req.currentTenantId, req.currentClientId],
    );
    sendPdf(res, buffer, filename);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    logger.error("Customer statement error:", error);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// Per-loan statement. The PDF builder scopes by tenant only, so we
// FIRST verify the loan is this customer's own (client_id +
// tenant_id) — otherwise a customer could pull another customer's
// same-tenant loan statement.
router.get("/loans/:id/statement", async (req, res) => {
  try {
    const owns = await query(
      `SELECT 1 FROM loans
       WHERE id = $1 AND client_id = $2 AND tenant_id = $3`,
      [req.params.id, req.currentClientId, req.currentTenantId],
    );
    if (owns.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const { buffer, filename } = await buildLoanStatementPdf(
      req.params.id,
      req.currentTenantId,
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'downloaded_statement',$4)`,
      [
        req.platformCustomerId,
        req.currentTenantId,
        req.currentClientId,
        JSON.stringify({ loan_id: req.params.id }),
      ],
    );
    sendPdf(res, buffer, filename);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    logger.error("Customer loan statement error:", error);
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

export default router;
