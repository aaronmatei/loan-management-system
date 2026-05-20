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

export default router;
