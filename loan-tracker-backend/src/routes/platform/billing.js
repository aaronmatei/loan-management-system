import express from "express";
import { query } from "../../config/database.js";
import { verifyToken } from "../../middleware/auth.js";
import logger from "../../config/logger.js";
import * as billingService from "../../services/billingService.js";

const router = express.Router();

const requirePlatformAdmin = (req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res
      .status(403)
      .json({ error: "Platform admin access required" });
  }
  next();
};

router.use(verifyToken, requirePlatformAdmin);

// List invoices (filterable)
router.get("/invoices", async (req, res) => {
  try {
    const { status, tenant_id, year, month } = req.query;
    let q = `
      SELECT i.*,
             t.business_name AS tenant_name,
             t.subdomain     AS tenant_subdomain,
             t.brand_color   AS tenant_brand_color
      FROM invoices i
      JOIN tenants t ON i.tenant_id = t.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      params.push(status);
      q += ` AND i.status = $${params.length}`;
    }
    if (tenant_id) {
      params.push(parseInt(tenant_id, 10));
      q += ` AND i.tenant_id = $${params.length}`;
    }
    if (year) {
      params.push(parseInt(year, 10));
      q += ` AND i.billing_year = $${params.length}`;
    }
    if (month) {
      params.push(parseInt(month, 10));
      q += ` AND i.billing_month = $${params.length}`;
    }
    q += ` ORDER BY i.created_at DESC LIMIT 100`;
    const result = await query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("List invoices error:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Invoice detail
router.get("/invoices/:id", async (req, res) => {
  try {
    const inv = await query(
      `SELECT i.*,
              t.business_name  AS tenant_name,
              t.subdomain      AS tenant_subdomain,
              t.contact_email  AS tenant_contact_email,
              t.contact_phone  AS tenant_contact_phone
       FROM invoices i
       JOIN tenants t ON i.tenant_id = t.id
       WHERE i.id = $1`,
      [req.params.id],
    );
    if (inv.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const payments = await query(
      `SELECT ip.*,
              u.first_name || ' ' || u.last_name AS recorded_by_name
       FROM invoice_payments ip
       LEFT JOIN users u ON ip.recorded_by_user_id = u.id
       WHERE ip.invoice_id = $1
       ORDER BY ip.payment_date DESC, ip.id DESC`,
      [req.params.id],
    );
    res.json({
      success: true,
      data: { invoice: inv.rows[0], payments: payments.rows },
    });
  } catch (error) {
    logger.error("Get invoice error:", error);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// Generate invoice for a specific tenant/period
router.post("/invoices/generate", async (req, res) => {
  try {
    const { tenant_id, year, month } = req.body || {};
    if (!tenant_id || !year || !month) {
      return res
        .status(400)
        .json({ error: "tenant_id, year, and month are required" });
    }
    const invoice = await billingService.generateInvoice(
      parseInt(tenant_id, 10),
      parseInt(year, 10),
      parseInt(month, 10),
      req.user.id,
    );
    res.status(201).json({
      success: true,
      message: "Invoice generated successfully",
      data: invoice,
    });
  } catch (error) {
    logger.error("Generate invoice error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Generate invoices for ALL billable tenants for the previous month
router.post("/invoices/generate-monthly", async (req, res) => {
  try {
    const results = await billingService.generateMonthlyInvoices(req.user.id);
    res.json({
      success: true,
      message: "Monthly invoices generation complete",
      data: results,
    });
  } catch (error) {
    logger.error("Generate monthly invoices error:", error);
    res.status(500).json({ error: "Failed to generate invoices" });
  }
});

// Record a payment on an invoice
router.post("/invoices/:id/payments", async (req, res) => {
  try {
    const { amount, payment_method, payment_reference, payment_date } =
      req.body || {};
    if (!amount || !payment_method) {
      return res
        .status(400)
        .json({ error: "Amount and payment method required" });
    }
    const updated = await billingService.markInvoicePaid(
      req.params.id,
      { amount, payment_method, payment_reference, payment_date },
      req.user.id,
    );
    res.json({
      success: true,
      message: "Payment recorded successfully",
      data: updated,
    });
  } catch (error) {
    logger.error("Record payment error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Preview what an invoice WOULD cost
router.get("/preview/:tenant_id", async (req, res) => {
  try {
    const tenantId = parseInt(req.params.tenant_id, 10);
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month) {
      return res.status(400).json({ error: "Year and month required" });
    }
    const calc = await billingService.calculateTenantInterest(
      tenantId,
      year,
      month,
    );
    const tr = await query("SELECT * FROM tenants WHERE id = $1", [
      tenantId,
    ]);
    if (tr.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const tenant = tr.rows[0];
    const feePct = parseFloat(tenant.billing_fee_percentage);
    const interestFee = parseFloat(
      (calc.interest_earned * (feePct / 100)).toFixed(2),
    );
    const baseFee = parseFloat(tenant.billing_base_fee);
    const totalAmount = parseFloat((interestFee + baseFee).toFixed(2));
    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          business_name: tenant.business_name,
          billing_enabled: tenant.billing_enabled,
          fee_percentage: feePct,
          base_fee: baseFee,
        },
        period: { year, month, ...calc },
        calculation: {
          interest_earned: calc.interest_earned,
          fee_percentage: feePct,
          interest_fee: interestFee,
          base_fee: baseFee,
          total_amount: totalAmount,
        },
      },
    });
  } catch (error) {
    logger.error("Preview billing error:", error);
    res.status(500).json({ error: "Failed to preview billing" });
  }
});

// Per-tenant monthly billing statement. For every calendar month the tenant
// collected interest, shows what they're SUPPOSED to pay (platform fee on
// that month's interest + base fee) vs what's actually been invoiced/paid —
// so historical months that were never invoiced still surface with their
// owed/outstanding amount.
router.get("/tenant/:tenantId/monthly", async (req, res) => {
  try {
    const tenantId = parseInt(req.params.tenantId, 10);
    if (!tenantId) return res.status(400).json({ error: "Invalid tenant id" });

    const tr = await query(
      `SELECT id, business_name, subdomain, brand_color,
              billing_fee_percentage, billing_base_fee, billing_enabled
         FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tr.rows.length === 0)
      return res.status(404).json({ error: "Tenant not found" });
    const tenant = tr.rows[0];
    const feePct = parseFloat(tenant.billing_fee_percentage || 0);
    const baseFee = parseFloat(tenant.billing_base_fee || 0);

    // Interest earned per calendar month — same split convention as
    // calculateTenantInterest/generateInvoice — LEFT JOINed to the invoice
    // (if any) raised for that billing period.
    const rows = await query(
      `WITH monthly AS (
         SELECT EXTRACT(YEAR  FROM t.payment_date)::int AS year,
                EXTRACT(MONTH FROM t.payment_date)::int AS month,
                COALESCE(SUM(
                  t.amount_paid * (l.total_interest / NULLIF(l.total_amount_due, 0))
                ), 0) AS interest_earned,
                COUNT(DISTINCT t.id)::int AS payment_count
         FROM transactions t
         JOIN loans l ON l.id = t.loan_id
         WHERE t.tenant_id = $1 AND t.payment_status = 'completed'
         GROUP BY 1, 2
       )
       SELECT m.year, m.month, m.interest_earned::float AS interest_earned,
              m.payment_count,
              inv.id AS invoice_id, inv.invoice_number,
              inv.status AS invoice_status,
              COALESCE(inv.total_amount, 0)::float AS invoiced_amount,
              COALESCE(inv.amount_paid, 0)::float   AS amount_paid,
              inv.due_date
       FROM monthly m
       LEFT JOIN invoices inv
         ON inv.tenant_id = $1
        AND inv.billing_year = m.year
        AND inv.billing_month = m.month
       ORDER BY m.year DESC, m.month DESC`,
      [tenantId],
    );

    const round2 = (n) => Math.round(n * 100) / 100;
    const months = rows.rows.map((r) => {
      const interest = parseFloat(r.interest_earned) || 0;
      const expectedFee = round2(interest * (feePct / 100) + baseFee);
      const invoiced = !!r.invoice_id;
      // Supposed to pay = the actual invoice total once raised, else the
      // computed expected fee for that month.
      const supposed = invoiced ? parseFloat(r.invoiced_amount) : expectedFee;
      const paid = parseFloat(r.amount_paid) || 0;
      return {
        year: r.year,
        month: r.month,
        interest_earned: round2(interest),
        payment_count: r.payment_count,
        fee_percentage: feePct,
        base_fee: baseFee,
        expected_fee: expectedFee,
        supposed_to_pay: round2(supposed),
        amount_paid: paid,
        outstanding: round2(Math.max(0, supposed - paid)),
        invoiced,
        invoice_id: r.invoice_id || null,
        invoice_number: r.invoice_number || null,
        invoice_status: r.invoice_status || null,
        due_date: r.due_date || null,
      };
    });

    const totals = months.reduce(
      (a, m) => ({
        interest_earned: a.interest_earned + m.interest_earned,
        supposed_to_pay: a.supposed_to_pay + m.supposed_to_pay,
        amount_paid: a.amount_paid + m.amount_paid,
        outstanding: a.outstanding + m.outstanding,
      }),
      { interest_earned: 0, supposed_to_pay: 0, amount_paid: 0, outstanding: 0 },
    );

    res.json({
      success: true,
      data: {
        tenant: {
          id: tenant.id,
          business_name: tenant.business_name,
          subdomain: tenant.subdomain,
          brand_color: tenant.brand_color,
          billing_fee_percentage: feePct,
          billing_base_fee: baseFee,
          billing_enabled: tenant.billing_enabled,
        },
        months,
        totals: {
          interest_earned: round2(totals.interest_earned),
          supposed_to_pay: round2(totals.supposed_to_pay),
          amount_paid: round2(totals.amount_paid),
          outstanding: round2(totals.outstanding),
        },
      },
    });
  } catch (error) {
    logger.error("Tenant monthly billing error:", error);
    res.status(500).json({ error: "Failed to fetch tenant billing" });
  }
});

