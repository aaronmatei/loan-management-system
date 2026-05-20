import { query } from "../config/database.js";
import logger from "../config/logger.js";

// Interest earned by a tenant in a calendar month. Mirrors the
// principal/interest split convention used in payments.js
// (interest_portion = payment * total_interest / total_amount_due).
export async function calculateTenantInterest(tenantId, year, month) {
  const startDate = new Date(year, month - 1, 1);
  // Day 0 of next month = last day of target month.
  const endDate = new Date(year, month, 0);

  const result = await query(
    `SELECT
       COALESCE(SUM(
         t.amount_paid * (l.total_interest / NULLIF(l.total_amount_due, 0))
       ), 0) AS interest_earned,
       COUNT(DISTINCT t.id)::int AS payment_count
     FROM transactions t
     JOIN loans l ON t.loan_id = l.id
     WHERE t.tenant_id = $1
       AND t.payment_date >= $2
       AND t.payment_date <= $3
       AND t.payment_status = 'completed'`,
    [tenantId, startDate, endDate],
  );

  return {
    interest_earned: parseFloat(result.rows[0].interest_earned),
    payment_count: parseInt(result.rows[0].payment_count, 10),
    period_start: startDate.toISOString().split("T")[0],
    period_end: endDate.toISOString().split("T")[0],
  };
}

export async function generateInvoice(tenantId, year, month, userId = null) {
  const existing = await query(
    `SELECT id FROM invoices
     WHERE tenant_id = $1 AND billing_year = $2 AND billing_month = $3`,
    [tenantId, year, month],
  );
  if (existing.rows.length > 0) {
    throw new Error("Invoice already exists for this period");
  }

  const tr = await query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
  if (tr.rows.length === 0) throw new Error("Tenant not found");
  const tenant = tr.rows[0];
  if (!tenant.billing_enabled) {
    throw new Error("Billing not enabled for this tenant");
  }

  const calc = await calculateTenantInterest(tenantId, year, month);
  const feePercentage = parseFloat(tenant.billing_fee_percentage);
  const interestFee = parseFloat(
    (calc.interest_earned * (feePercentage / 100)).toFixed(2),
  );
  const baseFee = parseFloat(tenant.billing_base_fee);
  const totalAmount = parseFloat((interestFee + baseFee).toFixed(2));

  const invNumber = `INV-${tenantId}-${year}${String(month).padStart(2, "0")}`;
  const issuedDate = new Date();
  const dueDate = new Date();
  dueDate.setDate(
    dueDate.getDate() + (tenant.billing_grace_period_days || 14),
  );

  const result = await query(
    `INSERT INTO invoices (
       tenant_id, invoice_number, billing_month, billing_year,
       period_start, period_end,
       interest_earned, fee_percentage, amount_due,
       base_fee, total_amount, status,
       issued_date, due_date
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)
     RETURNING *`,
    [
      tenantId,
      invNumber,
      month,
      year,
      calc.period_start,
      calc.period_end,
      calc.interest_earned,
      feePercentage,
      interestFee,
      baseFee,
      totalAmount,
      issuedDate.toISOString().split("T")[0],
      dueDate.toISOString().split("T")[0],
    ],
  );

  await query(
    `INSERT INTO billing_activities
       (tenant_id, invoice_id, activity_type, details, performed_by_user_id)
     VALUES ($1,$2,'invoice_generated',$3,$4)`,
    [
      tenantId,
      result.rows[0].id,
      JSON.stringify({
        invoice_number: invNumber,
        amount: totalAmount,
        period: `${year}-${String(month).padStart(2, "0")}`,
      }),
      userId,
    ],
  );

  await query(
    "UPDATE tenants SET last_invoice_date = NOW() WHERE id = $1",
    [tenantId],
  );

  logger.info(
    `Invoice ${invNumber} generated for tenant ${tenantId}: KES ${totalAmount}`,
  );
  return result.rows[0];
}

