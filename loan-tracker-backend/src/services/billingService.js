import { query } from "../config/database.js";
import logger from "../config/logger.js";
import { sendEmail } from "./emailService.js";
import { sendSMS } from "./smsService.js";
import { createNotification } from "./notificationService.js";

// Notify a tenant that a new platform invoice was issued — in-app (to the
// tenant's own admins/managers), email (contact_email) and SMS (contact_phone).
// Best-effort: never throws, so a failed notification can't break billing.
async function notifyInvoiceGenerated(tenant, invoice) {
  try {
    const amount = parseFloat(invoice.total_amount).toLocaleString();
    const due = invoice.due_date
      ? new Date(invoice.due_date).toLocaleDateString()
      : null;
    const summary = `Invoice ${invoice.invoice_number} for KES ${amount} has been issued${
      due ? `, due ${due}` : ""
    }.`;

    // In-app — scoped to THIS tenant's staff (createNotification's `roles`
    // shortcut isn't tenant-scoped, so resolve the user ids ourselves).
    const staff = await query(
      `SELECT id FROM users
        WHERE tenant_id = $1 AND role IN ('admin','manager') AND is_active = true`,
      [tenant.id],
    );
    for (const u of staff.rows) {
      await createNotification({
        userId: u.id,
        type: "invoice_generated",
        title: "New platform invoice",
        message: summary,
        icon: null, // lucide fallback in the UI (no emoji)
        link: "/billing",
        metadata: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
        },
      });
    }

    if (tenant.contact_email) {
      const baseLine =
        parseFloat(invoice.base_fee) > 0
          ? `Base fee: KES ${parseFloat(invoice.base_fee).toLocaleString()}<br/>`
          : "";
      await sendEmail({
        to: tenant.contact_email,
        fromName: "LenderFest",
        subject: `New invoice ${invoice.invoice_number} — KES ${amount}`,
        html: `<p>Hi ${tenant.business_name},</p>
               <p>${summary}</p>
               <p>Interest earned: KES ${parseFloat(invoice.interest_earned).toLocaleString()}<br/>
               Platform fee (${invoice.fee_percentage}%): KES ${parseFloat(invoice.amount_due).toLocaleString()}<br/>
               ${baseLine}<strong>Total due: KES ${amount}</strong></p>
               <p>Log in to your dashboard, open <strong>Billing</strong>, to view and pay.</p>`,
      });
    }

    if (tenant.contact_phone) {
      await sendSMS(
        tenant.contact_phone,
        `${tenant.business_name}: ${summary} Log in to Billing to pay.`,
      );
    }
  } catch (err) {
    logger.error("notifyInvoiceGenerated error:", err);
  }
}

// Interest earned by a tenant in a calendar month. Mirrors the
// principal/interest split convention used in payments.js
// (interest_portion = payment * total_interest / total_amount_due).
/**
 * Mirror a Platform Billing invoice into the tenant's expense ledger
 * — but ONLY once the invoice has been paid (in whole or in part).
 * The expense's amount tracks invoice.amount_paid so partial payments
 * create the row at the partial amount and a later top-up grows it.
 *
 * Idempotent via the (tenant_id, invoice_id) unique index.
 * Called from markInvoicePaid (post-UPDATE). NOT called by
 * generateInvoice — that one no longer touches expenses.
 */
