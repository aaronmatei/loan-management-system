// The client credit profile (staff Client Profile page) only counts
// DISBURSED loans (active/completed/defaulted). Pending or approved
// applications are not yet real loans, so they're excluded from the loan
// history, borrowed totals and loan counts.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("GET /api/clients/:id/credit-profile", () => {
  it("excludes pending/approved loans from the loan history", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    const active = await createLoan(t.id, client.id, { status: "active" });
    await createLoan(t.id, client.id, { status: "pending" });
    await createLoan(t.id, client.id, { status: "approved" });

    const res = await request(app)
      .get(`/api/clients/${client.id}/credit-profile`)
      .set("Authorization", auth(admin));

    expect(res.status).toBe(200);
    const { loans, summary } = res.body.data;
    expect(loans).toHaveLength(1);
    expect(loans[0].id).toBe(active.id);
    expect(summary.total_loans_count).toBe(1);
  });
});
