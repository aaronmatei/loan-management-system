import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { sentryInit } from './config/sentry.js'

// Initialize Sentry first so any error during mount makes it into the
// report. No-ops when VITE_SENTRY_DSN isn't set, so dev / preview / any
// env without DSN runs unchanged. ErrorBoundary's componentDidCatch
// also calls captureException — together those cover render-time
// crashes top-to-bottom.
sentryInit()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
