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
// Like disbursedLoan, but disbursed far in the past so every installment is
// overdue and penalties accrue — needed to exercise penalty re-derivation.
async function overdueLoan() {
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
      late_payment_fee: 500, penalty_rate: 5,
    })
  ).body.data;
  await request(app).post(`/api/loans/${loan.id}/approve`).set("Authorization", auth(admin)).send({});
  const past = new Date();
  past.setMonth(past.getMonth() - 8); // 6-month loan disbursed 8mo ago → all overdue
  await request(app).post(`/api/loans/${loan.id}/disburse`).set("Authorization", auth(admin))
    .send({ disbursement_method: "cash", disbursement_date: past.toISOString().slice(0, 10) });
  const ld = (await query("SELECT total_amount_due, total_interest FROM loans WHERE id = $1", [loan.id])).rows[0];
  const TD = Number(ld.total_amount_due);
  return { t, admin, client, loan, TD, TI: Number(ld.total_interest) };
}

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

  it("reversing the payment that cleared the fines reopens them — loan isn't left completed with unpaid penalty", async () => {
    const { admin, loan, TD } = await overdueLoan();
    const summaryUrl = `/api/payments/loan/${loan.id}/summary`;

    // Fines accrued and owed right now (nothing paid yet → outstanding == total).
    const before = await request(app).get(summaryUrl).set("Authorization", auth(admin));
    const P = Number(before.body.data.summary.total_penalty_outstanding);
    expect(P).toBeGreaterThan(0);

    // Payment 1 clears the fines only (penalty is allocated first).
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: P, payment_date: today(), payment_method: "M-Pesa" });
    const fineTxn = (await query(
      "SELECT id FROM transactions WHERE loan_id = $1 AND penalty_portion > 0", [loan.id],
    )).rows[0];
    expect(fineTxn).toBeTruthy();

    // Payment 2 clears all principal + interest → loan completes, fines paid.
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: TD, payment_date: today(), payment_method: "M-Pesa" });
    const done = (await query("SELECT status FROM loans WHERE id = $1", [loan.id])).rows[0];
    expect(done.status).toBe("completed");

    // Reverse the payment that paid the fines.
    const v = await request(app).post(`/api/payments/${fineTxn.id}/void`)
      .set("Authorization", auth(admin)).send({ reason: "wrong amount" });
    expect(v.status).toBe(200);
    // The loan must NOT stay completed while the fine is unpaid.
    expect(v.body.data.loan_status).toBe("active");
    const after = (await query("SELECT status FROM loans WHERE id = $1", [loan.id])).rows[0];
    expect(after.status).toBe("active");

    // The fines are outstanding again, and the stale penalty_paid was rolled back.
    const reopened = await request(app).get(summaryUrl).set("Authorization", auth(admin));
    expect(Number(reopened.body.data.summary.total_penalty_outstanding)).toBeCloseTo(P, 0);
    const pp = (await query(
      "SELECT COALESCE(SUM(penalty_paid),0)::float AS p FROM payment_schedules WHERE loan_id = $1", [loan.id],
    )).rows[0].p;
    expect(pp).toBeCloseTo(0, 0);
  });

  it("a fine reopened by a reversal can be paid off — booked as penalty, not overpayment", async () => {
    const { admin, loan, TD } = await overdueLoan();
    const summaryUrl = `/api/payments/loan/${loan.id}/summary`;
    const P = Number((await request(app).get(summaryUrl).set("Authorization", auth(admin)))
      .body.data.summary.total_penalty_outstanding);

    // Clear the fine, then clear principal+interest → completed.
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: P, payment_date: today(), payment_method: "M-Pesa" });
    const fineTxn = (await query("SELECT id FROM transactions WHERE loan_id=$1 AND penalty_portion>0", [loan.id])).rows[0];
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: TD, payment_date: today(), payment_method: "M-Pesa" });

    // Reverse the fine payment → fine outstanding again, loan active.
    await request(app).post(`/api/payments/${fineTxn.id}/void`).set("Authorization", auth(admin)).send({});
    expect((await query("SELECT status FROM loans WHERE id=$1", [loan.id])).rows[0].status).toBe("active");

    // Pay the fine again. It must be COLLECTED as penalty (clearing the loan),
    // not mis-booked as an overpayment (the bug).
    await request(app).post("/api/payments").set("Authorization", auth(admin))
      .send({ loan_id: loan.id, amount_paid: P, payment_date: today(), payment_method: "M-Pesa" });

    const newTxn = (await query(
      "SELECT penalty_portion, overpayment_portion FROM transactions WHERE loan_id=$1 AND payment_status='completed' ORDER BY id DESC LIMIT 1",
      [loan.id])).rows[0];
    expect(Number(newTxn.penalty_portion)).toBeCloseTo(P, 0);   // went to the fine
    expect(Number(newTxn.overpayment_portion)).toBe(0);          // NOT an overpayment
    const loanAfter = (await query("SELECT status, overpayment_amount, refund_status FROM loans WHERE id=$1", [loan.id])).rows[0];
    expect(loanAfter.status).toBe("completed");
    expect(Number(loanAfter.overpayment_amount)).toBe(0);
    expect(loanAfter.refund_status).toBeNull();
    expect(Number((await request(app).get(summaryUrl).set("Authorization", auth(admin)))
      .body.data.summary.total_penalty_outstanding)).toBeCloseTo(0, 0);
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
