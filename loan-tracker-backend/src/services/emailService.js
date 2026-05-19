import nodemailer from "nodemailer";
import { query } from "../config/database.js";
import logger from "../config/logger.js";

// Lazily create the Nodemailer transporter the first time we actually
// need to send. Mirrors smsService.js: this keeps the server from
// failing at import time when SMTP credentials are absent (e.g. email
// disabled in dev).
let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;
  const port = parseInt(process.env.EMAIL_PORT || "587", 10);
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure: port === 465, // true for 465 (implicit TLS), false for 587 (STARTTLS)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  return transporter;
};

// Company details for email headers/footers. Pulled from the
// company_settings table (same source as the loan agreement PDF) with
// environment variables as a fallback. Queried per send rather than
// cached so Settings-page edits take effect without a restart.
// `tid` is the tenant whose branding to use (the client/loan's
// tenant). Required for correct per-tenant letterheads; when absent
// (or no row) we fall back to environment defaults rather than
// leaking another tenant's company details.
export const getCompanySettings = async (tid) => {
  const fallback = {
    name: process.env.COMPANY_NAME || "Your Company",
    phone: process.env.COMPANY_PHONE || "",
    email:
      process.env.EMAIL_FROM || process.env.EMAIL_USER || "",
    website: process.env.COMPANY_WEBSITE || "",
    address: "",
  };
  if (tid == null) return fallback;
  try {
    const result = await query(
      "SELECT * FROM company_settings WHERE tenant_id = $1",
      [tid],
    );
    const c = result.rows[0];
    if (!c) return fallback;
    return {
      name: c.company_name || fallback.name,
      phone: c.company_phone || fallback.phone,
      email: c.company_email || fallback.email,
      website: c.company_website || fallback.website,
      address: c.company_address || fallback.address,
    };
  } catch (error) {
    logger.error("Failed to load company settings for email:", error);
    return fallback;
  }
};

// Test SMTP connectivity (used by GET /api/email/test).
export const testConnection = async () => {
  try {
    await getTransporter().verify();
    return { success: true, message: "Email service ready" };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const sendEmail = async ({ to, subject, html, attachments = [] }) => {
  try {
    if (process.env.EMAIL_ENABLED !== "true") {
      logger.info(
        `📧 EMAIL DISABLED - Would have sent to ${to}: ${subject}`,
      );
      return {
        success: true,
        disabled: true,
        message: "Email notifications are disabled",
      };
    }

    if (!to) {
      return { success: false, error: "Recipient email is required" };
    }

    const fromName = process.env.EMAIL_FROM_NAME || "Loan Tracker";
    const fromAddress =
      process.env.EMAIL_FROM || process.env.EMAIL_USER;

    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to,
      subject,
      html,
      attachments,
    });

    logger.info(`✓ Email sent to ${to}: ${subject}`);

    return { success: true, messageId: info.messageId, data: info };
  } catch (error) {
    logger.error("Email send error:", error);
    return { success: false, error: error.message };
  }
};

