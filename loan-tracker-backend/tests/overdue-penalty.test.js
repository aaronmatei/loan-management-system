// The Overdue list surfaces the loan's late-payment penalty per installment:
// a late fee plus penalty interest (rate% per month) on the overdue balance,
// both accruing per day over a 30-day month.
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

    // 40 days late → months_late = 40/30 = 1.33; balance 1000.
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
    expect(Number(row.penalty_rate)).toBe(5);
    expect(row.months_late).toBe(1.33);
    // late fee 500 * 40/30 = 666.67
    expect(Number(row.late_fee)).toBe(666.67);
    // 5% * 1000 * 40/30 = 66.67
    expect(Number(row.penalty_interest)).toBe(66.67);
    // 666.67 + 66.67 = 733.33
    expect(Number(row.penalty_total)).toBe(733.33);
    // balance 1000 + penalty 733.33 = 1733.33
    expect(Number(row.total_with_penalty)).toBe(1733.33);
  });
});
