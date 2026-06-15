// Welfare dividends / share-out: distributes the pool's retained surplus
// (income above members' savings principal) pro-rata by savings or equally.
// Dividends leave the pool as cash and don't touch savings principal.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup() {
  const t = await createTenant();
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  return { t, admin, w };
}
const addMember = (admin, w, first) =>
  request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: first, last_name: "M", phone_number: "0700000000" }).then((r) => r.body.data);
const contribute = (admin, w, m, amount) =>
  request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount });
const savings = (admin, w, m) =>
  request(app).get(`/api/welfares/${w.id}/members/${m.id}`).set("Authorization", auth(admin)).then((r) => r.body.data.savings_balance);
const poolBal = (admin, w) =>
  request(app).get(`/api/welfares/${w.id}/members/pool`).set("Authorization", auth(admin)).then((r) => r.body.data.balance);

// Drop pure income into the pool so there's a surplus to share, by paying a
// penalty (penalty payments grow the pool but aren't savings).
async function addPoolIncome(admin, w, member, amount) {
  const a = (await request(app).post(`/api/welfares/${w.id}/penalties`).set("Authorization", auth(admin)).send({ member_id: member.id, amount, description: "x" })).body.data;
  await request(app).post(`/api/welfares/${w.id}/penalties/${a.id}/pay`).set("Authorization", auth(admin)).send({});
}

describe("welfare dividends / share-out", () => {
  it("reports the distributable surplus (pool above savings)", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1000);
    await addPoolIncome(admin, w, a, 300); // pool 1300, savings 1000

    const r = await request(app).get(`/api/welfares/${w.id}/dividends/distributable`).set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.data.pool).toBe(1300);
    expect(r.body.data.total_savings).toBe(1000);
    expect(r.body.data.surplus).toBe(300);
  });

  it("distributes pro-rata by savings; dividends leave the pool but not savings", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    const b = await addMember(admin, w, "B");
    await contribute(admin, w, a, 3000);
    await contribute(admin, w, b, 1000);
    await addPoolIncome(admin, w, a, 400); // pool 4400, savings 4000, surplus 400

    const res = await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin)).send({ basis: "savings" });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.total_amount)).toBe(400);
    // A has 3/4 of savings → 300, B → 100.
    const byMember = Object.fromEntries(res.body.data.shares.map((s) => [s.member_id, s.share]));
    expect(byMember[a.id]).toBe(300);
    expect(byMember[b.id]).toBe(100);

    // Pool drained to exactly the savings principal; savings unchanged.
    expect(await poolBal(admin, w)).toBe(4000);
    expect(await savings(admin, w, a)).toBe(3000);
    expect(await savings(admin, w, b)).toBe(1000);

    // No surplus left to distribute.
    const after = await request(app).get(`/api/welfares/${w.id}/dividends/distributable`).set("Authorization", auth(admin));
    expect(after.body.data.surplus).toBe(0);
  });

  it("distributes equally when basis=equal", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    const b = await addMember(admin, w, "B");
    await contribute(admin, w, a, 3000);
    await contribute(admin, w, b, 1000);
    await addPoolIncome(admin, w, a, 500); // surplus 500

    const res = await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin)).send({ basis: "equal" });
    const byMember = Object.fromEntries(res.body.data.shares.map((s) => [s.member_id, s.share]));
    expect(byMember[a.id]).toBe(250);
    expect(byMember[b.id]).toBe(250);
  });

  it("rejects a share-out when there is no surplus", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1000); // pool == savings, surplus 0
    const res = await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/surplus/i);
  });

  it("rejects distributing more than the surplus", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1000);
    await addPoolIncome(admin, w, a, 200);
    const res = await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin)).send({ amount: 500 });
    expect(res.status).toBe(400);
  });

  it("records the distribution with a per-member breakdown", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1000);
    await addPoolIncome(admin, w, a, 200);
    const made = (await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin)).send({})).body.data;

    const list = await request(app).get(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(admin));
    expect(list.body.data[0].id).toBe(made.id);
    const detail = await request(app).get(`/api/welfares/${w.id}/dividends/${made.id}`).set("Authorization", auth(admin));
    expect(detail.body.data.shares.length).toBe(1);
    expect(Number(detail.body.data.shares[0].amount)).toBe(200);
  });

  it("blocks a loan_officer from running a share-out", async () => {
    const { t, w } = await setup();
    const officer = await createUser(t.id, { role: "loan_officer" });
    const res = await request(app).post(`/api/welfares/${w.id}/dividends`).set("Authorization", auth(officer)).send({});
    expect(res.status).toBe(403);
  });
});
