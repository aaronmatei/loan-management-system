// Guards against PG "could not determine data type of parameter" 500s
// after the period-scoping rollout (Dashboard + Analytics), and that
// overdue clamps to today for future end-of-period dates.
import request from "supertest";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { query } from "../src/config/database.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
} from "./helpers/factory.js";

afterAll(async () => {
  await pool.end();
});

const ENDPOINTS = [
  "/api/dashboard/summary",
  "/api/dashboard/recent-activities",
  "/api/dashboard/monthly-trends",
  "/api/analytics/kpis",
  "/api/analytics/revenue-trends",
  "/api/analytics/portfolio-breakdown",
  "/api/analytics/top-clients?metric=borrowed&limit=10",
  "/api/analytics/geographic",
  "/api/analytics/loan-distribution",
  "/api/analytics/default-trend",
  "/api/analytics/payment-methods",
];

const PERIODS = [
  { label: "month", q: "from=2026-05-01&to=2026-05-31" },
  { label: "year", q: "from=2026-01-01&to=2026-12-31" },
  { label: "no-period", q: "" },
];

describe("period-scoped Dashboard + Analytics endpoints respond 200", () => {
  let token;
  beforeAll(async () => {
    const t = await createTenant();
    const u = await createUser(t.id, { role: "admin" });
    token = tokenFor(u);
  });

  for (const ep of ENDPOINTS) {
    for (const p of PERIODS) {
      it(`${ep} (${p.label})`, async () => {
        const sep = ep.includes("?") ? "&" : "?";
        const url = p.q ? `${ep}${sep}${p.q}` : ep;
        const res = await request(app)
          .get(url)
          .set("Authorization", `Bearer ${token}`);
        if (res.status !== 200) {
          console.error("ERROR:", url, res.status, res.body, res.text);
        }
        expect(res.status).toBe(200);
      });
    }
  }
});

describe("overdue count clamps end-of-period to today", () => {
  it("future-dated installments (still pending) are NOT counted as overdue when the period extends past today", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const token = tokenFor(admin);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "active",
      principal_amount: 10000,
      total_amount_due: 11000,
    });
    // One past-due installment (genuinely overdue) and one due far in
    // the future. Both inside a "Year 2026" window.
    await query(
      `INSERT INTO payment_schedules
         (tenant_id, loan_id, payment_number, due_date, amount_due, amount_paid, status)
       VALUES
         ($1, $2, 1, '2026-02-15', 1000, 0, 'pending'),
         ($1, $2, 2, '2026-11-15', 1000, 0, 'pending')`,
      [tenant.id, loan.id],
    );
    const res = await request(app)
      .get("/api/dashboard/summary?from=2026-01-01&to=2026-12-31")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Only the Feb installment is past today (2026-05-29). The Nov one
    // still says "pending" — must not inflate overdue_count.
    expect(res.body.data.overdue_count).toBe(1);
  });
});
