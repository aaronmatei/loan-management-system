// Tenant-facing billing: a lender's own platform invoices (read-only). The
// platform-admin billing API lives under /api/platform/billing; this is the
// tenant side. Payment is via POST /api/mpesa/stk/invoice (already tenant-
// scoped). Admin/manager only, and always scoped to the caller's tenant.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import logger from "../config/logger.js";
import { buildInvoicePdf } from "../utils/pdfDocuments.js";

const router = express.Router();
router.use(verifyToken, authorize("admin", "manager"));

const requireTenant = (req, res) => {
  const tid = req.user?.tenant_id;
  if (!tid) {
    res.status(400).json({ error: "No tenant context — re-login required" });
    return null;
  }
  return tid;
};

// All of this tenant's invoices, newest period first.
router.get("/invoices", async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const result = await query(
      `SELECT id, invoice_number, billing_month, billing_year,
              period_start, period_end, interest_earned, fee_percentage,
              amount_due, base_fee, discount, total_amount, amount_paid,
              status, issued_date, due_date, paid_at, notes
         FROM invoices
        WHERE tenant_id = $1
        ORDER BY billing_year DESC, billing_month DESC`,
      [tid],
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Tenant invoices error:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// Outstanding summary for the dashboard/header.
router.get("/summary", async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const r = await query(
      `SELECT
         COUNT(*)::int AS total_invoices,
         COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
         COUNT(*) FILTER (WHERE status IN ('pending','partial'))::int AS due_count,
         COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
         COALESCE(SUM(CASE WHEN status IN ('pending','overdue','partial')
                           THEN total_amount - amount_paid END), 0) AS outstanding
       FROM invoices WHERE tenant_id = $1`,
      [tid],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error("Tenant billing summary error:", error);
    res.status(500).json({ error: "Failed to fetch billing summary" });
  }
});

// A single invoice (tenant-scoped) plus its payment history.
router.get("/invoices/:id", async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const inv = await query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tid],
    );
    if (inv.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const payments = await query(
      `SELECT amount, payment_method, payment_reference, payment_date, created_at
         FROM invoice_payments WHERE invoice_id = $1
        ORDER BY payment_date DESC, id DESC`,
      [req.params.id],
    );
    res.json({
      success: true,
      data: { ...inv.rows[0], payments: payments.rows },
    });
  } catch (error) {
    logger.error("Tenant invoice detail error:", error);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
});

// Download an invoice as a branded PDF (tenant-scoped).
router.get("/invoices/:id/pdf", async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;
    const { buffer, filename } = await buildInvoicePdf(
      parseInt(req.params.id, 10),
      tid,
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    if (error.name === "NotFoundError") {
      return res.status(404).json({ error: "Invoice not found" });
    }
    logger.error("Tenant invoice PDF error:", error);
    res.status(500).json({ error: "Failed to generate invoice PDF" });
  }
});

export default router;
