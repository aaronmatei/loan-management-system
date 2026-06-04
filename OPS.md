# Operations Runbook

Single source of truth for the security / availability / observability
posture of this app. Reviewed alongside the security audit, not in
place of it.

---

## Where the production secrets live

| Secret | Storage | Notes |
|---|---|---|
| Database (Neon) | `DATABASE_URL` env var on Render | Neon encrypts at-rest + offers point-in-time recovery |
| JWT signing key | `JWT_SECRET` env var on Render | Rotate via a deploy with both old + new; expire all sessions on the swap |
| M-Pesa Daraja creds | `MPESA_CONSUMER_KEY/SECRET/PASSKEY` on Render | Render encrypts env vars at rest |
| Africa's Talking SMS | `AT_*` env vars on Render | Same |
| Cloudinary KYC photos | `CLOUDINARY_*` on Render | Same |
| Encryption key for `secretsCrypto` | `ENCRYPTION_KEY` env var (64-char hex) | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| Sentry DSN | `SENTRY_DSN` (backend) / `VITE_SENTRY_DSN` (frontend) | Optional; absent = no reporting |

**Nothing sensitive is committed to git.** `.env` files are gitignored;
CI's secrets are GitHub Actions secrets; runtime secrets are Render's
encrypted env vars.

---

## Authentication + auth

- **Passwords** — bcrypt(10) for staff (`users.password_hash`) and
  borrowers (`platform_customers.password_hash`).
- **JWT** — issued at login; carries `id`, `email`, `role`,
  `tenant_id`, `is_platform_admin`. Used by `verifyToken` middleware on
  every authed route. Default expiry `JWT_EXPIRE=7d` (env var).
- **RBAC** — `authorize(...roles)` middleware on routes that require a
  specific role. Frontend mirrors via `<PermissionGate>` and
  `utils/permissions`.
- **Rate limiting** — `express-rate-limit` on `/api/auth/*` and
  `/api/portal/auth/*`: 10 attempts / 15 min / IP, successful logins
  excluded. `otpSendLimiter` and `sensitiveWriteLimiter` are defined in
  [`src/middleware/rateLimit.js`](loan-tracker-backend/src/middleware/rateLimit.js)
  and ready to mount on specific endpoints when needed.
- **Trust proxy** — `app.set('trust proxy', 1)` so `req.ip` resolves to
  the real client behind Render's load balancer (the rate limiter
  depends on this).

### OTP / password reset

**Currently bypassed.** The customer-portal password-reset flow ships
without OTP verification — `routes/portal/auth.js` documents the
restoration steps in a `TODO(OTP)` block. Same bypass is in place for
registration / login OTPs. **Restore before going GA** or before
processing real borrower data.

---

## Tenant isolation

- Every authed route is tenant-scoped via
  [`utils/tenantScope.js`](loan-tracker-backend/src/utils/tenantScope.js):
  `tenantClause(req, paramOffset, col)` returns an `AND col = $N`
  fragment when the caller isn't a platform admin.
- Platform admins (`req.user.is_platform_admin = true`) intentionally
  bypass tenant scoping — they operate across all tenants.
- **Regression coverage** —
  [`tests/tenant-isolation.test.js`](loan-tracker-backend/tests/tenant-isolation.test.js)
  spins up two tenants and asserts every list endpoint filters
  correctly, that cross-tenant GET/PUT/POST 404s, and that platform
  admins see both. Every cross-tenant bug we fix gets a regression
  test added here.

If you add a new mutation that hits one of the cross-tenant tables
(`loans`, `clients`, `transactions`, `promises_to_pay`,
`payment_schedules`, `loan_waivers`, `capital_pool`, `expenses`,
`invoices`, `loan_packages`, `branches`), it MUST be tenant-scoped AND
covered by a test in `tenant-isolation.test.js`.

---

## Input + transport security

- **Helmet** — applied globally (`app.use(helmet())`); covers
  X-Content-Type-Options, X-Frame-Options, CSP, HSTS.
- **CORS** — origin allow-list driven by `CORS_ORIGINS` env var (comma-
  separated; wildcards supported for subdomains). No-origin requests
  allowed for server-to-server / curl. See `app.js`.
- **Body limits** — 50 MB on JSON + urlencoded; sized for KYC photo
  uploads.
- **`express-validator`** — installed; coverage is per-route. Audit
  before public launch.

---

## Database

- **Provider** — Neon (PostgreSQL 18). Point-in-time recovery for the
  last 7 days at the platform layer; no app-level scheduled backups
  are necessary for disaster recovery (Neon is your safety net).
- **Schema** — `tests/setup/schema.sql` is the snapshot CI uses to
  rebuild the test DB.
- **Migrations** — manual, numbered, in `migrations/NNN_*.sql`. Run via
  psql.
