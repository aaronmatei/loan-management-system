// Top-level React error boundary.
//
// Without one, any uncaught render-time error inside the tree below
// <App /> crashes the whole UI to a blank white page — no message,
// no way to recover, no breadcrumb for the user. Wrapping <App /> in
// this catches the error, logs it (to console.error today; swap in
// Sentry / your logger when one lands), and shows a humane "something
// went wrong" screen with a reload button.
//
// Has to be a class component — React doesn't have a hook for this
// yet (no useErrorBoundary in stable). Function components inside the
// tree still error normally; this one just catches the propagation.

import React from "react";
import { captureException } from "../config/sentry.js";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Triggered during the *render* phase — return the new state so
    // the next render swaps in the fallback. Don't do side effects
    // here (they'd run twice under StrictMode).
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Triggered during the *commit* phase — safe place to log + report.
    // captureException no-ops when VITE_SENTRY_DSN isn't set, so dev
    // gets the console trace and prod gets a Sentry event with the
    // component stack.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, errorInfo);
    captureException(error, { react: errorInfo });
    this.setState({ errorInfo });
  }

  handleReload = () => {
    // Full reload — safer than trying to recover in place, because
    // the broken component is probably in some inconsistent state we
    // can't reason about (stale localStorage, half-fetched data, etc.).
    window.location.reload();
  };

  handleHome = () => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = import.meta.env?.DEV;

    return (
      <div
        role="alert"
        className="min-h-screen w-full flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900"
      >
        <div className="max-w-md w-full bg-surface border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-2xl font-bold mb-4">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
            The page hit an unexpected error and couldn't render. Your data
            is safe — try reloading, or head back to the dashboard.
          </p>

          {isDev && this.state.error && (
            <details className="text-left mb-6 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
                Developer details
              </summary>
              <pre className="text-[11px] text-rose-700 mt-2 whitespace-pre-wrap break-words">
                {String(this.state.error?.stack || this.state.error)}
              </pre>
            </details>
          )}

          <div className="flex gap-2 justify-center">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-ocean-600 hover:bg-ocean-700 text-white text-sm font-semibold transition"
            >
              Reload page
            </button>
            <button
              onClick={this.handleHome}
              className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-sm font-semibold transition"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
