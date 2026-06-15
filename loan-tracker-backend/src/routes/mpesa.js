// M-Pesa STK Push routes.
//
//   POST /api/mpesa/stk/loan-repayment   customer OR staff  → push to phone
//   POST /api/mpesa/stk/invoice          staff (tenant)     → push to phone
//   POST /api/mpesa/callback             PUBLIC (Safaricom)  → records payment
//   GET  /api/mpesa/status/:checkoutId   customer OR staff  → poll result
//
// Confirmed payments are applied through the SAME code the manual flow
// uses — recordLoanPayment (services/paymentService.js) for loans and
// billingService.markInvoicePaid for invoices — so balances, schedules,
// capital pool, completion, receipts, and notifications all stay correct.
//
// SECURITY: only /callback is public; Safaricom calls it unauthenticated.
// We never trust its body beyond matching checkout_request_id against a
// row WE created, and application is idempotent (only acts while our row
// is 'pending'), so a replayed or forged callback can't double-credit.

import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import * as mpesa from "../services/mpesaService.js";
import { recordLoanPayment } from "../services/paymentService.js";
import { markInvoicePaid } from "../services/billingService.js";
import { allocateWelfarePayment } from "../services/welfareMpesaService.js";
import logger from "../config/logger.js";

const router = express.Router();

// ── Combined auth ─────────────────────────────────────────────────
// STK initiation + status polling are reachable by BOTH portal
// customers (verifyCustomer-style token, user_type='customer') and
// tenant staff (verifyToken-style token). We decode once and normalize
// identity onto req.actor so handlers don't care which kind it is.
async function verifyAnyAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);

    if (decoded.user_type === "customer") {
      if (decoded.needs_tenant_selection || !decoded.current_tenant_id) {
        return res.status(403).json({ error: "Please select a tenant first" });
      }
      const cr = await query(
        "SELECT id, is_blacklisted_platform FROM platform_customers WHERE id = $1 AND is_active = true",
        [decoded.platform_customer_id],
      );
      if (cr.rows.length === 0) {
        return res.status(401).json({ error: "Account not found" });
      }
      if (cr.rows[0].is_blacklisted_platform) {
        return res.status(403).json({ error: "Account suspended" });
      }
      req.actor = {
        type: "customer",
        customerId: decoded.platform_customer_id,
        tenantId: decoded.current_tenant_id,
        clientId: decoded.current_client_id,
      };
    } else {
      req.actor = {
        type: "staff",
        userId: decoded.id,
        email: decoded.email,
        role: decoded.role,
        tenantId: decoded.tenant_id || null,
        isPlatformAdmin: !!decoded.is_platform_admin,
      };
      req.user = decoded;
    }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Reject STK initiation for demo / mpesa-disabled tenants. Mirrors the
