// The Overdue list surfaces the loan's late-payment penalty per installment:
// a flat late fee per missed payment plus penalty interest (rate% per month,
// rounding part-months up) on the overdue balance.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("GET /api/overdue — penalty fields", () => {
  it("computes late fee + monthly penalty interest per overdue installment", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    // Default policy from schema: late_payment_fee 500, penalty_rate 5.00.
    const loan = await createLoan(t.id, client.id, { status: "active" });

    // 40 days late → months_late = ceil(40/30) = 2; balance 1000.
    await query(
      `INSERT INTO payment_schedules (tenant_id, loan_id, payment_number, due_date, amount_due, amount_paid, status)
       VALUES ($1,$2,1, CURRENT_DATE - 40, 1000, 0, 'overdue')`,
      [t.id, loan.id],
    );

    const res = await request(app)
      .get("/api/overdue")
      .set("Authorization", auth(admin));

    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.loan_id === loan.id);
    expect(row).toBeTruthy();
    expect(Number(row.late_fee)).toBe(500);
    expect(Number(row.penalty_rate)).toBe(5);
    expect(row.months_late).toBe(2);
    // 5% * 1000 * 2 months = 100
    expect(Number(row.penalty_interest)).toBe(100);
    // late fee 500 + interest 100 = 600
    expect(Number(row.penalty_total)).toBe(600);
    // balance 1000 + penalty 600 = 1600
    expect(Number(row.total_with_penalty)).toBe(1600);
  });
});