export async function syncInvoiceToExpense(tenantId, invoice) {
  if (!invoice || !invoice.id) return;
  const paidAmt = parseFloat(invoice.amount_paid || 0);
  // Nothing paid yet → nothing to record. expenses.amount > 0 would
  // reject a zero anyway.
  if (!Number.isFinite(paidAmt) || paidAmt <= 0) return;

  const cat = await query(
    `SELECT id FROM expense_categories
      WHERE tenant_id = $1 AND name = 'Platform Billing'
      LIMIT 1`,
    [tenantId],
  );
  if (cat.rows.length === 0) return; // category seed missed this tenant

  // Use the first payment date as the expense date (when money
  // actually left the tenant's account), falling back to the invoice
  // issued_date if no invoice_payments row exists.
  const firstPaidRes = await query(
    `SELECT MIN(payment_date)::date AS first_paid
       FROM invoice_payments WHERE invoice_id = $1`,
    [invoice.id],
  );
  const firstPaid =
    firstPaidRes.rows[0]?.first_paid ||
    invoice.issued_date ||
    invoice.created_at;

  const description = `LenderFest invoice ${invoice.invoice_number} · ${
    invoice.status || "paid"
  } · paid ${new Date(firstPaid).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  await query(
    `INSERT INTO expenses (
       tenant_id, category_id, amount, description, expense_date,
       payment_method, reference, is_recurring, recurrence_period,
       recorded_by, invoice_id
     )
     VALUES ($1, $2, $3, $4, $5::date,
             $6, $7, true, 'monthly', NULL, $8)
     ON CONFLICT (tenant_id, invoice_id) WHERE invoice_id IS NOT NULL
       DO UPDATE SET
         amount       = EXCLUDED.amount,
         description  = EXCLUDED.description,
         expense_date = EXCLUDED.expense_date,
         payment_method = EXCLUDED.payment_method,
         reference    = EXCLUDED.reference,
         updated_at   = NOW()`,
    [
      tenantId,
      cat.rows[0].id,
      paidAmt,
      description,
      firstPaid,
      invoice.payment_method || null,
      invoice.invoice_number,
      invoice.id,
    ],
  );
}

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
  const grossAmount = parseFloat((interestFee + baseFee).toFixed(2));

  // Referral free-month credit: one credit waives this invoice's
  // platform fee in full. We deduct the credit BEFORE inserting so a
  // race that re-runs invoice generation won't double-burn it. The
  // discount is captured on the invoice itself (existing `discount`
  // and `notes` columns from migration 009) and the audit lives in
  // billing_activities below.
  const credits = parseInt(
    (await query(`SELECT referral_credits FROM tenants WHERE id = $1`, [tenantId]))
      .rows[0]?.referral_credits || 0,
    10,
  );
  let referralDiscount = 0;
  let totalAmount = grossAmount;
  let invoiceNotes = null;
  if (credits > 0 && grossAmount > 0) {
    referralDiscount = grossAmount;
    totalAmount = 0;
    invoiceNotes = "Free month from referral reward";
    await query(
      `UPDATE tenants
          SET referral_credits = referral_credits - 1
        WHERE id = $1 AND referral_credits > 0`,
      [tenantId],
    );
    logger.info(
      `Applied referral credit for tenant ${tenantId}: KES ${referralDiscount} waived`,
    );
  }

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
       base_fee, discount, total_amount, status,
       issued_date, due_date, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15)
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
      referralDiscount,
      totalAmount,
      issuedDate.toISOString().split("T")[0],
      dueDate.toISOString().split("T")[0],
      invoiceNotes,
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
        gross_amount: grossAmount,
        referral_discount: referralDiscount,
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

  // NOTE: we no longer mirror the invoice into expenses at
  // generation time. An expense row is only written once the tenant
  // actually pays the invoice — see syncInvoiceToExpense, which is
  // called from markInvoicePaid.

  logger.info(
    `Invoice ${invNumber} generated for tenant ${tenantId}: KES ${totalAmount}`,
  );

  // Tell the tenant (in-app + email + SMS). Best-effort, never blocks.
  await notifyInvoiceGenerated(tenant, result.rows[0]);

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

  // Refresh the mirror expense row so its description reflects the
  // new status (pending → partial → paid).
  try {
    await syncInvoiceToExpense(invoice.tenant_id, updated.rows[0]);
  } catch (err) {
    logger.error("syncInvoiceToExpense (markPaid) error:", err);
  }

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
