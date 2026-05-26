// Per-tenant loan processing fee: admin sets a rate, new loans snapshot the
// fee + net disbursed amount, and disbursement moves only the NET amount out
// of the capital pool (the lender retains the fee).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("loan processing fee", () => {
  it("lets a tenant admin set interest + processing fee rate", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });

    const res = await request(app)
      .put("/api/settings/loan-policy")
      .set("Authorization", auth(admin))
      .send({ default_interest_rate: 36, processing_fee_rate: 2.5 });
    expect(res.status).toBe(200);

    const row = (
      await query(
        "SELECT default_interest_rate, processing_fee_rate FROM tenants WHERE id = $1",
        [t.id],
      )
    ).rows[0];
    expect(Number(row.default_interest_rate)).toBe(36);
    expect(Number(row.processing_fee_rate)).toBe(2.5);
  });

  it("lets a loan_officer GET the loan policy (needed by the new-loan form)", async () => {
    const t = await createTenant();
    await query(
      "UPDATE tenants SET default_interest_rate = 36, processing_fee_rate = 4 WHERE id = $1",
      [t.id],
    );
    const officer = await createUser(t.id, { role: "loan_officer" });
    const res = await request(app)
      .get("/api/settings/loan-policy")
      .set("Authorization", auth(officer));
    expect(res.status).toBe(200);
    expect(Number(res.body.data.default_interest_rate)).toBe(36);
    expect(Number(res.body.data.processing_fee_rate)).toBe(4);
  });

  it("rejects an out-of-range processing fee rate", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .put("/api/settings/loan-policy")
      .set("Authorization", auth(admin))
      .send({ processing_fee_rate: 150 });
    expect(res.status).toBe(400);
  });

  it("lets the new-loan request override the tenant's processing fee rate", async () => {
    const t = await createTenant();
    await query("UPDATE tenants SET processing_fee_rate = 5 WHERE id = $1", [t.id]);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    // Tenant default is 5%, but this loan goes in at 2%.
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 10000,
        annual_interest_rate: 24,
        loan_duration_months: 6,
        processing_fee_rate: 2,
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.processing_fee_rate)).toBe(2);
    expect(Number(res.body.data.processing_fee)).toBe(200);
    expect(Number(res.body.data.net_disbursed_amount)).toBe(9800);
  });

  it("snapshots the processing fee + net disbursed on a new loan", async () => {
    const t = await createTenant();
    await query("UPDATE tenants SET processing_fee_rate = 5 WHERE id = $1", [t.id]);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 10000,
        annual_interest_rate: 24,
        loan_duration_months: 6,
      });
    expect(res.status).toBe(201);
    const loan = res.body.data;
    expect(Number(loan.processing_fee_rate)).toBe(5);
    expect(Number(loan.processing_fee)).toBe(500); // 5% of 10,000
    expect(Number(loan.net_disbursed_amount)).toBe(9500);
  });

  it("disburses NET of the processing fee to the capital pool", async () => {
    const t = await createTenant();
    await query("UPDATE tenants SET processing_fee_rate = 5 WHERE id = $1", [t.id]);
    await query(
      "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 100000, 0, 0)",
      [t.id],
    );
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    const create = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 10000,
        annual_interest_rate: 24,
        loan_duration_months: 6,
      });
    const loanId = create.body.data.id;

    await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set("Authorization", auth(admin))
      .send({});
    const disb = await request(app)
      .post(`/api/loans/${loanId}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash" });
    expect(disb.status).toBe(200);

    const pool = (
      await query("SELECT total_disbursed FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(pool.total_disbursed)).toBe(9500); // net, not the full 10,000
  });
});
