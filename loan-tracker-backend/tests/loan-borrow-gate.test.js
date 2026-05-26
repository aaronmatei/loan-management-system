// A defaulted loan (or hitting the 3-active cap) blocks new lending at EVERY
// pipeline step, not just application — so a loan that slipped through before
// the client defaulted still can't be approved or disbursed.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("borrowing gate at approval + disbursement", () => {
  it("blocks approval when the client has a defaulted loan", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });
    const loan = await createLoan(t.id, c.id, { status: "under_review" });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/approve`)
      .set("Authorization", auth(admin))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.blocker).toBe("defaulted_loans");
  });

  it("blocks disbursement when the client has a defaulted loan", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });
    const loan = await createLoan(t.id, c.id, { status: "approved" });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash", disbursement_date: "2026-01-15" });
    expect(res.status).toBe(400);
    expect(res.body.blocker).toBe("defaulted_loans");
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
