// Borrower "Apply for a loan" flow (portal). Seeds a customer linked to the
// E2E lender (which gets a loan package), mints a portal token, and drives:
//   Apply nav -> Apply hub (linked lenders only) -> lender products
//   (packages + Standard/flat) -> wizard. Plus My Applications / My Loans
//   "Apply" routing. Read-only against the isolated e2e DB — never submits.
import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { dbConfig, E2E_DB } from "../fixtures.js";

// Some hosts can't fetch a Playwright-managed browser (e.g. ubuntu 26.04). If a
// chromium already sits in the ms-playwright cache, use it; otherwise fall back
// to Playwright's managed browser (`npx playwright install`).
function cachedChromium() {
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    for (const dir of readdirSync(base)) {
      if (!dir.startsWith("chromium")) continue;
      for (const rel of [
        "chrome-linux64/chrome",
        "chrome-headless-shell-linux64/chrome-headless-shell",
        "chrome-linux/chrome",
      ]) {
        const p = path.join(base, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  } catch {
    /* no cache dir — use the managed browser */
  }
  return undefined;
}
const CHROMIUM = cachedChromium();
test.use({
  launchOptions: {
    args: ["--no-sandbox"],
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  },
});

const JWT_SECRET = "e2e_secret_only_minimum_32_characters_long";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function signJwt(payload) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + 604800 };
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(body)}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

let seed = {};

test.beforeAll(async () => {
  const pool = new pg.Pool(dbConfig(E2E_DB));
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

  const [tenant] = await q("SELECT id FROM tenants WHERE subdomain = 'elender'");
  const tid = tenant.id;

  // Idempotent: a worker restart can re-run beforeAll, so clear prior test rows
  // (FK-safe order) before re-seeding.
  await q("DELETE FROM customer_tenant_links WHERE platform_customer_id IN (SELECT id FROM platform_customers WHERE id_number = 'E2EID111')");
  await q("DELETE FROM platform_customers WHERE id_number = 'E2EID111'");
  await q("DELETE FROM loan_packages WHERE tenant_id = $1 AND name = 'Boda Boda Loan'", [tid]);
  await q("DELETE FROM clients WHERE phone_number = '+254700000111' AND tenant_id = $1", [tid]);
  await q(
    `UPDATE tenants SET customer_portal_enabled = true, allow_self_signup = true,
       default_interest_rate = 48, min_loan_amount = 1000, max_loan_amount = 500000,
       default_loan_duration = 6, late_payment_fee = 500, penalty_rate = 5
     WHERE id = $1`,
    [tid],
  );

  const [cust] = await q(
    `INSERT INTO platform_customers (phone_number, email, id_number, first_name, last_name, is_active, phone_verified)
     VALUES ('+254700000111','e2e.borrower@test.dev','E2EID111','Test','Borrower', true, true) RETURNING id`,
  );
  const [client] = await q(
    `INSERT INTO clients (first_name, last_name, phone_number, tenant_id, client_type)
     VALUES ('Test','Borrower','+254700000111',$1,'individual') RETURNING id`,
    [tid],
  );
  await q(
    `INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status)
     VALUES ($1,$2,$3,'active')`,
    [cust.id, tid, client.id],
  );
  const [pkg] = await q(
    `INSERT INTO loan_packages (tenant_id, name, annual_interest_rate, processing_fee_rate,
       interest_method, min_amount, max_amount, min_duration_months, max_duration_months, active,
       allowed_client_types, allowed_purposes)
     VALUES ($1,'Boda Boda Loan',48,2,'flat',5000,200000,1,12,true,'{}','{}') RETURNING id`,
    [tid],
  );

  seed = {
    tid,
    packageId: pkg.id,
    token: signJwt({
      platform_customer_id: cust.id,
      phone_number: "+254700000111",
      user_type: "customer",
      current_tenant_id: null,
      current_client_id: null,
    }),
    customer: { id: cust.id, first_name: "Test", last_name: "Borrower", phone_number: "+254700000111" },
  };
  await pool.end();
});

// Inject the portal session before every page load.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([token, customer]) => {
      localStorage.setItem("portal_token", token);
      localStorage.setItem("portal_customer", JSON.stringify(customer));
      localStorage.setItem("portal_tenants", "[]");
    },
    [seed.token, seed.customer],
  );
});

test("apply hub -> lender products -> back, and package -> wizard", async ({ page }) => {
  // 1) Apply nav lands on the hub; only the linked lender shows as a card.
  await page.goto("/portal/apply");
  const lenderCard = page.getByRole("button", { name: /E2E Lender Ltd/ }).first();
  await expect(lenderCard).toBeVisible();

  // 2) Pick the lender -> its product page (?from=apply): packages + Standard loan.
  await lenderCard.click();
  await expect(page).toHaveURL(new RegExp(`/lenders/${seed.tid}\\?from=apply`));
  await expect(page.getByText("Boda Boda Loan")).toBeVisible();
  await expect(page.getByText("Standard loan")).toBeVisible();

  // 3) Back button (first on the page) reads "Apply for a loan" and returns to the hub.
  await expect(page.getByRole("button", { name: /Apply for a loan/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /Apply for a loan/i }).first().click();
  await expect(page).toHaveURL(/\/portal\/apply$/);
  await expect(page.getByRole("button", { name: /E2E Lender Ltd/ }).first()).toBeVisible();

  // 4) Back into products, borrow against the specific package -> wizard.
  await page.getByRole("button", { name: /E2E Lender Ltd/ }).first().click();
  await page.getByRole("button", { name: /Apply with this product/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/portal/apply\\?lender=${seed.tid}&package=${seed.packageId}`));
  await expect(page.getByText("Apply for a loan").first()).toBeVisible(); // wizard heading
  await page.screenshot({ path: "test-results/apply-wizard.png", fullPage: true });
});

test("My Applications '+ New' routes to the Apply hub", async ({ page }) => {
  await page.goto("/portal/applications");
  await page.getByRole("button", { name: "+ New" }).click();
  await expect(page).toHaveURL(/\/portal\/apply$/);
});

test("My Loans 'Apply for a loan' is green and routes to the Apply hub", async ({ page }) => {
  await page.goto("/portal/loans");
  const btn = page.getByRole("button", { name: /Apply for a loan/i }).first();
  await expect(btn).toBeVisible();
  const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundImage);
  // ocean-gradient = linear-gradient with the brand green #22b488 (rgb 34,180,136).
  expect(bg).toContain("34, 180, 136");
  await btn.click();
  await expect(page).toHaveURL(/\/portal\/apply$/);
});
