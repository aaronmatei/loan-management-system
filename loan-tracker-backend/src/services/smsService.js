import africastalking from "africastalking";
import logger from "../config/logger.js";

// Lazily create the Africastalking client the first time we actually
// need to send. This keeps the server from crashing at import time
// when credentials are absent (e.g. SMS disabled in dev).
let smsClient = null;
const getSmsClient = () => {
  if (smsClient) return smsClient;
  const AT = africastalking({
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME || "sandbox",
  });
  smsClient = AT.SMS;
  return smsClient;
};

// Format a Kenyan phone number to +254 international format
const formatPhone = (phone) => {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "+254" + cleaned.substring(1);
  }
  if (!cleaned.startsWith("+")) {
    cleaned = "+254" + cleaned;
  }
  return cleaned;
};

export const sendSMS = async (to, message) => {
  try {
    if (process.env.SMS_ENABLED !== "true") {
      logger.info(`📱 SMS DISABLED - Would have sent to ${to}: ${message}`);
      return {
        success: true,
        disabled: true,
        message: "SMS notifications are disabled",
      };
    }

    const formattedPhone = formatPhone(to);
    if (!formattedPhone) {
      return { success: false, error: "Invalid phone number" };
    }

    const options = {
      to: [formattedPhone],
      message: message,
      from: process.env.SMS_SENDER_ID || "AFRICASTKNG",
    };

    const result = await getSmsClient().send(options);

    logger.info(
      `✓ SMS sent to ${formattedPhone}: ${message.substring(0, 50)}...`,
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    logger.error("SMS send error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

export const sendBulkSMS = async (recipients) => {
  const results = [];
  for (const recipient of recipients) {
    const result = await sendSMS(recipient.phone, recipient.message);
    results.push({
      phone: recipient.phone,
      ...result,
    });
    // Small delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return results;
};

export const templates = {
  paymentReceived: (clientName, amount, loanCode, balance) =>
    `Dear ${clientName}, we have received your payment of KES ${parseFloat(amount).toLocaleString()} for loan ${loanCode}. Balance: KES ${parseFloat(balance).toLocaleString()}. Thank you! - ${process.env.COMPANY_NAME}`,

  paymentReminder: (clientName, amount, dueDate, loanCode) =>
    `Dear ${clientName}, this is a reminder that your payment of KES ${parseFloat(amount).toLocaleString()} for loan ${loanCode} is due on ${new Date(dueDate).toLocaleDateString()}. Please pay on time. - ${process.env.COMPANY_NAME}`,

  overdueNotice: (clientName, amount, daysLate, loanCode) =>
    `Dear ${clientName}, your payment of KES ${parseFloat(amount).toLocaleString()} for loan ${loanCode} is ${daysLate} days overdue. Please make payment immediately to avoid penalties. Call ${process.env.COMPANY_PHONE} - ${process.env.COMPANY_NAME}`,

  loanApproved: (clientName, amount, loanCode) =>
    `Congratulations ${clientName}! Your loan ${loanCode} of KES ${parseFloat(amount).toLocaleString()} has been approved and disbursed. Repayment terms apply. - ${process.env.COMPANY_NAME}`,

  loanCompleted: (clientName, loanCode) =>
    `Congratulations ${clientName}! Your loan ${loanCode} has been fully repaid. You can now apply for a new loan. Thank you for your business! - ${process.env.COMPANY_NAME}`,

  refundProcessed: (clientName, amount, loanCode) =>
    `Dear ${clientName}, your refund of KES ${parseFloat(amount).toLocaleString()} for loan ${loanCode} has been processed. Thank you. - ${process.env.COMPANY_NAME}`,

  custom: (message) => message,
};

export default {
  sendSMS,
  sendBulkSMS,
  templates,
};
