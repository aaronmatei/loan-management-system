# Project TODOs

Two deferred work items with inline markers in code. Each entry below
explains **why it's deferred**, **what triggers picking it back up**,
and **the exact steps + files** to restore.

This file is the single source of truth — when you start or finish
either item, update the checkbox here so future-you doesn't reverse-
engineer status from commit messages.

---

## ☐ 1. Restore the OTP password-reset flow

**Status:** bypassed end-to-end. The customer-portal password reset
currently looks up the phone number, returns the `customer_id`
directly, and accepts a new password without verifying any code.

**Why it's deferred:** the SMS provider isn't wired yet, so when we
previously called `sendOTP()` the code either never delivered or
failed silently. Borrowers couldn't finish a self-serve reset.

**Pick this back up when:**
- The SMS provider (Africa's Talking or M-Pesa direct) is configured
  with credentials in Render env vars (`AT_API_KEY`, `AT_USERNAME`).
- `services/otpService.js` `sendOTP()` returns `{ success: true }`
  when called manually.
- **OR** before opening the portal to real borrowers — this **must**
  be live before GA.

**Files to restore (each has a `TODO(OTP)` marker):**

| File | What to do |
|---|---|
| [`loan-tracker-backend/src/routes/portal/auth.js`](loan-tracker-backend/src/routes/portal/auth.js) | In `/forgot-password`: uncomment the `sendOTP()` call and gate `customer_id` on `otp.success`. In `/reset-password`: uncomment the `verifyOTP()` call and `return res.status(400)` when it fails. |
| [`loan-tracker-frontend/src/portal/pages/ForgotPassword.jsx`](loan-tracker-frontend/src/portal/pages/ForgotPassword.jsx) | Re-add the Verification Code input on step 2, the "Resend code" button, and the `otp` field on the `resetPassword` payload. State variable `otp` and `resend()` function can be lifted from git history. |

**Verification:**
- Forgot-password from a real phone → SMS arrives within 30 s with a 6-digit code.
- Submitting wrong code → 400 with `error: "Invalid OTP"`.
- Submitting right code + valid password → 200 + "Password reset successful".
- OTP expiry is enforced (5 min — see `otpService.js`).

**Acceptance test to add** (`tests/portal-auth.test.js`):
- POST `/portal/auth/forgot-password` returns `customer_id` only after `sendOTP` succeeds.
- POST `/portal/auth/reset-password` with wrong `otp` → 400.
- POST `/portal/auth/reset-password` with right `otp` → 200, password is bcrypt-hashed in DB.

---

## ☐ 4. Per-tenant M-Pesa credential wiring

**Status:** schema columns exist, encryption util exists, application
code reads only from `process.env`. Every tenant currently transacts
on the **platform's** single Daraja app.

**Why it's deferred:** today nobody has asked for it — small lenders
are happy on the shared Daraja app, billing flows back to the
platform. Adding per-tenant wiring without a customer asking would
buy us complexity without value.

**Pick this back up when:**
- A tenant requests their own Daraja credentials (regulatory ask,
  reconciliation preference, white-label requirement).
- **OR** platform-level reconciliation becomes a bottleneck (every
  STK push lands on one shortcode; payouts need manual splitting).

**Files to modify (marker in `services/mpesaService.js` walks through it):**

| File | What to do |
|---|---|
| [`loan-tracker-backend/src/services/mpesaService.js`](loan-tracker-backend/src/services/mpesaService.js) | `getAccessToken()` + `stkPush()` + `queryStkStatus()` — accept a `tenantId` arg, look up `tenants.mpesa_*` columns, decrypt via `secretsCrypto.decryptSecret()`, fall back to `process.env.MPESA_*` when blank. |
| [`loan-tracker-backend/src/routes/settings.js`](loan-tracker-backend/src/routes/settings.js) | Wherever tenant settings are saved: route `mpesa_consumer_key`, `mpesa_consumer_secret`, `mpesa_passkey` through `secretsCrypto.encryptSecret()` before INSERT/UPDATE. |
| [`loan-tracker-backend/src/app.js`](loan-tracker-backend/src/app.js) | After `sentryInit()`, add `assertEncryptionAvailable()` so a missing `ENCRYPTION_KEY` fails loud at startup instead of on the first STK request. |
| **Generate** `ENCRYPTION_KEY` on Render (one-time): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → set as env var on the backend service. |

**Verification:**
- A tenant saves their Daraja creds → DB column value starts with `enc:v1:`, NOT the plaintext key.
- STK push for that tenant uses the decrypted credentials (`process.env.MPESA_*` is not touched).
- STK push for a tenant with blank columns still works on the platform creds.
- Tampering with one byte of the stored ciphertext → decrypt throws, request 500s (intentional — alerted via Sentry).

**Acceptance test to add** (`tests/mpesa-per-tenant.test.js`):
- Set tenant A's `mpesa_consumer_key` (encrypted) → `getAccessToken(A.tenant.id)` makes an OAuth call with A's key, not the env one.
- Leave tenant B blank → `getAccessToken(B.tenant.id)` falls back to env.

---

## Bookkeeping

When you finish an item:
1. Tick the checkbox at the top of its section.
2. Delete the section if everything in it shipped; the git history is the audit trail.
3. Run `grep -rn "TODO(OTP)\|TODO(secrets)" loan-tracker-*/src/` to confirm no stale markers are left behind.

Other operational follow-ups (input validation, frontend tests,
preview envs, alert rules) live in [`OPS.md`](OPS.md) — they're
hygiene rather than deferred features.