- **Indexes** — every hot table has multiple indexes:
  `loans` (7), `audit_logs` (9), `clients` (8),
  `platform_customers` (6), `transactions` (5),
  `payment_schedules` (4), `users` (6). Check with
  `\d <table>` if a query plan is slow.
- **Application-level backups** — the `backups` table + `routes/backup.js`
  endpoint exist for admin-triggered dumps (download / restore from
  the platform admin UI). Not a substitute for Neon's PITR.

---

## Logging + alerting

- **Logger** — Winston (`src/config/logger.js`). JSON in production,
  human-readable in dev. All routes use `logger.error("...", err)` in
  catch blocks.
- **Audit logs** — `audit_logs` table records every business event
  (loan disbursed, payment recorded, waiver applied, status change,
  etc.). See `services/auditService.js`.
- **Sentry** — `@sentry/node` (backend) + `@sentry/react` (frontend),
  both DSN-gated. Backend `sentryErrorHandler` middleware captures
  every error that reaches Express's error chain via `next(err)`.
  Frontend `ErrorBoundary` reports every render-time crash with the
  React component stack.
- **⚠ Inline-catch contract — read before adding a new route.** Most
  handlers in `src/routes/` use the local pattern:
  ```js
  try {
    // …
  } catch (error) {
    logger.error("…", error);
    res.status(500).json({ error: "…" });
  }
  ```
  That **swallows the error before the middleware sees it** — Sentry
  never gets notified. To stay covered, ALSO call
  `captureException(error, { route: …, tenant_id: … })` from
  `config/sentry.js` inside the catch block whenever the branch
  represents a genuine server-side surprise (NOT a typed user-input
  bounce — those should stay out of the dashboard). The route files
  for the highest-value writes — `clients.js`, `payments.js`,
  `auth.js`, `portal/auth.js` — already follow this contract.
  Anywhere else with a `try/catch` + 500 response is silently
  invisible to Sentry until the pattern is added.
- **No on-call paging today.** Sentry's alert rules can email / Slack;
  configure them in the Sentry project settings, not in this repo.

---

## Frontend safety nets

- **ErrorBoundary** — wraps `<App />` in `main.jsx`. Any uncaught
  render-time error shows a fallback "Something went wrong" screen
  with Reload / Home buttons instead of a blank white page; dev mode
  also shows the stack in a `<details>`. Forwards the error to Sentry
  via `captureException`.
- **Password input** — confirm-password + reveal toggles on the
  staff Add User / Reset Password modals; same pattern on the tenant
  signup form.

---

## CI / dependencies

- **CI** — `.github/workflows/ci.yml` runs `vitest run` on every push
  to `main` or `feature/**` and on every PR. Uses a real PostgreSQL 18
  container (no mocking); the test DB is rebuilt from
  `tests/setup/schema.sql` on each run.
- **Test count** — ~33 backend test files (integration-level, hitting
  real SQL constraints), ~2 frontend files (light coverage, room to
  grow).
- **Dependabot** — `.github/dependabot.yml` opens weekly minor+patch
  PRs (grouped per workspace) and immediate security PRs. Updates
  npm in both workspaces and the `actions/*` versions in
  `.github/workflows/`. PRs go through CI before merge.

---

## Deployment

- **Platform** — Render, configured by `render.yaml`.
- **Strategy today** — rolling deploy (Render's default). Rollback is
  a redeploy of a previous commit from Render's dashboard.
- **NOT in place** — blue-green or preview environments. If you need a
  zero-downtime rollback path or per-PR preview URLs, enable Render's
  preview-environments feature in the dashboard and add a
  `previewsEnabled: true` block per service in `render.yaml`. No code
  change required.

---

## Known follow-ups (priority order)

1. **Restore the OTP password-reset flow** — bypass is documented but
   real. Don't ship to real borrowers without this.
2. **Per-route input validation audit** — `express-validator` is
   installed; we don't have proof every route uses it. Walk
   `src/routes/` and flag any handler that consumes `req.body` without
   validation.
3. **Sentry alert rules** — install is in place; alert routing to
   email / Slack / PagerDuty is configured in the Sentry UI, not in
   this repo. Set up before going GA.
4. **Frontend test coverage** — 2 files is thin. Add tests for the
   high-traffic flows (Record Payment, Disburse Loan, Apply Waiver).
5. **Per-tenant M-Pesa wiring** — schema columns exist; util exists
   (`utils/secretsCrypto`); wiring doesn't. See the `TODO(secrets)`
   marker in `services/mpesaService.js` for the contract.
6. **Render preview environments** — one-line config change for per-PR
   preview URLs.

---

## Generating an `ENCRYPTION_KEY`

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the output as `ENCRYPTION_KEY` on Render. Don't rotate without
re-encrypting every stored value first; the util doesn't support
multi-key decryption.
