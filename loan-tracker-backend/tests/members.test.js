// Welfare members + contributions pool (Part 1): each welfare has its own
// members roster + a pool separate from the lending capital_pool.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function makeWelfare(admin) {
  const r = await request(app)
    .post("/api/groups")
    .set("Authorization", auth(admin))
    .send({ name: "Umoja Welfare" });
  return r.body.data;
}

async function makeMember(admin, welfareId, over = {}) {
  const r = await request(app)
    .post(`/api/welfares/${welfareId}/members`)
    .set("Authorization", auth(admin))
    .send({ first_name: "Jane", last_name: "Doe", phone_number: "0700000000", ...over });
  return r.body.data;
}

describe("welfare members + contributions pool", () => {
  it("enrols members of a welfare with an auto member number", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    // Member numbers carry the welfare's initials now: MBR-<PREFIX>-<NNNNN>.
    expect(m.member_no).toMatch(/^MBR-[A-Z]+-\d{5}$/);
    expect(m.member_no).toMatch(/-00001$/);
    expect(m.welfare_id).toBe(w.id);
    const m2 = await makeMember(admin, w.id, { first_name: "Ann" });
    expect(m2.member_no).toBe(m.member_no.replace(/\d{5}$/, "00002"));
  });

  it("records contributions and tracks pool + per-member balances per welfare", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const a = await makeMember(admin, w.id, { first_name: "A" });
    const b = await makeMember(admin, w.id, { first_name: "B" });

    const c1 = await request(app)
      .post(`/api/welfares/${w.id}/members/${a.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 5000 });
    expect(c1.status).toBe(201);
    expect(c1.body.pool_balance).toBe(5000);
    expect(c1.body.savings_balance).toBe(5000);

    await request(app)
      .post(`/api/welfares/${w.id}/members/${b.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 3000 });

    const pool = await request(app).get(`/api/welfares/${w.id}/members/pool`).set("Authorization", auth(admin));
    expect(pool.body.data.balance).toBe(8000);
    expect(pool.body.data.total_contributions).toBe(8000);
    expect(pool.body.data.member_count).toBe(2);
  });

  it("keeps each welfare's pool isolated from other welfares", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w1 = await makeWelfare(admin);
    const w2 = await makeWelfare(admin);
    const a = await makeMember(admin, w1.id);
    await request(app)
      .post(`/api/welfares/${w1.id}/members/${a.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 5000 });

    const pool2 = await request(app).get(`/api/welfares/${w2.id}/members/pool`).set("Authorization", auth(admin));
    expect(pool2.body.data.balance).toBe(0);
    // A member of w1 isn't reachable under w2.
    const cross = await request(app).get(`/api/welfares/${w2.id}/members/${a.id}`).set("Authorization", auth(admin));
    expect(cross.status).toBe(404);
  });

  it("blocks withdrawing more than the member has saved", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const w = await makeWelfare(admin);
    const a = await makeMember(admin, w.id);
    await request(app).post(`/api/welfares/${w.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 2000 });

    const over = await request(app).post(`/api/welfares/${w.id}/members/${a.id}/withdrawals`).set("Authorization", auth(admin)).send({ amount: 2500 });
    expect(over.status).toBe(400);
    const ok = await request(app).post(`/api/welfares/${w.id}/members/${a.id}/withdrawals`).set("Authorization", auth(admin)).send({ amount: 2000 });
    expect(ok.status).toBe(201);
    expect(ok.body.savings_balance).toBe(0);
  });

  it("never touches the lending capital pool", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    await query("INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 100000, 0, 0)", [t.id]);
    const w = await makeWelfare(admin);
    const a = await makeMember(admin, w.id);
    await request(app).post(`/api/welfares/${w.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 9000 });

    const cap = (await query("SELECT total_collected, total_disbursed FROM capital_pool WHERE tenant_id = $1", [t.id])).rows[0];
    expect(Number(cap.total_collected)).toBe(0);
    expect(Number(cap.total_disbursed)).toBe(0);
  });

  it("won't expose a welfare from another tenant", async () => {
    const t1 = await createTenant();
    const t2 = await createTenant();
    const admin1 = await createUser(t1.id, { role: "admin" });
    const admin2 = await createUser(t2.id, { role: "admin" });
    const w = await makeWelfare(admin1);
    const cross = await request(app).get(`/api/welfares/${w.id}/members/pool`).set("Authorization", auth(admin2));
    expect(cross.status).toBe(404);
  });

  it("blocks a loan_officer from withdrawing (admin/manager only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const w = await makeWelfare(admin);
    const m = await makeMember(admin, w.id);
    const c = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(officer)).send({ amount: 1000 });
    expect(c.status).toBe(201);
    const wd = await request(app).post(`/api/welfares/${w.id}/members/${m.id}/withdrawals`).set("Authorization", auth(officer)).send({ amount: 500 });
    expect(wd.status).toBe(403);
  });
});