// Generate invoices for all billable tenants for the PREVIOUS month.
export async function generateMonthlyInvoices(userId = null) {
  const now = new Date();
  // now.getMonth() is 0-indexed CURRENT month; that integer is also
  // the 1-indexed previous month (Jan->index 0 -> previous = Dec).
  const targetMonth = now.getMonth();
  const targetYear =
    targetMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const actualMonth = targetMonth === 0 ? 12 : targetMonth;

  const tenantsResult = await query(
    `SELECT id, business_name FROM tenants
     WHERE billing_enabled = true AND status = 'active'
     ORDER BY id`,
  );

  const results = { success: [], failed: [], skipped: [] };
  for (const tenant of tenantsResult.rows) {
    try {
      const invoice = await generateInvoice(
        tenant.id,
        targetYear,
        actualMonth,
        userId,
      );
      results.success.push({
        tenant: tenant.business_name,
        invoice_number: invoice.invoice_number,
        amount: invoice.total_amount,
      });
    } catch (error) {
      if (error.message === "Invoice already exists for this period") {
        results.skipped.push({
          tenant: tenant.business_name,
          reason: "Already invoiced",
        });
      } else {
        results.failed.push({
          tenant: tenant.business_name,
          error: error.message,
        });
      }
    }
  }
  return {
    period: `${targetYear}-${String(actualMonth).padStart(2, "0")}`,
    ...results,
  };
}

export async function markInvoicePaid(invoiceId, paymentData, userId) {
  const { amount, payment_method, payment_reference, payment_date } =
    paymentData;
  const invoiceResult = await query(
    "SELECT * FROM invoices WHERE id = $1",
    [invoiceId],
  );
  if (invoiceResult.rows.length === 0) throw new Error("Invoice not found");
  const invoice = invoiceResult.rows[0];
  const paymentAmount = parseFloat(amount);
  const newAmountPaid = parseFloat(invoice.amount_paid) + paymentAmount;
  const totalAmount = parseFloat(invoice.total_amount);

  let newStatus;
  if (newAmountPaid + 0.01 >= totalAmount) newStatus = "paid";
  else if (newAmountPaid > 0) newStatus = "partial";
  else newStatus = invoice.status;

  await query(
    `INSERT INTO invoice_payments (
       invoice_id, amount, payment_method, payment_reference,
       payment_date, recorded_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      invoiceId,
      paymentAmount,
      payment_method,
      payment_reference || null,
      payment_date || new Date().toISOString().split("T")[0],
      userId,
    ],
  );

  // Use a separate boolean param ($7) for the paid_at decision —
  // reusing $2 inside both `status = $2` and `CASE WHEN $2 = 'paid'`
  // hits pg's "inconsistent types deduced for parameter" check even
  // with a ::text cast.
  const isPaid = newStatus === "paid";
  const updated = await query(
    `UPDATE invoices SET
       amount_paid = $1,
       status = $2,
       paid_at = CASE WHEN $7 THEN NOW() ELSE paid_at END,
       payment_method = $3,
       payment_reference = $4,
       paid_by_user_id = $5,
       updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      newAmountPaid,
      newStatus,
      payment_method,
      payment_reference || null,
      userId,
      invoiceId,
      isPaid,
    ],
  );

  await query(
    `INSERT INTO billing_activities
       (tenant_id, invoice_id, activity_type, details, performed_by_user_id)
     VALUES ($1,$2,'payment_received',$3,$4)`,
    [
      invoice.tenant_id,
      invoiceId,
      JSON.stringify({
        amount: paymentAmount,
        payment_method,
        payment_reference,
        new_status: newStatus,
      }),
      userId,
    ],
  );

  return updated.rows[0];
}

export async function markOverdueInvoices() {
  const result = await query(
    `UPDATE invoices
     SET status = 'overdue', updated_at = NOW()
     WHERE status = 'pending' AND due_date < CURRENT_DATE
     RETURNING id, tenant_id, invoice_number, total_amount`,
  );
  return result.rows;
}

export async function autoSuspendOverdue() {
  const result = await query(
    `UPDATE tenants
     SET status = 'suspended',
         suspension_reason = 'Auto-suspended: Unpaid invoice(s)',
         updated_at = NOW()
     WHERE billing_enabled = true
       AND status = 'active'
       AND id IN (
         SELECT DISTINCT i.tenant_id
         FROM invoices i
         JOIN tenants t ON t.id = i.tenant_id
         WHERE i.status = 'overdue'
           AND i.due_date < CURRENT_DATE - (
             t.billing_suspend_after_days || ' days')::interval
       )
     RETURNING id, business_name`,
  );
  for (const tenant of result.rows) {
    await query(
      `INSERT INTO billing_activities
         (tenant_id, activity_type, details)
       VALUES ($1,'auto_suspended',$2)`,
      [tenant.id, JSON.stringify({ reason: "Unpaid invoices" })],
    );
  }
  return result.rows;
}
