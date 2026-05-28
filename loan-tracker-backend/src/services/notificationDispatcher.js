// Central SMS + Email dispatcher for the 9 loan-lifecycle events.
// Distinct from notificationService.js (which creates in-app
// notifications for staff). This file ONLY handles outbound
// customer-facing channels.
//
// Gated per tenant by the 18 notify_*_{sms,email} columns added in
// migration 013. Template strings live in smsService.templates and
// emailService.templates so the wire format stays consistent with
// the existing inline call sites we're replacing.

import { query } from "../config/database.js";
import {
  sendSMS,
  templates as smsTemplates,
} from "./smsService.js";
import {
  sendEmail,
  templates as emailTemplates,
  getCompanySettings,
} from "./emailService.js";
import logger from "../config/logger.js";

// ── Event → (sms_pref_col, email_pref_col) ────────────────────────
const PREF_COLUMNS = {
  application_submitted:    ["notify_application_submitted_sms",   "notify_application_submitted_email"],
  application_under_review: ["notify_under_review_sms",            "notify_under_review_email"],
  application_approved:     ["notify_approved_sms",                "notify_approved_email"],
  application_rejected:     ["notify_rejected_sms",                "notify_rejected_email"],
  counter_offered:          ["notify_counter_offered_sms",         "notify_counter_offered_email"],
  loan_disbursed:           ["notify_disbursed_sms",               "notify_disbursed_email"],
  payment_received:         ["notify_payment_sms",                 "notify_payment_email"],
  payment_reminder:         ["notify_reminder_sms",                "notify_reminder_email"],
  payment_overdue:          ["notify_overdue_sms",                 "notify_overdue_email"],
  loan_completed:           ["notify_completed_sms",               "notify_completed_email"],
  loan_waived:              ["notify_completed_sms",               "notify_completed_email"],
  loan_waiver_reversed:     ["notify_completed_sms",               "notify_completed_email"],
};

// sms_logs.message_type / email_logs.message_type for each event.
// Historically disbursement logged as 'loan_approved' which got
// confused with the application_approved bucket — the two are now
// distinct ('loan_disbursed' vs 'application_approved'). Existing
// 'loan_approved' rows are migrated in lockstep with this change.
const MESSAGE_TYPE = {
  application_submitted: "application_submitted",
  application_under_review: "application_under_review",
  application_approved: "application_approved",
  application_rejected: "application_rejected",
  counter_offered: "counter_offered",
  loan_disbursed: "loan_disbursed",
  payment_received: "payment_received",
  payment_reminder: "reminder",
  payment_overdue: "overdue_reminder",
  loan_completed: "loan_completed",
  loan_waived: "loan_waived",
  loan_waiver_reversed: "loan_waiver_reversed",
};

/**
 * Fire SMS + Email for an event.
 *
 * @param {string} eventType   key from PREF_COLUMNS
 * @param {object} ctx
 *   - tenantId
 *   - customer: { first_name, last_name, phone_number, email, client_id? }
 *   - data:     event-specific fields (loan_code, amount, balance, etc.)
 * @returns {Promise<{sms?, email?, skipped:string[], error?}>}
 */
