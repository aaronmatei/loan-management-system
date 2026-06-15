// Daily cron: accrue late-contribution penalties for every active welfare.
// Gated by WELFARE_PENALTY_CRON_ENABLED=true; schedule via
// WELFARE_PENALTY_CRON_SCHEDULE (defaults 1 AM). Idempotent — safe to re-run.
import cron from "node-cron";
import { accrueAllWelfarePenalties } from "./welfarePenaltyAccrual.js";
import logger from "../config/logger.js";

export function setupWelfarePenaltyCron() {
  if (process.env.WELFARE_PENALTY_CRON_ENABLED !== "true") {
    logger.info("Welfare penalty cron disabled (set WELFARE_PENALTY_CRON_ENABLED=true).");
    return;
  }
  const schedule = process.env.WELFARE_PENALTY_CRON_SCHEDULE || "0 1 * * *";
  cron.schedule(schedule, async () => {
    try {
      const r = await accrueAllWelfarePenalties();
      logger.info(`Welfare penalty accrual: ${r.assessed} new across ${r.tenants} welfares.`);
    } catch (err) {
      logger.error("Welfare penalty cron error:", err);
    }
  });
  logger.info(`Welfare penalty cron scheduled (${schedule}).`);
}