// Billing summary
router.get("/summary", async (req, res) => {
  try {
    const currentMonth = await query(`
      SELECT
        COUNT(*)::int AS total_invoices,
        COUNT(*) FILTER (WHERE status='paid')::int    AS paid_count,
        COUNT(*) FILTER (WHERE status='pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE status='overdue')::int AS overdue_count,
        COUNT(*) FILTER (WHERE status='partial')::int AS partial_count,
        COALESCE(SUM(total_amount),0) AS total_billed,
        COALESCE(SUM(amount_paid),0)  AS total_collected,
        COALESCE(SUM(CASE WHEN status IN ('pending','overdue','partial')
                          THEN total_amount - amount_paid END),0) AS outstanding
      FROM invoices
      WHERE billing_year = EXTRACT(YEAR FROM NOW())::int
        AND billing_month = EXTRACT(MONTH FROM NOW())::int
    `);
    const allTime = await query(`
      SELECT
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(total_amount),0) AS total_billed,
        COALESCE(SUM(amount_paid),0)  AS total_collected,
        COALESCE(SUM(CASE WHEN status IN ('pending','overdue','partial')
                          THEN total_amount - amount_paid END),0) AS outstanding
      FROM invoices
    `);
    const monthlyTrend = await query(`
      SELECT billing_year, billing_month,
             COUNT(*)::int AS invoice_count,
             SUM(total_amount) AS total_billed,
             SUM(amount_paid)  AS total_collected
      FROM invoices
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY 1,2 ORDER BY 1,2
    `);
    const topPayers = await query(`
      SELECT t.id, t.business_name, t.brand_color,
             COUNT(i.id)::int AS invoice_count,
             COALESCE(SUM(i.amount_paid),0) AS total_paid
      FROM tenants t
      LEFT JOIN invoices i ON i.tenant_id = t.id AND i.status = 'paid'
      GROUP BY t.id
      HAVING COUNT(i.id) > 0
      ORDER BY total_paid DESC
      LIMIT 10
    `);
    res.json({
      success: true,
      data: {
        current_month: currentMonth.rows[0],
        all_time: allTime.rows[0],
        monthly_trend: monthlyTrend.rows,
        top_payers: topPayers.rows,
      },
    });
  } catch (error) {
    logger.error("Billing summary error:", error);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// ============================================================
// COMMUNICATION COSTS
//   Per-tenant tally of sent SMS + emails over a date range (created_at).
//   Failed messages are excluded; platform-level emails with no tenant_id
//   (daily summary, invoice run summary) are also excluded. Rates are
//   fixed at 1 KES per SMS and 1 KES per email.
// ============================================================
const SMS_KES = 1;
const EMAIL_KES = 1;

router.get("/communication-costs", async (req, res) => {
  try {
    // Default window: 1st of current month → today (inclusive).
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const ymd = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const from = req.query.from || ymd(firstOfMonth);
    const to = req.query.to || ymd(today);

    const params = [from, to];
    const where = `
      status = 'sent'
      AND tenant_id IS NOT NULL
      AND created_at::date BETWEEN $1::date AND $2::date
    `;

    const tenants = await query(
      `
      SELECT
        t.id AS tenant_id,
        t.business_name,
        COALESCE(s.sms_count, 0)::int   AS sms_count,
        COALESCE(e.email_count, 0)::int AS email_count
      FROM tenants t
      LEFT JOIN (
        SELECT tenant_id, COUNT(*) AS sms_count
          FROM sms_logs
         WHERE ${where}
         GROUP BY tenant_id
      ) s ON s.tenant_id = t.id
      LEFT JOIN (
        SELECT tenant_id, COUNT(*) AS email_count
          FROM email_logs
         WHERE ${where}
         GROUP BY tenant_id
      ) e ON e.tenant_id = t.id
      WHERE COALESCE(s.sms_count, 0) + COALESCE(e.email_count, 0) > 0
      ORDER BY (COALESCE(s.sms_count, 0) + COALESCE(e.email_count, 0)) DESC
      `,
      params,
    );

    const rows = tenants.rows.map((r) => {
      const total_kes = r.sms_count * SMS_KES + r.email_count * EMAIL_KES;
      return { ...r, total_kes };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        sms_count: acc.sms_count + r.sms_count,
        email_count: acc.email_count + r.email_count,
        total_kes: acc.total_kes + r.total_kes,
      }),
      { sms_count: 0, email_count: 0, total_kes: 0 },
    );

    res.json({
      success: true,
      data: {
        period: { from, to },
        rates: { sms_kes: SMS_KES, email_kes: EMAIL_KES },
        totals,
        tenants: rows,
      },
    });
  } catch (error) {
    logger.error("Communication costs error:", error);
    res.status(500).json({ error: "Failed to fetch communication costs" });
  }
});

export default router;
