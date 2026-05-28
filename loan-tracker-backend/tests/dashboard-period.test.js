// Guards against PG "could not determine data type of parameter" 500s
// after the period-scoping rollout (Dashboard + Analytics).
import request from "supertest";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

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
