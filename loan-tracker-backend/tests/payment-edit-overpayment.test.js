// Editing a payment's amount must RE-DERIVE its overpayment, not preserve it.
// Editing the amount down can drop a loan from overpaid to underpaid; keeping
// the stale overpayment_portion leaves a phantom surplus that then gets
// refunded — paying out money the loan never had (the LN-PAY-042022-00003 bug).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const today = () => new Date().toISOString().slice(0, 10);
afterAll(closePool);

// A disbursed loan with future-dated installments (no penalties). 50k + 6k.
async function disbursedLoan() {
  const t = await createTenant();
  const admin = await createUser(t.id, { role: "admin" });
  const client = await createClient(t.id);
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned) VALUES ($1, 1000000, 0, 0, 0)",
    [t.id],
  );
  const loan = (
    await request(app).post("/api/loans").set("Authorization", auth(admin)).send({
      client_id: client.id, principal_amount: 50000, annual_interest_rate: 24,
      loan_duration_months: 6, interest_method: "flat",
    })
  ).body.data;
  await request(app).post(`/api/loans/${loan.id}/approve`).set("Authorization", auth(admin)).send({});
  await request(app).post(`/api/loans/${loan.id}/disburse`).set("Authorization", auth(admin))
    .send({ disbursement_method: "cash", disbursement_date: today() });
  const TD = Number((await query("SELECT total_amount_due FROM loans WHERE id=$1", [loan.id])).rows[0].total_amount_due);
  return { t, admin, loan, TD };
}

const txnOf = async (loanId) =>
  (await query("SELECT * FROM transactions WHERE loan_id=$1 ORDER BY id DESC LIMIT 1", [loanId])).rows[0];
const loanOf = async (loanId) =>
  (await query("SELECT status, overpayment_amount, refund_status FROM loans WHERE id=$1", [loanId])).rows[0];

describe("editing a payment re-derives its overpayment", () => {
  it("editing the amount DOWN past the surplus clears the phantom overpayment", async () => {
    const { admin, loan, TD } = await disbursedLoan();
    // Overpay by 5,000 → completed, 5,000 surplus pending refund.
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: TD + 5000, payment_date: today(), payment_method: "M-Pesa" });
    let txn = await txnOf(loan.id);
    expect(Number(txn.overpayment_portion)).toBe(5000);
    expect((await loanOf(loan.id)).refund_status).toBe("pending");

    // Edit it down to UNDER the amount due → loan underpaid, NO overpayment.
    const r = await request(app).put(`/api/payments/${txn.id}`).set("Authorization", auth(admin))
      .send({ amount_paid: TD - 3000 });
    expect(r.status).toBe(200);

    txn = await txnOf(loan.id);
    expect(Number(txn.overpayment_portion)).toBe(0); // phantom surplus gone
    const l = await loanOf(loan.id);
    expect(Number(l.overpayment_amount)).toBe(0);
    expect(l.refund_status).toBeNull();
    expect(l.status).toBe("active"); // underpaid now
  });

  it("editing the amount DOWN but still overpaid shrinks the overpayment to match", async () => {
    const { admin, loan, TD } = await disbursedLoan();
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: TD + 5000, payment_date: today(), payment_method: "M-Pesa" });
    const txn = await txnOf(loan.id);

    const r = await request(app).put(`/api/payments/${txn.id}`).set("Authorization", auth(admin))
      .send({ amount_paid: TD + 1500 });
    expect(r.status).toBe(200);

    expect(Number((await txnOf(loan.id)).overpayment_portion)).toBe(1500);
    const l = await loanOf(loan.id);
    expect(Number(l.overpayment_amount)).toBe(1500);
    expect(l.status).toBe("completed");
    expect(l.refund_status).toBe("pending");
  });

  it("editing only the date leaves an existing overpayment untouched", async () => {
    const { admin, loan, TD } = await disbursedLoan();
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: TD + 2000, payment_date: today(), payment_method: "M-Pesa" });
    const txn = await txnOf(loan.id);
    const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const r = await request(app).put(`/api/payments/${txn.id}`).set("Authorization", auth(admin))
      .send({ payment_date: yday });
    expect(r.status).toBe(200);
    expect(Number((await txnOf(loan.id)).overpayment_portion)).toBe(2000);
    expect(Number((await loanOf(loan.id)).overpayment_amount)).toBe(2000);
  });
});
