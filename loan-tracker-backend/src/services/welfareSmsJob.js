// Daily cron: contribution-due + meeting reminders for every active welfare.
// Gated by WELFARE_SMS_CRON_ENABLED=true; schedule via WELFARE_SMS_CRON_SCHEDULE
// (defaults 8 AM). Idempotent — won't re-send the same reminder type to a phone
// twice in one day.
import cron from "node-cron";
import { runAllWelfareReminders } from "./welfareSmsReminders.js";
import logger from "../config/logger.js";

export function setupWelfareSmsCron() {
  if (process.env.WELFARE_SMS_CRON_ENABLED !== "true") {
    logger.info("Welfare SMS cron disabled (set WELFARE_SMS_CRON_ENABLED=true).");
    return;
  }
  const schedule = process.env.WELFARE_SMS_CRON_SCHEDULE || "0 8 * * *";
  cron.schedule(schedule, async () => {
    try {
      const r = await runAllWelfareReminders();
      logger.info(`Welfare SMS reminders: ${r.contributions} contribution + ${r.meetings} meeting across ${r.groups} welfares.`);
    } catch (err) {
      logger.error("Welfare SMS cron error:", err);
    }
  });
  logger.info(`Welfare SMS cron scheduled (${schedule}).`);
}
