// Suite C — tenant isolation. The #1 multi-tenant security risk.
// Two tenants, each with their own client/loan/admin; assert A can never
// see or touch B's data, and that a platform admin can see both.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
} from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
let A, B;

beforeAll(async () => {
  const ta = await createTenant();
  const tb = await createTenant();
  A = {
    tenant: ta,
    admin: await createUser(ta.id, { role: "admin" }),
    client: await createClient(ta.id),
  };
  A.loan = await createLoan(ta.id, A.client.id);
  B = {
    tenant: tb,
    admin: await createUser(tb.id, { role: "admin" }),
    client: await createClient(tb.id),
  };
  B.loan = await createLoan(tb.id, B.client.id);
});

describe("Tenant isolation", () => {
  it("list endpoints only return the caller's tenant rows", async () => {
    const clients = await request(app)
      .get("/api/clients")
      .set("Authorization", auth(A.admin))
      .expect(200);
    const cids = clients.body.data.map((c) => c.id);
    expect(cids).toContain(A.client.id);
    expect(cids).not.toContain(B.client.id);

    const loans = await request(app)
      .get("/api/loans")
      .set("Authorization", auth(A.admin))
      .expect(200);
    const lids = loans.body.data.map((l) => l.id);
    expect(lids).toContain(A.loan.id);
    expect(lids).not.toContain(B.loan.id);
  });

  it("cannot fetch another tenant's loan by id", async () => {
    const res = await request(app)
      .get(`/api/loans/${B.loan.id}`)
      .set("Authorization", auth(A.admin));
    expect(res.status).toBe(404);
  });

  it("cannot record a payment against another tenant's loan", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(A.admin))
      .send({
        loan_id: B.loan.id,
        amount_paid: 1000,
        payment_date: "2026-05-21",
        payment_method: "cash",
      });
    expect(res.status).toBe(404); // scoped lookup → not found for tenant A

    const c = (
      await query("SELECT COUNT(*) c FROM transactions WHERE loan_id = $1", [
        B.loan.id,
      ])
    ).rows[0];
    expect(parseInt(c.c, 10)).toBe(0); // nothing recorded against B's loan
  });

  it("platform admin can see all tenants' data", async () => {
    const pa = await createUser(A.tenant.id, {
      role: "admin",
      is_platform_admin: true,
    });
    const loans = await request(app)
      .get("/api/loans")
      .set("Authorization", auth(pa))
      .expect(200);
    const lids = loans.body.data.map((l) => l.id);
    expect(lids).toContain(A.loan.id);
    expect(lids).toContain(B.loan.id);
  });

  // ── Regression guards for cross-tenant bugs we fixed this round.
  // Each one used to "succeed" against another tenant's row because of
  // a subtle scoping bug (ambiguous tenant_id after a JOIN, or a
  // tenantClause param-offset off-by-one). Keep these tests so the
  // bugs can't quietly come back.

  it("cannot edit another tenant's loan via PUT /loans/:id/edit", async () => {
    // Reproduces the ambiguous-tenant_id-after-LEFT-JOIN-loan_packages bug.
    const res = await request(app)
      .put(`/api/loans/${B.loan.id}/edit`)
      .set("Authorization", auth(A.admin))
      .send({ penalty_rate: 99 });
    expect(res.status).toBe(404);

    const row = (
      await query(
        "SELECT penalty_rate FROM loans WHERE id = $1",
        [B.loan.id],
      )
    ).rows[0];
    expect(parseFloat(row.penalty_rate)).not.toBe(99);
  });

  it("cannot mark another tenant's promise kept", async () => {
    // Reproduces the tenantClause-offset bug on PUT /promises/:pid/kept.
    const promise = (
      await query(
        `INSERT INTO promises_to_pay (tenant_id, loan_id, amount, promised_date, captured_by)
         VALUES ($1, $2, 500, CURRENT_DATE + 1, $3)
         RETURNING id`,
        [B.tenant.id, B.loan.id, B.admin.id],
      )
    ).rows[0];

    const res = await request(app)
      .put(`/api/promises/${promise.id}/kept`)
      .set("Authorization", auth(A.admin));
    expect(res.status).toBe(404);

    const row = (
      await query("SELECT status FROM promises_to_pay WHERE id = $1", [
        promise.id,
      ])
    ).rows[0];
    expect(row.status).toBe("pending");
  });

  it("cannot cancel another tenant's promise", async () => {
    // Same offset class on PUT /promises/:pid/cancel.
    const promise = (
      await query(
        `INSERT INTO promises_to_pay (tenant_id, loan_id, amount, promised_date, captured_by)
         VALUES ($1, $2, 500, CURRENT_DATE + 1, $3)
         RETURNING id`,
        [B.tenant.id, B.loan.id, B.admin.id],
      )
    ).rows[0];

    const res = await request(app)
      .put(`/api/promises/${promise.id}/cancel`)
      .set("Authorization", auth(A.admin))
      .send({ cancelled_reason: "drive-by" });
    expect(res.status).toBe(404);

    const row = (
      await query("SELECT status FROM promises_to_pay WHERE id = $1", [
        promise.id,
      ])
    ).rows[0];
    expect(row.status).toBe("pending");
  });
});
