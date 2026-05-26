// Tenant-facing automation: the cron-driven jobs that affect a lender's OWN
// borrowers — payment reminders, overdue nudges and overdue-status refresh —
// plus the cadence settings that drive them. The platform-wide jobs (tenant
// billing, suspend/reactivate, backups, demo reset) stay in platform admin.
//
// The schedules themselves are global (one server cron); here a tenant tunes
// its own cadence and can trigger a run scoped to its own data on demand.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { runDailyPaymentNotifications } from "../services/paymentReminderJob.js";
import { runOverdueCheck } from "../utils/overdueChecker.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken, authorize("admin", "manager"));

const tid = (req) => req.user?.tenant_id;

// Current cadence settings + the (read-only) automated schedule.
router.get("/status", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) {
      return res.status(400).json({ error: "No tenant context — re-login required" });
    }
    const r = await query(
      `SELECT COALESCE(reminder_days_before, 3)            AS reminder_days_before,
              COALESCE(overdue_reminder_frequency_days, 3) AS overdue_reminder_frequency_days
         FROM tenants WHERE id = $1`,
      [t],
    );
    res.json({
      success: true,
      data: {
        settings: r.rows[0] || {
          reminder_days_before: 3,
          overdue_reminder_frequency_days: 3,
        },
        // Read-only: the platform runs these automatically; tenants tune
        // cadence and can also trigger a run on demand.
        schedule: {
          reminders_enabled: process.env.REMINDER_CRON_ENABLED === "true",
          reminders_cron: process.env.REMINDER_CRON_SCHEDULE || "0 8 * * *",
        },
      },
    });
  } catch (error) {
    logger.error("Automation status error:", error);
    res.status(500).json({ error: "Failed to load automation status" });
  }
});

// Update this tenant's reminder cadence.
router.put("/settings", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) {
      return res.status(400).json({ error: "No tenant context — re-login required" });
    }
    const { reminder_days_before, overdue_reminder_frequency_days } = req.body || {};
    const num = (v) =>
      v === undefined || v === null || v === "" ? null : Number(v);
    const rdb = num(reminder_days_before);
    const ofreq = num(overdue_reminder_frequency_days);

    if (rdb !== null && (!Number.isInteger(rdb) || rdb < 0 || rdb > 30)) {
      return res
        .status(400)
        .json({ error: "Reminder days before must be a whole number 0–30" });
    }
    if (ofreq !== null && (!Number.isInteger(ofreq) || ofreq < 1 || ofreq > 30)) {
      return res
        .status(400)
        .json({ error: "Overdue reminder frequency must be a whole number 1–30" });
    }

    await query(
      `UPDATE tenants
          SET reminder_days_before            = COALESCE($1, reminder_days_before),
              overdue_reminder_frequency_days = COALESCE($2, overdue_reminder_frequency_days),
              updated_at = NOW()
        WHERE id = $3`,
      [rdb, ofreq, t],
    );
    res.json({ success: true, message: "Automation settings updated" });
  } catch (error) {
    logger.error("Automation settings error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// Run a job now, scoped to this tenant.
//   reminders → send due-soon + overdue notifications to this tenant's clients
//   overdue   → refresh which installments are overdue
router.post("/run", async (req, res) => {
  try {
    const t = tid(req);
    if (!t) {
      return res.status(400).json({ error: "No tenant context — re-login required" });
    }
    const { task } = req.body || {};
    let result;
    if (task === "reminders") {
      result = await runDailyPaymentNotifications(t);
    } else if (task === "overdue") {
      result = { marked_overdue: await runOverdueCheck() };
    } else {
      return res
        .status(400)
        .json({ error: "Unknown task. Use 'reminders' or 'overdue'." });
    }

    await logAudit({
      user: req.user,
      action: "automation_run",
      entityType: "automation",
      description: `Ran automation task: ${task}`,
      newValues: { task, result },
      req,
    });

    res.json({ success: true, task, result });
  } catch (error) {
    logger.error("Automation run error:", error);
    res.status(500).json({ error: "Failed to run task" });
  }
});

export default router;
