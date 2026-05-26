// Disbursement scheduling: the loan starts — and the first repayment falls
// due — exactly one month after the disbursement date, so a loan can never be
// repaid on the day it is disbursed.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate(),
  ).padStart(2, "0")}`;
};

afterAll(closePool);

describe("POST /api/loans/:id/disburse — start date + schedule", () => {
  it("starts the loan one month after disbursement", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const loan = await createLoan(t.id, client.id, {
      status: "approved",
      loan_duration_months: 6,
    });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash", disbursement_date: "2026-01-15" });

    expect(res.status).toBe(200);
    expect(ymd(res.body.data.start_date)).toBe("2026-02-15"); // +1 month
    expect(ymd(res.body.data.end_date)).toBe("2026-07-15"); // +6 months

    const sched = await query(
      "SELECT payment_number, due_date FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
      [loan.id],
    );
    expect(sched.rows).toHaveLength(6);
    // First installment is one month after disbursement (never the same day).
    expect(ymd(sched.rows[0].due_date)).toBe("2026-02-15");
    expect(ymd(sched.rows[5].due_date)).toBe("2026-07-15");
  });
});
