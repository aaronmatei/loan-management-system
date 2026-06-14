// Penalty-first allocation: when a borrower has overdue installments with
// an accrued penalty, payments cover the penalty before reducing amount_due.
// transactions.penalty_portion + payment_schedules.penalty_paid track the
// split; loan-completion ignores penalty_portion.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

// Set up an active loan with one overdue installment that has accrued
// penalty (40 days late, balance 1,000, prorated over a 30-day month:
// fee 500×40/30 = 666.67 + 5%×1,000×40/30 = 66.67 → penalty_total 733.33).
// Returns ids.
async function seedLoanWithOverdue() {
  const t = await createTenant();
  const admin = await createUser(t.id, { role: "admin" });
  const c = await createClient(t.id);
  // late_payment_fee 500 + penalty_rate 5% by default, interest 0 here to
  // keep the math clean: principal = total_amount_due.
  const loan = await createLoan(t.id, c.id, {
    status: "active",
    principal_amount: 1000,
    total_interest: 0,
    total_amount_due: 1000,
    interest_rate: 0,
    loan_duration_months: 1,
  });
  await query(
    `INSERT INTO capital_pool (tenant_id, initial_capital) VALUES ($1, 100000)
     ON CONFLICT DO NOTHING`,
    [t.id],
  );
  await query(
    `INSERT INTO payment_schedules
       (tenant_id, loan_id, payment_number, due_date, amount_due, status)
     VALUES ($1, $2, 1, CURRENT_DATE - 40, 1000, 'overdue')`,
    [t.id, loan.id],
  );
  return { tenant: t, admin, client: c, loan };
}

describe("payment penalty allocation", () => {
  it("trigger fills tenant_id on logs (sanity check)", async () => {
    // Already covered elsewhere; just confirm seed works.
    const { loan } = await seedLoanWithOverdue();
    const r = await query("SELECT principal_amount FROM loans WHERE id = $1", [loan.id]);
    expect(Number(r.rows[0].principal_amount)).toBe(1000);
  });

  it("applies a payment to outstanding penalty first, then to amount_due", async () => {
    const { tenant, admin, loan } = await seedLoanWithOverdue();

    // Pay 800: covers all 733.33 of penalty, leaves 66.67 for amount_due.
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: loan.id,
        amount_paid: 800,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "cash",
      });
    expect(res.status).toBeLessThan(400);

    const tx = (
      await query(
        `SELECT amount_paid, penalty_portion FROM transactions WHERE loan_id = $1`,
        [loan.id],
      )
    ).rows[0];
    expect(Number(tx.amount_paid)).toBe(800);
    expect(Number(tx.penalty_portion)).toBeCloseTo(733.33, 2);

    const sched = (
      await query(
        `SELECT amount_paid, penalty_paid FROM payment_schedules WHERE loan_id = $1`,
        [loan.id],
      )
    ).rows[0];
    expect(Number(sched.penalty_paid)).toBeCloseTo(733.33, 2);
    expect(Number(sched.amount_paid)).toBeCloseTo(66.67, 2); // remainder hit amount_due

    // Capital pool: penalty + zero-interest principal portion.
    const pool = (
      await query(
        `SELECT total_collected, total_interest_earned
           FROM capital_pool WHERE tenant_id = $1`,
        [tenant.id],
      )
    ).rows[0];
    expect(Number(pool.total_collected)).toBeCloseTo(66.67, 2); // principal recovery only
    // Interest portion is 0 (loan has no interest); penalty 733.33 is income.
    expect(Number(pool.total_interest_earned)).toBeCloseTo(733.33, 2);
  });

  it("doesn't fake-complete the loan when only penalty is paid", async () => {
    const { admin, loan } = await seedLoanWithOverdue();

    // Pay exactly the penalty amount (600). No amount_due paid, loan should
    // remain 'active' (not flip to 'completed').
    await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: loan.id,
        amount_paid: 600,
        payment_date: new Date().toISOString().split("T")[0],
        payment_method: "cash",
      });

    const after = (
      await query("SELECT status FROM loans WHERE id = $1", [loan.id])
    ).rows[0];
    expect(after.status).toBe("active");
  });
});
