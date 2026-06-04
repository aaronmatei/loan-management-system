import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// ErrorBoundary wraps <App /> so any uncaught render-time exception
// inside the tree shows a "Something went wrong" screen with reload /
// home buttons instead of a blank page. See components/ErrorBoundary.jsx
// for the Sentry hook-up point (TODO comment) when error reporting lands.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