export const sendBulkEmail = async (recipients) => {
  const results = [];
  for (const recipient of recipients) {
    const result = await sendEmail(recipient);
    results.push({ to: recipient.to, ...result });
    // Small delay to stay well under Gmail/SendGrid rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return results;
};

// ============================================================
// HTML TEMPLATES
// ============================================================

// Shared responsive shell so every template has a consistent
// header/footer and we don't repeat the boilerplate HTML.
const baseLayout = ({ accent, contentBg, border, title, subtitle, body, company }) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f3f4f6; }
    .header { background: ${accent}; color: #fff; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .header h1 { margin: 0 0 6px; font-size: 22px; }
    .header p { margin: 0; opacity: 0.9; }
    .content { background: ${contentBg}; padding: 30px; border: 1px solid ${border}; }
    .footer { background: #1f2937; color: #fff; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; }
    .info-box { background: #fff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #4F46E5; }
    .info-row { padding: 6px 0; border-bottom: 1px solid #f1f1f1; }
    .info-row .label { color: #6b7280; }
    .info-row .value { font-weight: bold; color: #1f2937; float: right; }
    .amount { font-size: 30px; font-weight: bold; color: #059669; }
    .muted { color: #6b7280; margin: 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    ${subtitle ? `<p>${subtitle}</p>` : ""}
  </div>
  <div class="content">
    ${body}
  </div>
  <div class="footer">
    <p><strong>${company.name}</strong></p>
    <p>${company.phone ? `📞 ${company.phone}` : ""}${
      company.phone && company.website ? " | " : ""
    }${company.website ? `🌐 ${company.website}` : ""}</p>
    <p style="margin-top: 10px; opacity: 0.7;">This is an automated email. Please do not reply.</p>
  </div>
</body>
</html>`;

const money = (amount) => `KES ${parseFloat(amount || 0).toLocaleString()}`;
const day = (date) => new Date(date).toLocaleDateString("en-KE");

export const templates = {
  paymentReceived: ({
    clientName,
    amount,
    loanCode,
    balance,
    transactionCode,
    paymentMethod,
    paymentDate,
    company,
  }) => ({
    subject: `Payment Received - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #4F46E5, #7C3AED)",
      contentBg: "#f9fafb",
      border: "#e5e7eb",
      title: "✅ Payment Received",
      subtitle: "Thank you for your payment",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>We have successfully received your payment. Below are the details:</p>
        <div class="info-box">
          <div style="text-align:center;margin-bottom:15px;">
            <p class="muted">Amount Paid</p>
            <p class="amount">${money(amount)}</p>
          </div>
          <div class="info-row"><span class="label">Transaction Code:</span><span class="value">${transactionCode}</span></div>
          <div class="info-row"><span class="label">Loan Code:</span><span class="value">${loanCode}</span></div>
          <div class="info-row"><span class="label">Payment Date:</span><span class="value">${day(paymentDate)}</span></div>
          <div class="info-row"><span class="label">Payment Method:</span><span class="value">${paymentMethod}</span></div>
          <div class="info-row"><span class="label">Remaining Balance:</span><span class="value" style="color:${
            parseFloat(balance) > 0 ? "#dc2626" : "#059669"
          };">${money(balance)}</span></div>
        </div>
        <p>📎 <strong>Receipt Attached</strong> — please find your official receipt attached to this email.</p>
        <p style="margin-top:24px;">Thank you for choosing ${company.name}!</p>
      `,
    }),
  }),

  paymentReminder: ({
    clientName,
    amount,
    dueDate,
    loanCode,
    daysUntilDue,
    company,
  }) => ({
    subject: `Payment Reminder - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #F59E0B, #EF4444)",
      contentBg: "#fff7ed",
      border: "#fed7aa",
      title: "⏰ Payment Reminder",
      subtitle: `Your payment is due in ${daysUntilDue} day(s)`,
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>This is a friendly reminder that your loan payment is due soon.</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;text-align:center;border:2px dashed #F59E0B;">
          <p class="muted">Amount Due</p>
          <p style="font-size:26px;font-weight:bold;color:#dc2626;margin:6px 0;">${money(amount)}</p>
          <p class="muted">Due Date</p>
          <p style="font-size:18px;font-weight:bold;color:#1f2937;margin:6px 0;">${new Date(
            dueDate,
          ).toLocaleDateString("en-KE", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}</p>
        </div>
        <p><strong>Loan Code:</strong> ${loanCode}</p>
        <p style="background:#fef3c7;padding:15px;border-radius:8px;margin:20px 0;">💡 <strong>Tip:</strong> Pay on time to keep a good credit score and qualify for higher loan amounts.</p>
      `,
    }),
  }),

  overdueNotice: ({ clientName, amount, daysLate, loanCode, company }) => ({
    subject: `URGENT: Overdue Payment - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #DC2626, #991B1B)",
      contentBg: "#fef2f2",
      border: "#fecaca",
      title: "🚨 Overdue Payment",
      subtitle: "Immediate action required",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <div style="background:#fff;border:2px solid #dc2626;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;color:#dc2626;font-weight:bold;font-size:17px;">⚠️ Your payment is ${daysLate} day(s) overdue</p>
        </div>
        <p>Please settle this immediately to avoid late penalties, additional interest, a negative credit record, and possible recovery proceedings.</p>
        <div style="text-align:center;background:#fff;padding:20px;border-radius:8px;margin:20px 0;">
          <p class="muted">Amount Due</p>
          <p style="font-size:30px;font-weight:bold;color:#dc2626;margin:6px 0;">${money(amount)}</p>
          <p class="muted">Loan: ${loanCode}</p>
        </div>
        <p style="background:#fef3c7;padding:15px;border-radius:8px;">📞 <strong>Need help?</strong> Contact us at ${
          company.phone || "our office"
        } to arrange a payment plan.</p>
      `,
    }),
  }),

  loanApproved: ({
    clientName,
    loanCode,
    principalAmount,
    totalDue,
    duration,
    company,
  }) => ({
    subject: `🎉 Loan Approved - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #059669, #10B981)",
      contentBg: "#f0fdf4",
      border: "#bbf7d0",
      title: "🎉 Loan Approved!",
      subtitle: `Congratulations, ${clientName}`,
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Great news! Your loan has been approved and disbursed.</p>
        <div class="info-box">
          <div class="info-row"><span class="label">Loan Code:</span><span class="value">${loanCode}</span></div>
          <div class="info-row"><span class="label">Principal Amount:</span><span class="value">${money(
            principalAmount,
          )}</span></div>
          <div class="info-row"><span class="label">Total Repayable:</span><span class="value">${money(
            totalDue,
          )}</span></div>
          <div class="info-row"><span class="label">Duration:</span><span class="value">${duration} months</span></div>
        </div>
        <p>📎 <strong>Loan Agreement Attached</strong> — please review the attached agreement and keep it for your records.</p>
        <p>Please make payments on time to maintain a good credit standing.</p>
      `,
    }),
  }),

  loanCompleted: ({
    clientName,
    loanCode,
    totalPaid,
    principalAmount,
    totalInterest,
    company,
  }) => ({
    subject: `🎉 Loan Fully Repaid - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #059669, #10B981)",
      contentBg: "#f0fdf4",
      border: "#bbf7d0",
      title: "🎊 Loan Fully Repaid!",
      subtitle: "Congratulations on completing your loan",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>You have successfully repaid your loan in full — a significant achievement! 🌟</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;text-align:center;border:2px solid #059669;">
          <p class="muted" style="text-transform:uppercase;letter-spacing:1px;font-size:13px;">Loan Status</p>
          <p style="font-size:30px;font-weight:bold;color:#059669;margin:10px 0;">PAID IN FULL ✓</p>
          <p style="margin:0;">Loan ${loanCode}</p>
        </div>
        <div class="info-box" style="border-left-color:#10B981;">
          <div class="info-row"><span class="label">Principal Amount:</span><span class="value">${money(
            principalAmount,
          )}</span></div>
          <div class="info-row"><span class="label">Total Interest Paid:</span><span class="value">${money(
            totalInterest,
          )}</span></div>
          <div class="info-row" style="border-bottom:none;"><span class="label" style="color:#059669;font-weight:bold;">Total Amount Paid:</span><span class="value" style="color:#059669;">${money(
            totalPaid,
          )}</span></div>
        </div>
        <p>🌟 Your timely payments have earned you a positive credit history with us — qualifying you for higher loan amounts, lower interest rates, faster approvals, and priority service.</p>
        <p style="margin-top:24px;">Thank you for trusting ${
          company.name
        }. We look forward to serving you again!</p>
      `,
    }),
  }),

  loanCompletedWithOverpayment: ({
    clientName,
    loanCode,
    totalPaid,
    overpaymentAmount,
    principalAmount,
    totalInterest,
    company,
  }) => ({
    subject: `🎉 Loan Fully Repaid + Refund Due - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #7C3AED, #4F46E5)",
      contentBg: "#faf5ff",
      border: "#e9d5ff",
      title: "🎊 Loan Fully Repaid!",
      subtitle: "Loan repaid + a refund is coming your way",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Excellent news! You have fully repaid your loan. We also noticed you paid more than required, so a refund is due to you.</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;text-align:center;border:2px solid #059669;">
          <p class="muted" style="text-transform:uppercase;letter-spacing:1px;font-size:13px;">Loan Status</p>
          <p style="font-size:30px;font-weight:bold;color:#059669;margin:10px 0;">PAID IN FULL ✓</p>
          <p style="margin:0;">Loan ${loanCode}</p>
        </div>
        <div style="background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;padding:22px;border-radius:8px;margin:20px 0;text-align:center;">
          <p style="margin:0;font-size:15px;">💰 Refund Due to You</p>
          <p style="font-size:30px;font-weight:bold;margin:10px 0;">${money(
            overpaymentAmount,
          )}</p>
          <p style="margin:0;font-size:13px;opacity:0.9;">We will process your refund within 3–5 business days</p>
        </div>
        <div class="info-box" style="border-left-color:#7C3AED;">
          <div class="info-row"><span class="label">Principal Amount:</span><span class="value">${money(
            principalAmount,
          )}</span></div>
          <div class="info-row"><span class="label">Total Interest:</span><span class="value">${money(
            totalInterest,
          )}</span></div>
          <div class="info-row"><span class="label">Total Paid:</span><span class="value">${money(
            totalPaid,
          )}</span></div>
          <div class="info-row" style="border-bottom:none;"><span class="label" style="color:#7C3AED;font-weight:bold;">Overpayment (Refund Due):</span><span class="value" style="color:#7C3AED;">${money(
            overpaymentAmount,
          )}</span></div>
        </div>
        <p style="background:#fef3c7;padding:15px;border-radius:8px;">📝 <strong>Note:</strong> Please contact us${
          company.phone ? ` at ${company.phone}` : ""
        } to confirm your preferred refund method (M-Pesa, Bank Transfer, or Cash).</p>
        <p style="margin-top:24px;">Thank you for your business! You can now apply for a new loan with even better terms.</p>
      `,
    }),
  }),

  refundProcessed: ({
    clientName,
    loanCode,
    refundAmount,
    refundMethod,
    refundReference,
    refundDate,
    company,
  }) => ({
    subject: `✅ Refund Processed - ${loanCode}`,
    html: baseLayout({
      accent: "linear-gradient(135deg, #059669, #10B981)",
      contentBg: "#f0fdf4",
      border: "#bbf7d0",
      title: "✅ Refund Processed",
      subtitle: "Your refund has been completed",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>This is to confirm that your refund has been successfully processed.</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;text-align:center;">
          <p class="muted">Refund Amount</p>
          <p class="amount">${money(refundAmount)}</p>
        </div>
        <div class="info-box" style="border-left-color:#10B981;">
          <div class="info-row"><span class="label">Loan Code:</span><span class="value">${loanCode}</span></div>
          <div class="info-row"><span class="label">Refund Method:</span><span class="value">${refundMethod}</span></div>
          ${
            refundReference
              ? `<div class="info-row"><span class="label">Reference:</span><span class="value">${refundReference}</span></div>`
              : ""
          }
          <div class="info-row" style="border-bottom:none;"><span class="label">Refund Date:</span><span class="value">${day(
            refundDate,
          )}</span></div>
        </div>
        <p style="margin-top:24px;">Thank you for your continued trust in ${
          company.name
        }.</p>
      `,
    }),
  }),

  custom: ({ subject, message, clientName, company }) => ({
    subject,
    html: baseLayout({
      accent: "linear-gradient(135deg, #4F46E5, #7C3AED)",
      contentBg: "#f9fafb",
      border: "#e5e7eb",
      title: subject,
      subtitle: "",
      company,
      body: `
        <p>Dear <strong>${clientName}</strong>,</p>
        <div style="white-space:pre-wrap;">${message.replace(/\n/g, "<br>")}</div>
      `,
    }),
  }),
};

export default {
  sendEmail,
  sendBulkEmail,
  testConnection,
  getCompanySettings,
  templates,
};
