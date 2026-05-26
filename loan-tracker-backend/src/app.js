// Express app factory — builds and exports the configured app WITHOUT
// connecting to the DB or calling listen(). This lets tests import the
// real app (via supertest) without starting a server or the cron jobs.
// server.js wraps this: loads env, connectDB(), app.listen(), crons.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/errorHandler.js";

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
import billingRoutes from "./routes/billing.js";
import auditRoutes from "./routes/audit.js";
import userRoutes from "./routes/users.js";
import backupRoutes from "./routes/backup.js";
import analyticsRoutes from "./routes/analytics.js";
import notificationRoutes from "./routes/notifications.js";
import tenantRoutes from "./routes/tenants.js";
import referralRoutes from "./routes/referrals.js";
import promoRoutes from "./routes/promos.js";
import mpesaRoutes from "./routes/mpesa.js";
import portalAuthRoutes from "./routes/portal/auth.js";
import portalCustomerRoutes from "./routes/portal/customer.js";
import platformAdminRoutes from "./routes/platform/admin.js";
import platformCronRoutes from "./routes/platform/cron.js";
import platformAuditRoutes from "./routes/platform/audit.js";
import demoRoutes from "./routes/demo.js";
import platformBillingRoutes from "./routes/platform/billing.js";
import onboardingRoutes from "./routes/onboarding.js";
import whiteLabelRoutes from "./routes/whiteLabel.js";
import widgetRoutes from "./routes/widget.js";

const app = express();

// CORS - local dev origins plus any extra origins from CORS_ORIGINS
// (comma-separated): used for E2E on an alt port and for the deployed
// frontend origin in production.
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  ...(process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : []),
];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Tenant-Subdomain",
      "X-Tenant-ID",
      "X-Requested-With",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);

// Middleware
app.use(helmet());
// Skip request logging under test to keep test output readable.
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined"));
}
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ⚠️ Routes must be registered!
app.use("/api/auth", authRoutes);
app.use("/api/tenants", tenantRoutes); // public: signup + subdomain check
app.use("/api/portal/auth", portalAuthRoutes); // public: customer auth/OTP
app.use("/api/portal/customer", portalCustomerRoutes); // verifyCustomer-gated
app.use("/api/platform/admin", platformAdminRoutes); // verifyToken + is_platform_admin
app.use("/api/platform/cron", platformCronRoutes); // verifyToken + is_platform_admin
app.use("/api/platform/audit", platformAuditRoutes); // verifyToken + is_platform_admin
app.use("/api/demo", demoRoutes); // PUBLIC — no auth
app.use("/api/platform/billing", platformBillingRoutes); // verifyToken + is_platform_admin
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/white-label", whiteLabelRoutes);
app.use("/api/widget", widgetRoutes); // PUBLIC — embeddable on third-party sites
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
app.use("/api/billing", billingRoutes); // tenant's own platform invoices
app.use("/api/audit", auditRoutes);
app.use("/api/users", userRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/referrals", referralRoutes); // /me authed; /validate/:code public
app.use("/api/promos", promoRoutes); // CRUD authed; /validate/:code public
app.use("/api/mpesa", mpesaRoutes); // STK push; /callback is PUBLIC (Safaricom)

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

export default app;
