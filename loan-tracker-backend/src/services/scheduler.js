import cron from "node-cron";
import { createBackup, cleanupOldBackups } from "./backupService.js";
import logger from "../config/logger.js";

export const setupScheduledBackups = () => {
  if (process.env.BACKUP_SCHEDULE_ENABLED !== "true") {
    logger.info("📅 Scheduled backups DISABLED");
    return;
  }

  const cronExpression = process.env.BACKUP_SCHEDULE_CRON || "0 2 * * *";

  if (!cron.validate(cronExpression)) {
    logger.error(
      `📅 Invalid BACKUP_SCHEDULE_CRON "${cronExpression}" — scheduler not started`,
    );
    return;
  }

  logger.info(`📅 Scheduled backups ENABLED: ${cronExpression}`);

  cron.schedule(cronExpression, async () => {
    logger.info("🔄 Running scheduled backup...");
    try {
      const result = await createBackup({ type: "scheduled", userId: null });
      if (result.success) {
        logger.info(`✓ Scheduled backup completed: ${result.filename}`);
        const retentionDays = parseInt(
          process.env.BACKUP_RETENTION_DAYS || "30",
          10,
        );
        await cleanupOldBackups(retentionDays);
      } else {
        logger.error(`✗ Scheduled backup failed: ${result.error}`);
      }
    } catch (error) {
      logger.error("Scheduled backup error:", error);
    }
  });
};

export default { setupScheduledBackups };
