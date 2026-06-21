// Member loans (Part 2): loans advanced to a welfare's members FROM that
// welfare's pool (not the lending capital_pool). Disbursing draws the pool down;
// repayment restores it, with interest growing the pool.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function makeWelfare(admin) {
  const r = await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja Welfare" });
  await request(app).put(`/api/welfares/${r.body.data.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  return r.body.data;
}
async function makeMember(admin, welfareId) {
  const r = await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", auth(admin)).send({ first_name: "Jane", last_name: "Doe" });
  return r.body.data;
}
async function contribute(admin, welfareId, memberId, amount) {
  await request(app).post(`/api/welfares/${welfareId}/members/${memberId}/contributions`).set("Authorization", auth(admin)).send({ amount });
}
async function poolBalance(admin, welfareId) {
  const r = await request(app).get(`/api/welfares/${welfareId}/members/pool`).set("Authorization", auth(admin));
  return r.body.data.balance;
}

describe("welfare member loans (funded by the pool)", () => {
  it("issues a loan from the pool, drawing it down", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 50000);

    const res = await request(app)
      .post(`/api/welfares/${w.id}/members/${m.id}/loans`)
      .set("Authorization", auth(admin))
      .send({ principal: 20000, interest_rate: 12, duration_months: 6 });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.total_interest)).toBe(1200);
    expect(Number(res.body.data.total_amount_due)).toBe(21200);
    expect(res.body.data.loan_code).toMatch(/^MBL-\d{5}$/);
    expect(res.body.pool_balance).toBe(30000);
    expect(await poolBalance(admin, w.id)).toBe(30000);
  });

  it("won't lend more than the pool holds", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 5000);
    const res = await request(app)
      .post(`/api/welfares/${w.id}/members/${m.id}/loans`)
      .set("Authorization", auth(admin))
      .send({ principal: 8000, interest_rate: 10, duration_months: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pool only holds/i);
  });

  it("repayment restores the pool and interest grows it past the original balance", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 50000);
    const issue = await request(app)
      .post(`/api/welfares/${w.id}/members/${m.id}/loans`)
      .set("Authorization", auth(admin))
      .send({ principal: 20000, interest_rate: 12, duration_months: 6 });
    const loanId = issue.body.data.id;
    expect(await poolBalance(admin, w.id)).toBe(30000);

    const pay = await request(app)
      .post(`/api/welfares/${w.id}/members/${m.id}/loans/${loanId}/payments`)
      .set("Authorization", auth(admin))
      .send({});
    expect(pay.status).toBe(200);
    expect(pay.body.completed).toBe(true);
    expect(await poolBalance(admin, w.id)).toBe(51200);

    const loan = (await query("SELECT status FROM member_loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("completed");
  });

  it("a member loan does NOT change the member's savings balance", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 50000);
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans`).set("Authorization", auth(admin)).send({ principal: 20000, interest_rate: 12, duration_months: 6 });
    const detail = await request(app).get(`/api/welfares/${w.id}/members/${m.id}`).set("Authorization", auth(admin));
    expect(detail.body.data.savings_balance).toBe(50000);
  });

  it("never touches the lending capital_pool", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    await query("INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 100000, 0, 0)", [t.id]);
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 50000);
    const issue = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans`).set("Authorization", auth(admin)).send({ principal: 20000, interest_rate: 12, duration_months: 6 });
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans/${issue.body.data.id}/payments`).set("Authorization", auth(admin)).send({});

    const cap = (await query("SELECT total_disbursed, total_collected FROM capital_pool WHERE tenant_id = $1", [t.id])).rows[0];
    expect(Number(cap.total_disbursed)).toBe(0);
    expect(Number(cap.total_collected)).toBe(0);
  });

  it("marks a loan defaulted (admin/manager only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    await contribute(admin, w.id, m.id, 50000);
    const issue = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans`).set("Authorization", auth(admin)).send({ principal: 20000, interest_rate: 12, duration_months: 6 });
    const loanId = issue.body.data.id;

    const blocked = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans/${loanId}/default`).set("Authorization", auth(officer)).send({});
    expect(blocked.status).toBe(403);
    const ok = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/loans/${loanId}/default`).set("Authorization", auth(admin)).send({});
    expect(ok.status).toBe(200);
    const loan = (await query("SELECT status FROM member_loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("defaulted");
  });
});
