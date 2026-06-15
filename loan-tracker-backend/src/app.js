// Express app factory — builds and exports the configured app WITHOUT
// connecting to the DB or calling listen(). This lets tests import the
// real app (via supertest) without starting a server or the cron jobs.
// server.js wraps this: loads env, connectDB(), app.listen(), crons.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/errorHandler.js";
import {
  sentryInit,
  sentryRequestHandler,
  sentryErrorHandler,
} from "./config/sentry.js";

// Initialize Sentry as early as possible so any subsequent module's
// import-time error is captured. No-op when SENTRY_DSN isn't set, so
// dev / test / non-prod environments are unaffected.
sentryInit();

import authRoutes from "./routes/auth.js";
import { authLimiter } from "./middleware/rateLimit.js";
import clientRoutes from "./routes/clients.js";
import branchRoutes from "./routes/branches.js";
import packageRoutes from "./routes/packages.js";
import loanRoutes from "./routes/loans.js";
import paymentRoutes from "./routes/payments.js";
import dashboardRoutes from "./routes/dashboard.js";
import overdueRoutes from "./routes/overdue.js";
import capitalRoutes from "./routes/capital.js";
import underwritingRoutes from "./routes/underwriting.js";
import pawnRoutes from "./routes/pawn.js";
import vehicleSecurityRoutes from "./routes/vehicleSecurity.js";
import salaryAdvanceRoutes from "./routes/salaryAdvance.js";
import groupRoutes from "./routes/groups.js";
import groupSavingsRoutes from "./routes/groupSavings.js";
import groupActivityRoutes from "./routes/groupActivity.js";
import memberRoutes from "./routes/members.js";
import welfarePenaltyRoutes from "./routes/welfarePenalties.js";
import welfareContributionRoutes from "./routes/welfareContributions.js";
import welfareMeetingRoutes from "./routes/welfareMeetings.js";
import welfareMpesaRoutes from "./routes/welfareMpesa.js";
import welfareSmsRoutes from "./routes/welfareSms.js";
import welfareDividendRoutes from "./routes/welfareDividends.js";
import welfareReportRoutes from "./routes/welfareReports.js";
import reportsRoutes from "./routes/reports.js";
import smsRoutes from "./routes/sms.js";
import emailRoutes from "./routes/email.js";
import settingsRoutes from "./routes/settings.js";
import billingRoutes from "./routes/billing.js";
import expensesRoutes from "./routes/expenses.js";
import waiverRoutes from "./routes/waivers.js";
import promiseRoutes from "./routes/promises.js";
import reconciliationRoutes from "./routes/reconciliation.js";
import automationRoutes from "./routes/automation.js";
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

// CORS — local dev origins plus any extra origins from CORS_ORIGINS
// (comma-separated). Each CORS_ORIGINS entry may be an exact origin
// (https://app.lenderfest.loans) OR a single-wildcard subdomain pattern
// (https://*.lenderfest.loans) — needed because tenant customer portals
// live at <subdomain>.lenderfest.loans and new subdomains appear every
// time a lender signs up. The * matches one DNS label (no dots).
const corsEntries = [
  "http://localhost:5173",
  "http://localhost:3000",
  ...(process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : []),
];
const corsExact = new Set(corsEntries.filter((e) => !e.includes("*")));
const corsPatterns = corsEntries
  .filter((e) => e.includes("*"))
  .map((e) => new RegExp(
    "^" + e.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+") + "$",
  ));
const corsOriginCheck = (origin, cb) => {
  // No-origin requests (curl, same-origin, server-to-server) are allowed.
  if (!origin) return cb(null, true);
  if (corsExact.has(origin)) return cb(null, true);
  if (corsPatterns.some((re) => re.test(origin))) return cb(null, true);
  return cb(new Error(`CORS: origin ${origin} not allowed`));
};
app.use(
  cors({
    origin: corsOriginCheck,
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

// Sentry request handler — runs before routes so every error captured
// downstream carries route / user / tenant context. No-op without DSN.
app.use(sentryRequestHandler());

// Trust the first proxy hop (Render's load balancer) so req.ip
// resolves to the real client address. Without this, every request
// looks like it's coming from the loopback and rate-limiters can't
// distinguish IPs. Skipped under test to keep supertest's loopback
// requests honest.
if (process.env.NODE_ENV !== "test") {
  app.set("trust proxy", 1);
}

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
// Auth surfaces (login / forgot-password / reset-password / OTP) get
// the IP-keyed authLimiter — 10 attempts / 15 min — so unauthenticated
// brute-force / credential-stuffing on /login or /forgot-password
// stops being trivially scriptable. Successful logins are excluded
// from the count so a real user signing in repeatedly isn't punished.
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/tenants", tenantRoutes); // public: signup + subdomain check
app.use("/api/portal/auth", authLimiter, portalAuthRoutes); // public: customer auth/OTP
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
app.use("/api/branches", branchRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/overdue", overdueRoutes);
app.use("/api/capital", capitalRoutes);
app.use("/api/underwriting", underwritingRoutes);
app.use("/api/pawn", pawnRoutes);
app.use("/api/loans", vehicleSecurityRoutes); // logbook vehicle security (dual-mount)
app.use("/api/loans", salaryAdvanceRoutes); // salary check-off details (dual-mount)
app.use("/api/groups", groupRoutes); // group / chama lending
app.use("/api/groups", groupSavingsRoutes); // group savings + joint-liability coverage
app.use("/api/groups", groupActivityRoutes); // group meetings + attendance + lending cycles
app.use("/api/welfares/:welfareId/members", memberRoutes); // welfare members + pool + lending
app.use("/api/welfares/:welfareId", welfarePenaltyRoutes); // welfare settings + penalty engine
app.use("/api/welfares/:welfareId", welfareContributionRoutes); // contribution cycles + schedules
app.use("/api/welfares/:welfareId", welfareMeetingRoutes); // meetings + member attendance + penalties
app.use("/api/welfares/:welfareId", welfareMpesaRoutes); // welfare M-Pesa STK + allocation + reconciliation
app.use("/api/welfares/:welfareId", welfareSmsRoutes); // welfare SMS broadcast + reminders + logs
app.use("/api/welfares/:welfareId", welfareDividendRoutes); // welfare dividends / share-out
app.use("/api/welfares/:welfareId", welfareReportRoutes); // welfare dashboard + per-member reports
app.use("/api/reports", reportsRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/billing", billingRoutes); // tenant's own platform invoices
app.use("/api/expenses", expensesRoutes); // operating expenses + categories
// Waivers mount in two spots:
//  /api/loans/:id/waivers …      → create + list per loan
//  /api/waivers/pending|approve|reject|reverse … → admin queue
app.use("/api/loans", waiverRoutes);
app.use("/api/waivers", waiverRoutes);
// Promise to Pay routes — same dual-mount pattern as waivers:
//  /api/loans/:id/promises … → create + per-loan list
//  /api/promises … → tenant-wide queue + summary + mark kept/cancel
app.use("/api/loans", promiseRoutes);
app.use("/api/promises", promiseRoutes);
app.use("/api/reconciliation", reconciliationRoutes);
app.use("/api/automation", automationRoutes); // tenant reminder/overdue automation
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

// Sentry error handler — mounted BEFORE our errorHandler so 5xx
// errors are captured with full request context before the response
// is rendered. No-op without DSN.
app.use(sentryErrorHandler());

// Error handler
app.use(errorHandler);

export default app;
