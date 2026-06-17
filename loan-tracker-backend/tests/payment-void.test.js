// Reversing (voiding) a payment: soft-voids the transaction, restores the loan
// (active + full balance), reverses the capital-pool booking, and clears any
// overpayment refund liability. The voided row stays in the summary, badged.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor, loanBalance } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const today = () => new Date().toISOString().slice(0, 10);
afterAll(closePool);

async function pool(tenantId) {
  const r = await query("SELECT total_collected, total_interest_earned FROM capital_pool WHERE tenant_id = $1", [tenantId]);
  return { collected: Number(r.rows[0].total_collected), interest: Number(r.rows[0].total_interest_earned) };
}

// A disbursed loan (real schedule + capital movement), with future-dated
// installments so no penalties muddy the split. principal 50k + interest 6k.
async function disbursedLoan() {
  const t = await createTenant();
  const admin = await createUser(t.id, { role: "admin" });
  const client = await createClient(t.id);
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned) VALUES ($1, 1000000, 0, 0, 0)",
    [t.id],
  );
  // Real path: apply → approve → disburse, so totals + schedule agree.
  const loan = (
    await request(app).post("/api/loans").set("Authorization", auth(admin)).send({
      client_id: client.id, principal_amount: 50000, annual_interest_rate: 24,
      loan_duration_months: 6, interest_method: "flat",
    })
  ).body.data;
  await request(app).post(`/api/loans/${loan.id}/approve`).set("Authorization", auth(admin)).send({});
  await request(app).post(`/api/loans/${loan.id}/disburse`).set("Authorization", auth(admin)).send({ disbursement_method: "cash", disbursement_date: today() });
  const ld = (await query("SELECT total_amount_due, total_interest FROM loans WHERE id = $1", [loan.id])).rows[0];
  const TD = Number(ld.total_amount_due);
  const TI = Number(ld.total_interest);
  return { t, admin, client, loan, TD, TI, PRIN: TD - TI };
}

describe("payment reversal (void)", () => {
  it("reverses an overpayment: loan back to active, pool restored, overpayment cleared", async () => {
    const { t, admin, loan, TD, TI, PRIN } = await disbursedLoan();
    const PAY = TD + 4000; // overpay by 4,000

    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: PAY, payment_date: today(), payment_method: "M-Pesa" });

    const txn = (await query("SELECT * FROM transactions WHERE loan_id = $1", [loan.id])).rows[0];
    const completed = (await query("SELECT status, overpayment_amount, refund_status FROM loans WHERE id = $1", [loan.id])).rows[0];
    expect(completed.status).toBe("completed");
    expect(Number(completed.overpayment_amount)).toBe(4000);
    expect(completed.refund_status).toBe("pending");
    const afterPay = await pool(t.id);
    expect(afterPay.collected).toBe(PRIN); // principal booked
    expect(afterPay.interest).toBe(TI); // interest booked (overpayment NOT booked)

    // Reverse it.
    const v = await request(app).post(`/api/payments/${txn.id}/void`).set("Authorization", auth(admin)).send({ reason: "Meant to pay less" });
    expect(v.status).toBe(200);
    expect(v.body.data.loan_status).toBe("active");

    const after = (await query("SELECT status, overpayment_amount, refund_status, completed_via FROM loans WHERE id = $1", [loan.id])).rows[0];
    expect(after.status).toBe("active");
    expect(Number(after.overpayment_amount)).toBe(0);
    expect(after.refund_status).toBeNull();
    expect(await loanBalance(loan.id)).toBe(TD); // full balance restored

    const voided = (await query("SELECT payment_status, voided_at FROM transactions WHERE id = $1", [txn.id])).rows[0];
    expect(voided.payment_status).toBe("voided");
    expect(voided.voided_at).toBeTruthy();

    const poolAfter = await pool(t.id);
    expect(poolAfter.collected).toBe(0); // principal reversed
    expect(poolAfter.interest).toBe(0); // interest reversed

    // The capital ledger entry for the payment is gone.
    const cap = await query("SELECT COUNT(*)::int AS n FROM capital_transactions WHERE transaction_id = $1", [txn.id]);
    expect(cap.rows[0].n).toBe(0);
  });

  it("the reversed payment stays in the summary, badged voided, out of totals", async () => {
    const { admin, loan } = await disbursedLoan();
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: 20000, payment_date: today(), payment_method: "cash" });
    const txn = (await query("SELECT * FROM transactions WHERE loan_id = $1", [loan.id])).rows[0];
    await request(app).post(`/api/payments/${txn.id}/void`).set("Authorization", auth(admin)).send({});

    const summary = await request(app).get(`/api/payments/loan/${loan.id}/summary`).set("Authorization", auth(admin));
    expect(summary.status).toBe(200);
    const row = summary.body.data.transactions.find((x) => x.id === txn.id);
    expect(row).toBeTruthy();
    expect(row.payment_status).toBe("voided");
    expect(row.voided).toBe(true);
    expect(row.receipt).toBeNull();
    expect(Number(summary.body.data.summary.total_paid)).toBe(0);
  });

  it("won't reverse an already-voided payment", async () => {
    const { admin, loan } = await disbursedLoan();
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: 10000, payment_date: today(), payment_method: "cash" });
    const txn = (await query("SELECT * FROM transactions WHERE loan_id = $1", [loan.id])).rows[0];
    await request(app).post(`/api/payments/${txn.id}/void`).set("Authorization", auth(admin)).send({});
    const again = await request(app).post(`/api/payments/${txn.id}/void`).set("Authorization", auth(admin)).send({});
    expect(again.status).toBe(400);
  });
});
