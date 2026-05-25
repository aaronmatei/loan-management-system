// The loan-detail summary (powering the staff Loan Details page) annotates
// each scheduled installment with its late fee + penalty interest, so the
// payment schedule table shows penalties the same way the Overdue page does.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("GET /api/payments/loan/:loanId/summary — schedule penalties", () => {
  it("annotates overdue installments and leaves paid/future ones at zero", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const loan = await createLoan(t.id, client.id, { status: "active" }); // 500 + 5%

    // #1 overdue 40 days, balance 1000 → penalty 600
    await query(
      `INSERT INTO payment_schedules (tenant_id, loan_id, payment_number, due_date, amount_due, amount_paid, status)
       VALUES ($1,$2,1, CURRENT_DATE - 40, 1000, 0, 'overdue')`,
      [t.id, loan.id],
    );
    // #2 fully paid → no penalty
    await query(
      `INSERT INTO payment_schedules (tenant_id, loan_id, payment_number, due_date, amount_due, amount_paid, status)
       VALUES ($1,$2,2, CURRENT_DATE - 5, 1000, 1000, 'paid')`,
      [t.id, loan.id],
    );
    // #3 not yet due → no penalty
    await query(
      `INSERT INTO payment_schedules (tenant_id, loan_id, payment_number, due_date, amount_due, amount_paid, status)
       VALUES ($1,$2,3, CURRENT_DATE + 20, 1000, 0, 'pending')`,
      [t.id, loan.id],
    );

    const res = await request(app)
      .get(`/api/payments/loan/${loan.id}/summary`)
      .set("Authorization", auth(admin));

    expect(res.status).toBe(200);
    const sched = res.body.data.schedule;
    const byNum = Object.fromEntries(sched.map((s) => [s.payment_number, s]));

    expect(Number(byNum[1].late_fee)).toBe(500);
    expect(byNum[1].months_late).toBe(2);
    expect(Number(byNum[1].penalty_interest)).toBe(100);
    expect(Number(byNum[1].penalty_total)).toBe(600);

    expect(Number(byNum[2].penalty_total)).toBe(0); // paid
    expect(Number(byNum[3].penalty_total)).toBe(0); // future
  });
});
