// Platform-admin endpoints for cron observability + manual triggers.
// Mounted at /api/platform/cron, gated by verifyToken + is_platform_admin
// (mirrors routes/platform/admin.js).
//
// GET  /status       — what's enabled, when it runs
// POST /trigger      — { task } where task is one of:
//                      reminders | overdue | tenant_invoices | suspend |
//                      reactivate | summary | all

import express from "express";
import { verifyToken } from "../../middleware/auth.js";
import billingCron from "../../services/billingCronJob.js";
import {
  runDailyPaymentNotifications,
} from "../../services/paymentReminderJob.js";
import { resetDemoData } from "../../services/demoResetJob.js";
import referralService from "../../services/referralService.js";
import logger from "../../config/logger.js";

const router = express.Router();

const requirePlatformAdmin = (req, res, next) => {
  if (!req.user?.is_platform_admin) {
    return res.status(403).json({ error: "Platform admin only" });
  }
  next();
};

router.use(verifyToken, requirePlatformAdmin);

router.get("/status", (req, res) => {
  res.json({
    success: true,
    data: {
      payment_reminders: {
        enabled: process.env.REMINDER_CRON_ENABLED === "true",
        schedule: process.env.REMINDER_CRON_SCHEDULE || "0 8 * * *",
        description:
          "Customer payment reminders (N days before due) + overdue nudges",
      },
      billing: {
        enabled: process.env.BILLING_CRON_ENABLED === "true",
        schedule: process.env.BILLING_CRON_SCHEDULE || "0 8 * * *",
        description:
          "Mark invoices overdue, auto-suspend / reactivate tenants, daily admin summary",
      },
      backups: {
        enabled: process.env.BACKUP_SCHEDULE_ENABLED === "true",
        schedule: process.env.BACKUP_SCHEDULE_CRON || "0 2 * * *",
        description: "Scheduled DB backups",
      },
      demo_reset: {
        enabled: process.env.DEMO_RESET_CRON_ENABLED === "true",
        schedule: process.env.DEMO_RESET_CRON_SCHEDULE || "0 3 * * *",
        description:
          "Wipe + reseed the public demo tenant so prospects see a clean snapshot",
      },
    },
  });
});

router.post("/trigger", async (req, res) => {
  const { task } = req.body || {};
  logger.info(`Manual cron trigger by user=${req.user.id}: ${task}`);
  try {
    let result;
    switch (task) {
      case "reminders":
        // payment_reminder + payment_overdue together (paymentReminderJob
        // covers both — same function, no separate task).
      case "overdue":
        result = await runDailyPaymentNotifications();
        break;
      case "tenant_invoices":
        result = { tenant_invoices_overdue: await billingCron.markOverdueInvoices() };
        break;
      case "suspend":
        result = { tenants_suspended: await billingCron.autoSuspendTenants() };
        break;
      case "reactivate":
        result = { tenants_reactivated: await billingCron.autoReactivateTenants() };
        break;
      case "summary":
        result = await billingCron.sendDailySummary({});
        break;
      case "reset_demo":
        result = await resetDemoData();
        break;
      case "referrals":
        result = {
          referrals_qualified: await referralService.processPendingReferrals(),
        };
        break;
      case "all": {
        const a = await runDailyPaymentNotifications();
        const b = await billingCron.runBillingDailyTasks();
        result = { payment_notifications: a, billing: b };
        break;
      }
      default:
        return res.status(400).json({
          error:
            "Unknown task. Use one of: reminders, overdue, tenant_invoices, suspend, reactivate, summary, reset_demo, referrals, all",
        });
    }
    res.json({ success: true, task, result });
  } catch (err) {
    logger.error("cron trigger error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
