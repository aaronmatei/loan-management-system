// Phase D — member-initiated requests + welfare-admin approval. A request has no
// pool effect until approved; approval runs the same pool logic as a direct
// issue/withdrawal (welfarePoolService).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

const customerToken = (pcId, tenantId) =>
  "Bearer " +
  jwt.sign(
    { platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
const pcId = async (phone) => (await query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone])).rows[0].id;

async function setup(savings = 50000) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind = 'welfare' WHERE id = $1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  const m = (
    await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
      .send({ first_name: "Jane", last_name: "D", phone_number: "0795400111", id_number: "REQ1" })
  ).body.data;
  await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
  if (savings) await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: savings });
  const tok = customerToken(await pcId("+254795400111"), t.id);
  return { tenant: t, admin, welfare: w, member: m, tok };
}

describe("member portal requests + admin approval", () => {
  it("loan request → admin approve issues a real member loan", async () => {
    const { admin, welfare, member, tok } = await setup();
    const reqRes = await request(app)
      .post("/api/welfare/member/loan-requests")
      .set("Authorization", tok)
      .send({ principal: 20000, duration_months: 6, purpose: "School fees" });
    expect(reqRes.status).toBe(201);
    const reqId = reqRes.body.data.id;

    const pending = await request(app).get(`/api/welfares/${welfare.id}/requests/loans?status=pending`).set("Authorization", auth(admin));
    expect(pending.body.data).toHaveLength(1);

    const approve = await request(app)
      .post(`/api/welfares/${welfare.id}/requests/loans/${reqId}/approve`)
      .set("Authorization", auth(admin))
      .send({ interest_rate: 12, duration_months: 6 });
    expect(approve.status).toBe(200);
    expect(approve.body.data.loan.loan_code).toMatch(/^MBL-/);

    // The request is linked to the issued loan, and the member can see it.
    const row = (await query("SELECT * FROM member_loan_requests WHERE id = $1", [reqId])).rows[0];
    expect(row.status).toBe("approved");
    expect(row.issued_loan_id).toBe(approve.body.data.loan.id);
    const loans = await request(app).get("/api/welfare/member/loans").set("Authorization", tok);
    expect(loans.body.data).toHaveLength(1);
  });

  it("captures custom rate/method + collateral on a request and attaches it to the issued loan", async () => {
    const { admin, welfare, tok } = await setup();
    const reqRes = await request(app)
      .post("/api/welfare/member/loan-requests")
      .set("Authorization", tok)
      .send({ principal: 15000, duration_months: 4, purpose: "Stock", interest_rate: 18, interest_method: "reducing", collateral_description: "Car logbook", collateral_value: 300000 });
    expect(reqRes.status).toBe(201);
    expect(Number(reqRes.body.data.interest_rate)).toBe(18);
    expect(reqRes.body.data.interest_method).toBe("reducing");
    expect(reqRes.body.data.collateral_description).toBe("Car logbook");

    // Collateral with no value is rejected.
    expect((await request(app).post("/api/welfare/member/loan-requests").set("Authorization", tok)
      .send({ principal: 1000, duration_months: 2, collateral_description: "Phone" })).status).toBe(400);

    const approve = await request(app)
      .post(`/api/welfares/${welfare.id}/requests/loans/${reqRes.body.data.id}/approve`)
      .set("Authorization", auth(admin)).send({});
    expect(approve.status).toBe(200);
    const loanId = approve.body.data.loan.id;

    // The offered collateral now hangs off the issued loan.
    const coll = (await query("SELECT * FROM member_loan_collateral WHERE member_loan_id = $1", [loanId])).rows;
    expect(coll).toHaveLength(1);
    expect(coll[0].description).toBe("Car logbook");
    expect(Number(coll[0].appraised_value)).toBe(300000);
  });

  it("exposes the chama loan policy so a member can request a default (no-package) loan", async () => {
    const { admin, welfare, tok } = await setup();
    await request(app).put(`/api/welfares/${welfare.id}/settings/loan-policy`).set("Authorization", auth(admin))
      .send({ default_loan_interest_rate: 24, default_loan_interest_method: "flat" });
    const pol = await request(app).get("/api/welfare/member/loan-policy").set("Authorization", tok);
    expect(pol.status).toBe(200);
    expect(Number(pol.body.data.annual_interest_rate)).toBe(24);
    expect(pol.body.data.interest_method).toBe("flat");

    // No package: the member requests on the chama's default policy terms.
    const r = await request(app).post("/api/welfare/member/loan-requests").set("Authorization", tok)
      .send({ principal: 10000, duration_months: 5, purpose: "Standard", interest_rate: 24, interest_method: "flat" });
    expect(r.status).toBe(201);
    expect(Number(r.body.data.interest_rate)).toBe(24);
    expect(r.body.data.product_id).toBeNull();
  });

  it("rejects a withdrawal request over the member's savings at submit time", async () => {
    const { tok } = await setup(10000);
    const res = await request(app)
      .post("/api/welfare/member/withdrawal-requests")
      .set("Authorization", tok)
      .send({ amount: 99999 });
    expect(res.status).toBe(400);
  });

  it("withdrawal request → approve pays from the pool; reject leaves it untouched", async () => {
    const { admin, welfare, member, tok } = await setup(40000);
    // Approve path
    const wr = await request(app).post("/api/welfare/member/withdrawal-requests").set("Authorization", tok).send({ amount: 15000, reason: "Emergency" });
    expect(wr.status).toBe(201);
    const poolBefore = (await request(app).get(`/api/welfares/${welfare.id}/members/pool`).set("Authorization", auth(admin))).body.data.balance;
    const ap = await request(app).post(`/api/welfares/${welfare.id}/requests/withdrawals/${wr.body.data.id}/approve`).set("Authorization", auth(admin)).send({});
    expect(ap.status).toBe(200);
    const poolAfter = (await request(app).get(`/api/welfares/${welfare.id}/members/pool`).set("Authorization", auth(admin))).body.data.balance;
    expect(Number(poolBefore) - Number(poolAfter)).toBe(15000);

    // Reject path — no pool change
    const wr2 = await request(app).post("/api/welfare/member/withdrawal-requests").set("Authorization", tok).send({ amount: 5000 });
    const poolBeforeRej = (await request(app).get(`/api/welfares/${welfare.id}/members/pool`).set("Authorization", auth(admin))).body.data.balance;
    const rej = await request(app).post(`/api/welfares/${welfare.id}/requests/withdrawals/${wr2.body.data.id}/reject`).set("Authorization", auth(admin)).send({ notes: "Insufficient pool" });
    expect(rej.status).toBe(200);
    const poolAfterRej = (await request(app).get(`/api/welfares/${welfare.id}/members/pool`).set("Authorization", auth(admin))).body.data.balance;
    expect(Number(poolAfterRej)).toBe(Number(poolBeforeRej));
  });

  it("event request → admin approve creates a welfare event for the member", async () => {
    const { admin, welfare, member, tok } = await setup(0);
    const reqRes = await request(app)
      .post("/api/welfare/member/event-requests")
      .set("Authorization", tok)
      .send({ amount: 8000, event_date: "2090-06-01", reason: "Medical" });
    expect(reqRes.status).toBe(201);
    const reqId = reqRes.body.data.id;

    const queue = await request(app).get(`/api/welfares/${welfare.id}/requests/events?status=pending`).set("Authorization", auth(admin));
    expect(queue.body.data.find((r) => r.id === reqId)).toBeTruthy();

    const appr = await request(app).post(`/api/welfares/${welfare.id}/requests/events/${reqId}/approve`).set("Authorization", auth(admin)).send({});
    expect(appr.status).toBe(200);
    const event = appr.body.data.event;
    expect(event.beneficiary_member_id).toBe(member.id);
    expect(Number(event.amount)).toBe(8000);
    expect(event.status).toBe("open");
    expect(event.needed_by).toBeTruthy();

    const reqAfter = (await query("SELECT status, created_event_id FROM member_event_requests WHERE id=$1", [reqId])).rows[0];
    expect(reqAfter.status).toBe("approved");
    expect(reqAfter.created_event_id).toBe(event.id);
  });

  it("rejects a member event request for a past date", async () => {
    const { tok } = await setup(0);
    const r = await request(app).post("/api/welfare/member/event-requests").set("Authorization", tok).send({ amount: 5000, event_date: "2020-01-01" });
    expect(r.status).toBe(400);
  });
});
