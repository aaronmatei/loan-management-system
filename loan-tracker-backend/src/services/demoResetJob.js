// Daily 3 AM cron: rewipes the demo tenant + reseeds it.
//
// The actual reset logic lives in scripts/seed-demo-data.js as the
// exported `resetDemoData()` function — the script is also runnable
// standalone via CLI for one-shot bootstrapping. Importing across the
// scripts/ ↔ src/ boundary is intentional: the seed shouldn't be
// duplicated.
//
// Gated by env DEMO_RESET_CRON_ENABLED=true. Schedule via
// DEMO_RESET_CRON_SCHEDULE (defaults "0 3 * * *" — 3 AM Africa/Nairobi
// is a quiet hour; runs after the 8 AM payment-reminder + billing
// crons so morning loads aren't competing for connections).

import cron from "node-cron";
import { resetDemoData } from "../../scripts/seed-demo-data.js";
import logger from "../config/logger.js";

export { resetDemoData };

export function setupDemoReset() {
  if (process.env.DEMO_RESET_CRON_ENABLED !== "true") {
    logger.info("🎮 Demo reset cron DISABLED");
    return;
  }
  const expr = process.env.DEMO_RESET_CRON_SCHEDULE || "0 3 * * *";
  if (!cron.validate(expr)) {
    logger.error(`🎮 Invalid DEMO_RESET_CRON_SCHEDULE "${expr}" — not started`);
    return;
  }
  logger.info(`🎮 Demo reset cron ENABLED: ${expr}`);
  cron.schedule(
    expr,
    () => {
      logger.info("🎮 Demo reset cron tick…");
      resetDemoData()
        .then((s) =>
          logger.info(
            `🎮 Demo reset complete: ${s.clients} clients · ${s.loans} loans · ${s.pending_apps} apps · ${s.payments} payments`,
          ),
        )
        .catch((err) => logger.error("demo reset error:", err));
    },
    { timezone: "Africa/Nairobi" },
  );
}

export default { setupDemoReset, resetDemoData };
