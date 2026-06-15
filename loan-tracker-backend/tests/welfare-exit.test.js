// Welfare member exit: pays out the member's full net savings from the pool and
// deactivates them. Blocked while they owe a loan or have unpaid penalties.
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
  const member = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Jane", last_name: "Doe", phone_number: "0700000000" })).body.data;
  return { admin, w, member };
}
const contribute = (admin, w, m, amount) =>
  request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount });

describe("welfare member exit", () => {
  it("pays out full savings and deactivates the member", async () => {
    const { admin, w, member } = await setup();
    await contribute(admin, w, member, 3000);

    const res = await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(200);
    expect(res.body.payout).toBe(3000);
    expect(res.body.data.status).toBe("inactive");

    // Savings zeroed, pool drained.
    const detail = await request(app).get(`/api/welfares/${w.id}/members/${member.id}`).set("Authorization", auth(admin));
    expect(detail.body.data.savings_balance).toBe(0);
    const pool = await request(app).get(`/api/welfares/${w.id}/members/pool`).set("Authorization", auth(admin));
    expect(pool.body.data.balance).toBe(0);
  });

  it("exits cleanly when the member has no savings", async () => {
    const { admin, w, member } = await setup();
    const res = await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(200);
    expect(res.body.payout).toBe(0);
    expect(res.body.data.status).toBe("inactive");
  });

  it("blocks exit while a loan is outstanding", async () => {
    const { admin, w, member } = await setup();
    await contribute(admin, w, member, 5000); // fund the pool
    await request(app).post(`/api/welfares/${w.id}/members/${member.id}/loans`).set("Authorization", auth(admin)).send({ principal: 2000, duration_months: 1, interest_rate: 0 });

    const res = await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/loan/i);
  });

  it("blocks exit while a penalty is unpaid", async () => {
    const { admin, w, member } = await setup();
    await contribute(admin, w, member, 1000);
    await request(app).post(`/api/welfares/${w.id}/penalties`).set("Authorization", auth(admin)).send({ member_id: member.id, amount: 200, description: "Late" });

    const res = await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/penalt/i);
  });

  it("rejects a double exit", async () => {
    const { admin, w, member } = await setup();
    await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    const again = await request(app).post(`/api/welfares/${w.id}/members/${member.id}/exit`).set("Authorization", auth(admin)).send({});
    expect(again.status).toBe(400);
  });
});
