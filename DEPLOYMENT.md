# Deployment Guide — cost-optimized split

```
Browser ──▶ Frontend (static SPA)        Cloudflare Pages / Vercel
                │  VITE_API_URL
                ▼
            Backend (Node/Express)        Render  (web service)
                │
                ├─▶ Postgres               Neon    (DATABASE_URL, SSL)
                └─▶ Redis (optional)       Upstash (only once Bull is wired)
```

The backend is **stateful** (cron jobs, future Bull workers) so it runs as a
persistent web service, not serverless functions. The frontend is a pure static
build. Config files in this repo:

- `render.yaml` — backend Render Blueprint
- `loan-tracker-frontend/vercel.json` — Vercel build + SPA rewrites
- `loan-tracker-frontend/public/_redirects` — Cloudflare/Netlify SPA fallback

Two code changes already landed to make this work:
- `loan-tracker-frontend/src/services/api.js` reads `VITE_API_URL`
- `loan-tracker-backend/src/config/database.js` supports `DATABASE_URL` + SSL
- `loan-tracker-backend/src/app.js` CORS allowlist via `CORS_ORIGINS`

> ⚠️ Build prerequisite: `npm run build` in `loan-tracker-frontend` must
> succeed before deploying the frontend. (At time of writing, uncommitted
> edits in `src/App.jsx` import from a non-existent `./loanfix/portal/...`
> path — fix those back to `./portal/...` first.)

---

## Step 1 — Postgres on Neon

1. Create a project at neon.tech → copy the **pooled** connection string
   (looks like `postgres://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=require`).
2. Apply the schema (the complete current schema lives in the test dump):
   ```bash
   psql "YOUR_NEON_URL" -f loan-tracker-backend/tests/setup/schema.sql
   ```
3. You'll create the first tenant + admin via the app's **/signup** page after
   the frontend is up (Step 3). No manual seeding needed.

## Step 2 — Backend on Render

Option A (Blueprint): in Render, **New → Blueprint**, point at this repo; it
reads `render.yaml`. Option B: **New → Web Service**, root dir
`loan-tracker-backend`, build `npm ci`, start `npm start`, health `/health`.

Set these env vars (dashboard → Environment):

| Var | Value |
|---|---|
| `DATABASE_URL` | the Neon string from Step 1 |
| `JWT_SECRET` | a long random string (Blueprint auto-generates) |
| `CORS_ORIGINS` | leave blank for now (set in Step 4) |
| `NODE_ENV` | `production` |
| `EMAIL_*` / `MPESA_*` | only if enabling those integrations |

Deploy, then note the URL, e.g. `https://loanfix-backend.onrender.com`.
(Free web services sleep after ~15 min idle — first request cold-starts.)

## Step 3 — Frontend on Cloudflare Pages or Vercel

Root directory: `loan-tracker-frontend`. Build: `npm run build`. Output: `dist`.

Set **one** build-time env var:

| Var | Value |
|---|---|
| `VITE_API_URL` | `https://loanfix-backend.onrender.com/api` (your Step 2 URL + `/api`) |

- **Vercel**: it auto-detects Vite; `vercel.json` supplies the SPA rewrites.
- **Cloudflare Pages**: framework preset "Vite"; `public/_redirects` supplies
  the SPA fallback.

Deploy, then note the URL, e.g. `https://loanfix.pages.dev`.

## Step 4 — Wire CORS, then create your first account

1. Back in Render, set `CORS_ORIGINS` to your frontend URL
   (`https://loanfix.pages.dev`) and redeploy the backend.
2. Visit `https://loanfix.pages.dev/signup` to create the first tenant + admin.
3. If using M-Pesa, set `MPESA_CALLBACK_URL` to
   `https://loanfix-backend.onrender.com/api/mpesa/callback`.

## Step 5 — Redis on Upstash (optional, later)

Bull is in `package.json` but **not yet wired into `src/`**, so the backend
runs fine without Redis today. When you add Bull-backed jobs, create an Upstash
Redis database and add its `REDIS_URL` to the backend env.

---

## Environment variable reference

**Backend** (Render): `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRE`,
`CORS_ORIGINS`, `NODE_ENV`, `SMS_ENABLED`, `EMAIL_ENABLED` (+ `EMAIL_HOST`,
`EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`), `MPESA_ENV`,
`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
`MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `BACKUP_SCHEDULE_ENABLED`.

**Frontend** (Cloudflare/Vercel): `VITE_API_URL` (build-time only).

## Alternatives

- **Backend on Fly.io** instead of Render: add a `Dockerfile` + `fly.toml`
  (`fly launch` scaffolds them); same env vars. Better for no-sleep + global.
- **Postgres on Supabase** instead of Neon: same `DATABASE_URL` + SSL flow.
