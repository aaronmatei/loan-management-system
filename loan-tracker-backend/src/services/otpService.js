import { query } from "../config/database.js";
import { sendSMS } from "./smsService.js";
import logger from "../config/logger.js";

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Send an OTP to a platform customer. If a tenant context is given,
 * the tenant's monthly OTP quota is enforced (trial plans).
 */
export const sendOTP = async ({
  customerId,
  phoneNumber,
  tenantId = null,
  purpose = "registration",
}) => {
  try {
    if (tenantId) {
      const tr = await query(
        "SELECT otp_count_this_month, otp_quota_per_month, plan FROM tenants WHERE id = $1",
        [tenantId],
      );
      if (tr.rows.length === 0) {
        return { success: false, error: "Tenant not found" };
      }
      const t = tr.rows[0];
      if (
        t.plan === "trial" &&
        t.otp_count_this_month >= t.otp_quota_per_month
      ) {
        return {
          success: false,
          error: "OTP quota exceeded for trial. Please upgrade.",
        };
      }
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await query(
      `UPDATE platform_customers
       SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0, otp_purpose = $3
       WHERE id = $4`,
      [otp, expiresAt, purpose, customerId],
    );

    const message = `Your verification code is: ${otp}\n\nValid for 5 minutes.\nDo not share this code with anyone.`;
    const smsResult = await sendSMS(phoneNumber, message);

    if (!smsResult.success) {
      return { success: false, error: "Failed to send OTP via SMS" };
    }

    if (tenantId) {
      await query(
        "UPDATE tenants SET otp_count_this_month = otp_count_this_month + 1 WHERE id = $1",
        [tenantId],
      );
    }

    logger.info(`✓ OTP sent for customer ${customerId} (${purpose})`);
    const masked = String(phoneNumber).replace(
      /(\d{4})(\d+)(\d{2})/,
      "$1****$3",
    );
    return { success: true, message: `OTP sent to ${masked}` };
  } catch (error) {
    logger.error("Send OTP error:", error);
    return { success: false, error: error.message };
  }
};

/** Verify an OTP for a platform customer. */
export const verifyOTP = async ({
  customerId,
  otp,
  purpose = "registration",
}) => {
  try {
    const r = await query(
      "SELECT otp_code, otp_expires_at, otp_attempts, otp_purpose FROM platform_customers WHERE id = $1",
      [customerId],
    );
    if (r.rows.length === 0) {
      return { success: false, error: "Customer not found" };
    }
    const c = r.rows[0];

    if (!c.otp_code) {
      return {
        success: false,
        error: "No OTP requested. Please request a new one.",
      };
    }
    if (new Date(c.otp_expires_at) < new Date()) {
      return {
        success: false,
        error: "OTP expired. Please request a new one.",
      };
    }
    if (c.otp_attempts >= 5) {
      return {
        success: false,
        error: "Too many failed attempts. Please request a new OTP.",
      };
    }
    if (c.otp_purpose !== purpose) {
      return { success: false, error: "Invalid OTP context" };
    }
    if (c.otp_code !== otp) {
      await query(
        "UPDATE platform_customers SET otp_attempts = otp_attempts + 1 WHERE id = $1",
        [customerId],
      );
      return {
        success: false,
        error: "Invalid OTP",
        attempts_left: 5 - (c.otp_attempts + 1),
      };
    }

    await query(
      `UPDATE platform_customers
       SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0,
           otp_purpose = NULL, phone_verified = TRUE
       WHERE id = $1`,
      [customerId],
    );
    return { success: true, message: "OTP verified successfully" };
  } catch (error) {
    logger.error("Verify OTP error:", error);
    return { success: false, error: error.message };
  }
};

export default { sendOTP, verifyOTP };