export async function notify(eventType, ctx) {
  const result = { skipped: [] };
  try {
    const { tenantId, customer = {}, data = {}, attachments } = ctx || {};
    if (!PREF_COLUMNS[eventType]) {
      logger.warn(`notify: unknown eventType ${eventType}`);
      return { error: "unknown event" };
    }

    // Load tenant prefs + branding fields in one query (also pulls
    // is_demo so we can short-circuit demo-tenant traffic before
    // hitting the SMS/email providers).
    const tRes = await query(
      `SELECT id, business_name, contact_email, contact_phone,
              support_email, support_phone, email_sender_name,
              brand_color, logo_url, hide_platform_branding, subdomain,
              is_demo,
              ${PREF_COLUMNS[eventType][0]} AS sms_enabled,
              ${PREF_COLUMNS[eventType][1]} AS email_enabled
         FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (tRes.rows.length === 0) {
      return { error: "tenant not found" };
    }
    const tenant = tRes.rows[0];

    // Demo tenants never send real SMS or email. Returning early
    // keeps the call sites' contract (notify never throws), and the
    // demo session's behaviour stays observable in logs.
    if (tenant.is_demo) {
      logger.info(`[demo] notify(${eventType}) skipped for tenant ${tenantId}`);
      return { demo: true, skipped: true };
    }

    // emailService templates expect a `company` object with name/phone/email/website.
    // Tolerate getCompanySettings failures (it falls back to env vars).
    const company = await getCompanySettings(tenantId).catch(() => ({
      name: tenant.business_name,
      phone: tenant.support_phone || tenant.contact_phone,
      email: tenant.support_email || tenant.contact_email,
      website: "",
    }));

    // ── SMS branch ───────────────────────────────────────────────
    if (tenant.sms_enabled && customer.phone_number) {
      const smsBody = renderSms(eventType, { tenant, customer, data });
      if (smsBody) {
        const r = await sendSMS(customer.phone_number, smsBody);
        await logSms({
          tenantId,
          clientId: customer.client_id || null,
          loanId: data.loan_id || null,
          phone: customer.phone_number,
          message: smsBody,
          messageType: MESSAGE_TYPE[eventType],
          providerResult: r,
        });
        result.sms = r;
      }
    } else {
      result.skipped.push(tenant.sms_enabled ? "no-phone" : "sms-pref-off");
    }

    // ── Email branch ─────────────────────────────────────────────
    if (tenant.email_enabled && customer.email) {
      const built = renderEmail(eventType, { tenant, customer, data, company });
      if (built) {
        // Per-tenant From-name so recipients can tell tenants apart
        // (the From-address stays EMAIL_FROM=aronique@gmail.com for
        // SMTP/DMARC reasons). Falls through email_sender_name (Pro+
        // white-label) → business_name → env default.
        const fromName =
          tenant.email_sender_name || tenant.business_name || undefined;
        const r = await sendEmail({
          to: customer.email,
          subject: built.subject,
          html: built.html,
          fromName,
          attachments: Array.isArray(attachments) ? attachments : undefined,
        });
        await logEmail({
          tenantId,
          clientId: customer.client_id || null,
          loanId: data.loan_id || null,
          recipient: customer.email,
          subject: built.subject,
          messageType: MESSAGE_TYPE[eventType],
          providerResult: r,
          attachment:
            Array.isArray(attachments) && attachments[0]
              ? attachments[0].filename
              : null,
        });
        result.email = r;
      }
    } else {
      result.skipped.push(tenant.email_enabled ? "no-email" : "email-pref-off");
    }

    return result;
  } catch (err) {
    logger.error(`notify(${eventType}) error:`, err);
    return { error: err.message };
  }
}

// ── Template dispatch (SMS) ──────────────────────────────────────
function renderSms(eventType, { tenant, customer, data }) {
  const name = customer.first_name || customer.name || "Customer";
  const biz = tenant.business_name;
  switch (eventType) {
    case "application_submitted":
      return smsTemplates.applicationSubmitted(name, data.amount, data.loan_code, biz);
    case "application_under_review":
      return smsTemplates.applicationUnderReview(name, data.loan_code, biz);
    case "application_approved":
      return smsTemplates.applicationApproved(name, data.amount, data.loan_code, biz);
    case "application_rejected":
      return smsTemplates.applicationRejected(name, data.loan_code, biz, data.reason);
    case "counter_offered":
      return smsTemplates.counterOffered(name, data.offered_amount, data.loan_code, biz);
    case "loan_disbursed":
      return smsTemplates.loanApproved(name, data.amount, data.loan_code);
    case "payment_received":
      return smsTemplates.paymentReceived(name, data.amount, data.loan_code, data.balance);
    case "payment_reminder":
      return smsTemplates.paymentReminder(name, data.amount, data.due_date, data.loan_code);
    case "payment_overdue":
      return smsTemplates.overdueNotice(name, data.amount, data.days_late, data.loan_code);
    case "loan_completed":
      return data.overpayment_amount > 0
        ? smsTemplates.loanCompletedWithOverpayment(name, data.loan_code, data.overpayment_amount)
        : smsTemplates.loanCompleted(name, data.loan_code);
    case "loan_waived":
      return smsTemplates.loanWaived(name, data.amount, data.loan_code, biz);
    case "loan_waiver_reversed":
      return smsTemplates.loanWaiverReversed(name, data.amount, data.loan_code, biz);
    default:
      return null;
  }
}

// ── Template dispatch (Email) ────────────────────────────────────
function renderEmail(eventType, { tenant, customer, data, company }) {
  const name = customer.first_name || customer.name || "Customer";
  switch (eventType) {
    case "application_submitted":
      return emailTemplates.applicationSubmitted({
        clientName: name,
        amount: data.amount,
        loanCode: data.loan_code,
        months: data.duration_months,
        company,
      });
    case "application_under_review":
      return emailTemplates.applicationUnderReview({
        clientName: name,
        loanCode: data.loan_code,
        company,
      });
    case "application_approved":
      return emailTemplates.applicationApproved({
        clientName: name,
        amount: data.amount,
        loanCode: data.loan_code,
        months: data.duration_months,
        rate: data.interest_rate,
        company,
      });
    case "application_rejected":
      return emailTemplates.applicationRejected({
        clientName: name,
        loanCode: data.loan_code,
        reason: data.reason,
        company,
      });
    case "counter_offered":
      return emailTemplates.counterOffered({
        clientName: name,
        offeredAmount: data.offered_amount,
        requestedAmount: data.requested_amount,
        loanCode: data.loan_code,
        note: data.note,
        company,
      });
    case "loan_disbursed":
      return emailTemplates.loanApproved({
        clientName: name,
        loanCode: data.loan_code,
        principal: data.amount,
        totalDue: data.total_amount_due,
        months: data.duration_months,
        company,
      });
    case "payment_received":
      return emailTemplates.paymentReceived({
        clientName: name,
        amount: data.amount,
        loanCode: data.loan_code,
        balance: data.balance,
        transactionCode: data.transaction_code,
        paymentMethod: data.payment_method,
        paymentDate: data.payment_date,
        company,
      });
    case "payment_reminder":
      return emailTemplates.paymentReminder({
        clientName: name,
        amount: data.amount,
        dueDate: data.due_date,
        loanCode: data.loan_code,
        company,
      });
    case "payment_overdue":
      return emailTemplates.overdueNotice({
        clientName: name,
        amount: data.amount,
        daysLate: data.days_late,
        loanCode: data.loan_code,
        company,
      });
    case "loan_completed":
      return data.overpayment_amount > 0
        ? emailTemplates.loanCompletedWithOverpayment({
            clientName: name,
            loanCode: data.loan_code,
            overpaymentAmount: data.overpayment_amount,
            company,
          })
        : emailTemplates.loanCompleted({
            clientName: name,
            loanCode: data.loan_code,
            company,
          });
    case "loan_waived":
      return emailTemplates.loanWaived({
        clientName: name,
        amount: data.amount,
        loanCode: data.loan_code,
        reason: data.reason,
        company,
      });
    case "loan_waiver_reversed":
      return emailTemplates.loanWaiverReversed({
        clientName: name,
        amount: data.amount,
        loanCode: data.loan_code,
        company,
      });
    default:
      return null;
  }
}

// ── DB logging helpers (match existing inline call-site patterns) ─
async function logSms({ tenantId, clientId, loanId, phone, message, messageType, providerResult }) {
  try {
    await query(
      `INSERT INTO sms_logs (
         tenant_id, client_id, loan_id, phone_number, message,
         message_type, status, cost, provider_response
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        clientId,
        loanId,
        phone,
        message,
        messageType,
        providerResult?.success ? "sent" : "failed",
        providerResult?.cost || null,
        JSON.stringify(providerResult || {}),
      ],
    );
  } catch (err) {
    logger.error("logSms error:", err);
  }
}

async function logEmail({
  tenantId,
  clientId,
  loanId,
  recipient,
  subject,
  messageType,
  providerResult,
  attachment,
}) {
  try {
    await query(
      `INSERT INTO email_logs (
         tenant_id, client_id, loan_id, recipient_email, subject,
         message_type, has_attachment, attachment_name, status, provider_response
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId,
        clientId,
        loanId,
        recipient,
        subject,
        messageType,
        Boolean(attachment),
        attachment || null,
        providerResult?.success ? "sent" : "failed",
        JSON.stringify(providerResult || {}),
      ],
    );
  } catch (err) {
    logger.error("logEmail error:", err);
  }
}

export default { notify };
