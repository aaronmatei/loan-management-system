import "dotenv/config.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import logger from "./config/logger.js";
import { connectDB } from "./config/database.js";
import { errorHandler } from "./middleware/errorHandler.js";

// ⚠️ MAKE SURE THIS IMPORT EXISTS
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/clients.js";
import loanRoutes from "./routes/loans.js";
import paymentRoutes from "./routes/payments.js";
import dashboardRoutes from "./routes/dashboard.js";
import overdueRoutes from "./routes/overdue.js";
import capitalRoutes from "./routes/capital.js";
import reportsRoutes from "./routes/reports.js";
import smsRoutes from "./routes/sms.js";
import emailRoutes from "./routes/email.js";
import settingsRoutes from "./routes/settings.js";
import auditRoutes from "./routes/audit.js";
import userRoutes from "./routes/users.js";
import backupRoutes from "./routes/backup.js";
import analyticsRoutes from "./routes/analytics.js";
import { setupScheduledBackups } from "./services/scheduler.js";
import { runOverdueCheck } from "./utils/overdueChecker.js";

const app = express();

// CORS - allow both 5173 and 5174
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Middleware
app.use(helmet());
app.use(morgan("combined"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Database
connectDB();

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ⚠️ THIS LINE IS CRITICAL - Routes must be registered!
app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/overdue", overdueRoutes);
app.use("/api/capital", capitalRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/users", userRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/analytics", analyticsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use(errorHandler);

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
});
