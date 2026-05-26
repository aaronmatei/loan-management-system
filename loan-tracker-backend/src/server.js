// Production entrypoint: load env FIRST (so config/database.js reads the
// right vars when app.js's route imports pull it in), then connect the
// DB, start listening, and register the cron jobs. The Express app itself
// lives in app.js so tests can import it without starting a server.
import "dotenv/config.js";
import logger from "./config/logger.js";
import { connectDB } from "./config/database.js";
import app from "./app.js";
import { setupScheduledBackups } from "./services/scheduler.js";
import { setupPaymentNotifications } from "./services/paymentReminderJob.js";
import { setupBillingCron, setupInvoiceGenerationCron } from "./services/billingCronJob.js";
import { setupDemoReset } from "./services/demoResetJob.js";
import { runOverdueCheck } from "./utils/overdueChecker.js";

// Database
connectDB();

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV}`);
  console.log(`✓ API URL: http://localhost:${PORT}/api`);
  console.log(
    `✓ CORS enabled for: http://localhost:5173, http://localhost:5174`,
  );

  // Keep overdue payment statuses up-to-date on every startup
  runOverdueCheck()
    .then((count) =>
      console.log(`✓ Startup overdue check: ${count} payment(s) marked`),
    )
    .catch((err) => logger.error("Startup overdue check failed:", err));

  // Register the daily backup cron (no-ops unless BACKUP_SCHEDULE_ENABLED)
  setupScheduledBackups();
  setupPaymentNotifications();
  setupBillingCron();
  setupInvoiceGenerationCron();
  setupDemoReset();
});
