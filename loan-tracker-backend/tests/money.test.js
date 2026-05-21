// Suite A — money math. The highest-value asserts: loan totals, balance
// after a payment, loan closes on full repayment, and the platform fee
// formula. Every test drives the REAL route/service.
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import {
  calculateTenantInterest,
  generateInvoice,
} from "../src/services/billingService.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
  loanBalance,
} from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

describe("Money math", () => {
  it("loan totals: 100k @ 50% p.a. for 12mo → 50k interest, 150k due", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const client = await createClient(tenant.id);

    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 100000,
        annual_interest_rate: 50,
        loan_duration_months: 12,
      });

    expect(res.status).toBe(201);
    const loan = res.body.data;
    expect(parseFloat(loan.total_interest)).toBe(50000);
    expect(parseFloat(loan.total_amount_due)).toBe(150000);
  });

  it("a payment reduces the balance exactly (56k − 20k = 36k)", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      total_amount_due: 56000,
      status: "active",
    });

    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: loan.id,
        amount_paid: 20000,
        payment_date: "2026-05-21",
        payment_method: "cash",
      });

    expect(res.status).toBe(201);
    expect(await loanBalance(loan.id)).toBe(36000);
  });

  it("full repayment closes the loan and zeroes the balance", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      total_amount_due: 56000,
      status: "active",
    });

    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: loan.id,
        amount_paid: 56000,
        payment_date: "2026-05-21",
        payment_method: "cash",
      });

    expect(res.status).toBe(201);
    const row = (
      await query("SELECT status FROM loans WHERE id = $1", [loan.id])
    ).rows[0];
    expect(row.status).toBe("completed");
    expect(await loanBalance(loan.id)).toBe(0);
  });

  it("billing fee = 5% of the INTEREST portion of payments (not principal/whole)", async () => {
    // total_interest/total_amount_due = 6000/56000 → 28000 payment carries
    // 28000 * 6000/56000 = 3000 interest. Fee at 5% = 150.
    const tenant = await createTenant({
      billing_enabled: true,
      billing_fee_percentage: 5,
      billing_base_fee: 0,
    });
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      total_interest: 6000,
      total_amount_due: 56000,
      status: "active",
    });

    const now = new Date();
    const pd = now.toISOString().slice(0, 10);
    await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: loan.id,
        amount_paid: 28000,
        payment_date: pd,
        payment_method: "cash",
      })
      .expect(201);

    const calc = await calculateTenantInterest(
      tenant.id,
      now.getFullYear(),
      now.getMonth() + 1,
    );
    expect(calc.interest_earned).toBeCloseTo(3000, 2);

    const invoice = await generateInvoice(
      tenant.id,
      now.getFullYear(),
      now.getMonth() + 1,
    );
    expect(parseFloat(invoice.amount_due)).toBe(150); // 5% of 3000
    expect(parseFloat(invoice.total_amount)).toBe(150); // base fee 0
  });
});
