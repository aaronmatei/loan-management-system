// Sentry initialization — gated on SENTRY_DSN.
//
// If the env var isn't set, every export here no-ops so dev / test /
// any environment without a DSN runs unchanged. When the env var IS
// set, the express request handler captures every unhandled error
// with full context (route, headers, user, breadcrumbs).
//
// Wire in app.js in this order:
//
//   import { sentryInit, sentryRequestHandler, sentryErrorHandler }
//     from "./config/sentry.js";
//   sentryInit();                          // before any other middleware
//   app.use(sentryRequestHandler());       // before routes
//   …routes…
//   app.use(sentryErrorHandler());         // before your own errorHandler
//   app.use(errorHandler);
//
// The handlers themselves resolve to no-ops when Sentry isn't
// initialized, so the order above is safe even with DSN unset.

import * as Sentry from "@sentry/node";
import logger from "./logger.js";

let initialized = false;

export function sentryInit() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Quiet by default in dev/test. Log once in prod-like environments
    // so it's obvious why error tracking isn't lighting up.
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "SENTRY_DSN not set — backend error reporting is disabled. " +
          "Set the DSN from your Sentry project's Settings → Client Keys.",
      );
    }
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    // Performance tracing is OFF by default — toggle on once you have
    // a sense of the noise floor. Adjust here, not at the call site.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_RATE || "0"),
    // Send-default-PII covers req.user / cookies / IP. Off by default;
    // turn on if you need audit context inside Sentry and your privacy
    // posture allows it.
    sendDefaultPii: process.env.SENTRY_SEND_PII === "true",
    // Drop runtime noise we don't care about.
    ignoreErrors: [
      // Aborted client requests — happens whenever the user navigates
      // away mid-fetch. Not actionable.
      "AbortError",
    ],
  });
  initialized = true;
  logger.info("Sentry initialized");
}

/**
 * Express middleware. No-ops when Sentry isn't initialized so it's
 * safe to mount unconditionally.
 */
export function sentryRequestHandler() {
  return (req, res, next) => {
    if (!initialized) return next();
    Sentry.getCurrentScope().setRequestSession({ status: "ok" });
    Sentry.withScope((scope) => {
      scope.setContext("request", {
        method: req.method,
        url: req.originalUrl,
      });
      // Stash tenant + user identifiers on the Sentry scope so every
      // error captured during this request carries them.
      if (req.user) {
        scope.setUser({
          id: req.user.id,
          email: req.user.email,
          tenant_id: req.user.tenant_id,
        });
      }
      next();
    });
  };
}

/**
 * Express error middleware. No-ops when Sentry isn't initialized.
 * Must be mounted AFTER routes but BEFORE the regular errorHandler.
 */
export function sentryErrorHandler() {
  return (err, req, res, next) => {
    if (initialized) {
      // Only capture 5xx and uncategorised — 4xx are usually user
      // errors we don't want crowding the dashboard.
      const status = err.status || err.statusCode || 500;
      if (status >= 500) Sentry.captureException(err);
    }
    next(err);
  };
}

/**
 * Manual capture for places without an error middleware (cron jobs,
 * background queues). Safe to call regardless of init state.
 */
export function captureException(err, contexts) {
  if (!initialized) return;
  Sentry.captureException(err, contexts ? { contexts } : undefined);
}

export default {
  sentryInit,
  sentryRequestHandler,
  sentryErrorHandler,
  captureException,
};
