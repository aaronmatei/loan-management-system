// Shared helpers: a UI login, and API-driven preconditions. Standard E2E
// practice — set up state via the API (fast, reliable), assert via the UI.
import { expect, request } from "@playwright/test";
import { ADMIN, BACKEND_PORT, FRONTEND_PORT } from "./fixtures.js";

// Origin only — Playwright resolves a leading-slash path against the origin,
// so we keep the "/api" prefix on each path instead of on the baseURL.
const apiBase = `http://localhost:${BACKEND_PORT}`;
const appBase = `http://localhost:${FRONTEND_PORT}`;

// Unique-ish Kenyan phone (0 + 9 digits) so client inserts don't collide.
function phone() {
  return `07${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

// ---------- UI ----------

export async function loginUI(page) {
  await page.goto("/login");
  await page.getByPlaceholder("admin@example.com").fill(ADMIN.email);
  await page.getByPlaceholder("Enter password").fill(ADMIN.password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page).toHaveURL(`${appBase}/`);
}

// ---------- API (preconditions) ----------

// An authenticated API context for the seeded admin.
async function adminApi() {
  const anon = await request.newContext({ baseURL: apiBase });
  const res = await anon.post("/api/auth/login", {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  if (!res.ok()) {
    throw new Error(`API login failed: ${res.status()} ${await res.text()}`);
  }
  const { token } = await res.json();
  await anon.dispose();
  return request.newContext({
    baseURL: apiBase,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function ok(resPromise, label) {
  const res = await resPromise;
  if (!res.ok()) {
    throw new Error(`${label} failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).data;
}

export async function apiCreateClient(overrides = {}) {
  const ctx = await adminApi();
  const client = await ok(
    ctx.post("/api/clients", {
      data: {
        first_name: "Api",
        last_name: "Client",
        phone_number: phone(),
        ...overrides,
      },
    }),
    "create client",
  );
  await ctx.dispose();
  return client;
}

// Create a client + loan, then approve + disburse so the loan is ACTIVE and
// payable. Returns { client, loan }.
export async function apiSeedActiveLoan({ principal = 10_000 } = {}) {
  const ctx = await adminApi();
  // Capital pool is seeded by setup-db.js, so we go straight to the loan.
  const client = await ok(
    ctx.post("/api/clients", {
      data: { first_name: "Loan", last_name: "Holder", phone_number: phone() },
    }),
    "create client",
  );
  const loan = await ok(
    ctx.post("/api/loans", {
      data: {
        client_id: client.id,
        principal_amount: principal,
        annual_interest_rate: 50,
        loan_duration_months: 12,
      },
    }),
    "create loan",
  );
  await ok(
    ctx.post(`/api/loans/${loan.id}/approve`, { data: { notes: "E2E" } }),
    "approve loan",
  );
  await ok(
    ctx.post(`/api/loans/${loan.id}/disburse`, {
      data: { disbursement_method: "cash" },
    }),
    "disburse loan",
  );
  await ctx.dispose();
  return { client, loan };
}