// way notificationDispatcher short-circuits demo tenants — no real
// money flows in a demo session.
async function assertTenantCanCollect(tenantId) {
  const t = await query(
    "SELECT is_demo, mpesa_enabled FROM tenants WHERE id = $1",
    [tenantId],
  );
  const tenant = t.rows[0];
  if (!tenant) throw httpErr(404, "Tenant not found");
  if (tenant.is_demo) {
    throw httpErr(403, "M-Pesa payments are disabled in demo mode.");
  }
  if (tenant.mpesa_enabled === false) {
    throw httpErr(403, "M-Pesa is not enabled for this account.");
  }
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Map a thrown error (ours or Daraja's) to a clean 4xx for the client.
function sendError(res, error, label) {
  const status = error.status && error.status < 500 ? error.status : 400;
  logger.error(`${label}:`, error?.daraja || error.message);
  res.status(status).json({
    error: error?.daraja?.errorMessage || error.message || "Request failed",
  });
}

// ── POST /stk/loan-repayment ──────────────────────────────────────
// Body: { loan_id, amount, phone }. Customer can only pay their own
// loan; staff only loans in their tenant (platform admin: any).
router.post("/stk/loan-repayment", verifyAnyAuth, async (req, res) => {
  try {
    const { loan_id, amount, phone } = req.body;
    if (!loan_id || !amount || !phone) {
      return res
        .status(400)
        .json({ error: "loan_id, amount, and phone are required" });
    }

    // Scope the loan lookup to the caller's identity.
    let loanRow;
    if (req.actor.type === "customer") {
      loanRow = await query(
        `SELECT id, tenant_id, loan_code, status
           FROM loans
          WHERE id = $1 AND client_id = $2 AND tenant_id = $3`,
        [loan_id, req.actor.clientId, req.actor.tenantId],
      );
    } else {
      loanRow = await query(
        `SELECT id, tenant_id, loan_code, status
           FROM loans
          WHERE id = $1 AND ($2::int IS NULL OR tenant_id = $2)`,
        [loan_id, req.actor.isPlatformAdmin ? null : req.actor.tenantId],
      );
    }
    if (loanRow.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const loan = loanRow.rows[0];
    if (loan.status === "completed") {
      return res.status(400).json({ error: "This loan is already fully paid." });
    }

    await assertTenantCanCollect(loan.tenant_id);

    const result = await mpesa.initiateSTKPush({
      phone,
      amount,
      accountReference: (loan.loan_code || `LOAN${loan.id}`).substring(0, 12),
      transactionDesc: "Loan Repay",
    });

    await query(
      `INSERT INTO mpesa_transactions (
         tenant_id, purpose, loan_id, customer_id, initiated_by_user_id,
         phone_number, amount, account_reference, transaction_desc,
         merchant_request_id, checkout_request_id, status, request_payload
       ) VALUES ($1, 'loan_repayment', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)`,
      [
        loan.tenant_id,
        loan.id,
        req.actor.type === "customer" ? req.actor.customerId : null,
        req.actor.type === "staff" ? req.actor.userId : null,
        result.normalizedPhone,
        result.amount,
        loan.loan_code || `LOAN${loan.id}`,
        "Loan Repay",
        result.merchantRequestId,
        result.checkoutRequestId,
        JSON.stringify(result.raw),
      ],
    );

    res.json({
      success: true,
      message:
        result.customerMessage || "Check your phone to enter your M-Pesa PIN",
      checkout_request_id: result.checkoutRequestId,
    });
  } catch (error) {
    sendError(res, error, "STK loan-repayment error");
  }
});

// ── POST /stk/invoice ─────────────────────────────────────────────
// Body: { invoice_id, phone }. Amount is the invoice balance. Staff
// only; a tenant can only pay their own invoice. (No tenant-facing
// invoice UI ships yet — endpoint is ready for it.)
router.post("/stk/invoice", verifyToken, async (req, res) => {
  try {
    const { invoice_id, phone } = req.body;
    if (!invoice_id || !phone) {
      return res
        .status(400)
        .json({ error: "invoice_id and phone are required" });
    }

    const invRes = await query("SELECT * FROM invoices WHERE id = $1", [
      invoice_id,
    ]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const inv = invRes.rows[0];

    // Tenant isolation — a tenant can only pay their own invoice.
    // (Platform admins have no tenant_id scope and may assist.)
    if (
      !req.user.is_platform_admin &&
      req.user.tenant_id &&
      inv.tenant_id !== req.user.tenant_id
    ) {
      return res.status(403).json({ error: "Not authorized for this invoice" });
    }

    const balance =
      parseFloat(inv.total_amount) - parseFloat(inv.amount_paid || 0);
    if (balance <= 0) {
      return res.status(400).json({ error: "Invoice already paid" });
    }

    await assertTenantCanCollect(inv.tenant_id);

    const result = await mpesa.initiateSTKPush({
      phone,
      amount: balance,
      accountReference: (inv.invoice_number || `INV${inv.id}`).substring(0, 12),
      transactionDesc: "LenderFest Fee",
    });

    await query(
      `INSERT INTO mpesa_transactions (
         tenant_id, purpose, invoice_id, initiated_by_user_id,
         phone_number, amount, account_reference, transaction_desc,
         merchant_request_id, checkout_request_id, status, request_payload
       ) VALUES ($1, 'tenant_invoice', $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
      [
        inv.tenant_id,
        inv.id,
        req.user.id || null,
        result.normalizedPhone,
        result.amount,
        inv.invoice_number || `INV${inv.id}`,
        "LenderFest Fee",
        result.merchantRequestId,
        result.checkoutRequestId,
        JSON.stringify(result.raw),
      ],
    );

    res.json({
      success: true,
      message:
        result.customerMessage || "Check your phone to enter your M-Pesa PIN",
      checkout_request_id: result.checkoutRequestId,
    });
  } catch (error) {
    sendError(res, error, "STK invoice error");
  }
});

// ── Apply confirmed payments (reuse existing logic) ───────────────
async function applyLoanRepayment(mpesaTx, cb) {
  // Reuse the exact manual-payment path: schedules, capital pool,
  // completion, receipt + payment-received SMS/email, audit.
  await recordLoanPayment({
    loanId: mpesaTx.loan_id,
    amountPaid: cb.amount,
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "mpesa",
    paymentReference: cb.mpesaReceiptNumber,
    notes: `M-Pesa STK ${cb.mpesaReceiptNumber || ""}`.trim(),
    actor: mpesaTx.initiated_by_user_id
      ? { id: mpesaTx.initiated_by_user_id }
      : { id: null, email: "mpesa-callback" },
    tenantId: mpesaTx.tenant_id || null,
    auditReq: null,
  });
  logger.info(
    `Loan ${mpesaTx.loan_id} credited KES ${cb.amount} via M-Pesa ${cb.mpesaReceiptNumber}`,
  );
}

async function applyInvoicePayment(mpesaTx, cb) {
  await markInvoicePaid(
    mpesaTx.invoice_id,
    {
      amount: cb.amount,
      payment_method: "mpesa",
      payment_reference: cb.mpesaReceiptNumber,
      payment_date: new Date().toISOString().split("T")[0],
    },
    mpesaTx.initiated_by_user_id,
  );
  logger.info(
    `Invoice ${mpesaTx.invoice_id} paid KES ${cb.amount} via M-Pesa ${cb.mpesaReceiptNumber}`,
  );
}

// ── POST /callback ── PUBLIC. Safaricom posts the STK result here.
// Always 200 with the ack shape, even on internal error, so Safaricom
// doesn't retry forever. The raw body is persisted for reconciliation.
router.post("/callback", async (req, res) => {
  const ack = { ResultCode: 0, ResultDesc: "Accepted" };
  try {
    const parsed = mpesa.parseCallback(req.body);
    if (!parsed || !parsed.checkoutRequestId) {
      logger.warn("M-Pesa callback with no checkoutRequestId");
      return res.json(ack);
    }

    const txRes = await query(
      "SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1",
      [parsed.checkoutRequestId],
    );
    if (txRes.rows.length === 0) {
      logger.warn(
        `M-Pesa callback for unknown checkout ${parsed.checkoutRequestId}`,
      );
      return res.json(ack);
    }
    const mpesaTx = txRes.rows[0];

    // Idempotency — already finalized: do nothing (replay-safe).
    if (mpesaTx.status !== "pending") {
      return res.json(ack);
    }

    if (parsed.resultCode === 0) {
      // SUCCESS — apply the money first, then mark our row success.
      try {
        if (mpesaTx.purpose === "loan_repayment") {
          await applyLoanRepayment(mpesaTx, parsed);
        } else if (mpesaTx.purpose === "tenant_invoice") {
          await applyInvoicePayment(mpesaTx, parsed);
        } else if (String(mpesaTx.purpose || "").startsWith("welfare_")) {
          await allocateWelfarePayment(mpesaTx, parsed);
        }
      } catch (applyErr) {
        // Money came in but applying failed — log loudly and keep the
        // row for manual reconciliation (status still flips to success
        // so we don't double-apply on a retry; the raw payload + receipt
        // number are persisted below).
        logger.error(
          "Failed to apply confirmed M-Pesa payment:",
          applyErr.message,
        );
      }

      await query(
        `UPDATE mpesa_transactions SET
           status = 'success', result_code = $1, result_desc = $2,
           mpesa_receipt_number = $3, paid_phone_number = $4,
           callback_payload = $5, updated_at = NOW()
         WHERE id = $6`,
        [
          parsed.resultCode,
          parsed.resultDesc,
          parsed.mpesaReceiptNumber,
          parsed.phoneNumber ? String(parsed.phoneNumber) : null,
          JSON.stringify(req.body),
          mpesaTx.id,
        ],
      );
    } else {
      // FAILED / CANCELLED / TIMEOUT
      const status =
        parsed.resultCode === 1032
          ? "cancelled"
          : parsed.resultCode === 1037
            ? "timeout"
            : "failed";
      await query(
        `UPDATE mpesa_transactions SET
           status = $1, result_code = $2, result_desc = $3,
           callback_payload = $4, updated_at = NOW()
         WHERE id = $5`,
        [
          status,
          parsed.resultCode,
          parsed.resultDesc,
          JSON.stringify(req.body),
          mpesaTx.id,
        ],
      );
    }

    return res.json(ack);
  } catch (error) {
    logger.error("M-Pesa callback handler error:", error.message);
    return res.json(ack); // still ack; raw body is logged above
  }
});

// ── GET /status/:checkoutRequestId ── poll for the PIN-flow result.
router.get("/status/:checkoutRequestId", verifyAnyAuth, async (req, res) => {
  try {
    const txRes = await query(
      `SELECT tenant_id, customer_id, status, result_desc,
              mpesa_receipt_number, amount, purpose, loan_id, invoice_id
         FROM mpesa_transactions WHERE checkout_request_id = $1`,
      [req.params.checkoutRequestId],
    );
    if (txRes.rows.length === 0) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    const tx = txRes.rows[0];

    // Only the initiator's side may read it.
    const owns =
      req.actor.type === "customer"
        ? tx.customer_id === req.actor.customerId
        : req.actor.isPlatformAdmin || tx.tenant_id === req.actor.tenantId;
    if (!owns) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({ success: true, data: tx });
  } catch (error) {
    logger.error("M-Pesa status error:", error.message);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

export default router;
