// A defaulted loan now WARNS (confirmable) at every pipeline step rather than
// hard-blocking — the lender can proceed with acknowledge_dues:true. The
// 3-active cap stays a hard block.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("borrowing gate at approval + disbursement", () => {
  it("warns (not blocks) on approval when the client has a defaulted loan, then proceeds on confirm", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });
    const loan = await createLoan(t.id, c.id, { status: "under_review" });

    const warn = await request(app)
      .post(`/api/loans/${loan.id}/approve`)
      .set("Authorization", auth(admin))
      .send({});
    expect(warn.status).toBe(409);
    expect(warn.body.blocker).toBe("client_has_dues");
    expect(warn.body.requires_confirmation).toBe(true);

    // Proceed with the acknowledgement.
    const ok = await request(app)
      .post(`/api/loans/${loan.id}/approve`)
      .set("Authorization", auth(admin))
      .send({ acknowledge_dues: true });
    expect(ok.status).toBe(200);
  });

  it("warns (not blocks) on disbursement when the client has a defaulted loan, then proceeds on confirm", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });
    const loan = await createLoan(t.id, c.id, { status: "approved" });

    const warn = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash", disbursement_date: "2026-01-15" });
    expect(warn.status).toBe(409);
    expect(warn.body.requires_confirmation).toBe(true);

    const ok = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash", disbursement_date: "2026-01-15", acknowledge_dues: true });
    expect(ok.status).toBe(200);
  });

  it("blocks disbursement when the client already has 3 active loans", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });
    const loan = await createLoan(t.id, c.id, { status: "approved" });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash" });
    expect(res.status).toBe(400);
    expect(res.body.blocker).toBe("max_active_loans");
  });

  it("warns (not blocks) when creating a loan for a client with dues, then proceeds on confirm", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });

    const body = { client_id: c.id, principal_amount: 20000, annual_interest_rate: 36, loan_duration_months: 6 };
    const warn = await request(app).post("/api/loans").set("Authorization", auth(admin)).send(body);
    expect(warn.status).toBe(409);
    expect(warn.body.blocker).toBe("client_has_dues");
    expect(warn.body.requires_confirmation).toBe(true);

    const ok = await request(app).post("/api/loans").set("Authorization", auth(admin)).send({ ...body, acknowledge_dues: true });
    expect(ok.status).toBe(201);
  });

  it("the 3-active-loan cap stays a hard block (not a warning)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });

    const res = await request(app).post("/api/loans").set("Authorization", auth(admin))
      .send({ client_id: c.id, principal_amount: 20000, annual_interest_rate: 36, loan_duration_months: 6, acknowledge_dues: true });
    expect(res.status).toBe(400);
    expect(res.body.blocker).toBe("max_active_loans");
  });

  it("still disburses for a client in good standing", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    const loan = await createLoan(t.id, c.id, { status: "approved" });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash", disbursement_date: "2026-01-15" });
    expect(res.status).toBe(200);
  });
});
