// Frontend Sentry init — gated on VITE_SENTRY_DSN.
//
// Run sentryInit() once from main.jsx before any React work so any
// render-time error captured by the ErrorBoundary lands in Sentry
// with full breadcrumbs. With no DSN set, every export here no-ops,
// which means dev / preview / any environment without DSN runs
// unchanged.
//
// Wire-up:
//
//   import { sentryInit, captureException } from "./config/sentry.js";
//   sentryInit();
//   ...
//   componentDidCatch(error, errorInfo) {
//     captureException(error, { react: errorInfo });
//   }

import * as Sentry from "@sentry/react";

let initialized = false;

export function sentryInit() {
  if (initialized) return;
  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env?.MODE || "development",
    // Conservative defaults. Toggle these on once the noise floor is known.
    tracesSampleRate: parseFloat(
      import.meta.env?.VITE_SENTRY_TRACES_RATE || "0",
    ),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
  initialized = true;
}

/**
 * Capture an exception manually (e.g. from an ErrorBoundary or a
 * fetch failure path). No-ops without DSN, so call sites don't need
 * to guard.
 */
export function captureException(err, contexts) {
  if (!initialized) return;
  Sentry.captureException(err, contexts ? { contexts } : undefined);
}

export default { sentryInit, captureException };
