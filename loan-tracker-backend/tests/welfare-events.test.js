// Welfare EVENTS (phase 1): ad-hoc member payouts funded by a SEPARATE events
// pool. Pool covers it → disburse now; otherwise collect equal shares from ALL
// members (beneficiary included) and disburse once the pool reaches the amount.
// Event money must never touch the savings pool (member_pool_transactions).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

let seq = 0;
async function welfareSetup(nMembers = 3) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const members = [];
  for (let i = 0; i < nMembers; i++) {
    seq++;
    members.push(
      (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
        .send({ first_name: `M${seq}`, last_name: "X", phone_number: `0799${String(100000 + seq).slice(-6)}`, id_number: `EVT${seq}` })).body.data,
    );
  }
  return { t, admin, w, members };
}
const ev = (admin, w) => ({ list: () => request(app).get(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)) });
const memberSavings = async (mid) =>
  Number((await query("SELECT COALESCE(SUM(direction*amount),0) AS b FROM member_pool_transactions WHERE member_id=$1 AND type IN ('contribution','withdrawal','adjustment')", [mid])).rows[0].b);

describe("welfare events — phase 1", () => {
  it("collects equal shares from ALL members (beneficiary included) then disburses", async () => {
    const { admin, w, members } = await welfareSetup(3);
    const [m1, m2, m3] = members;

    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin))
      .send({ beneficiary_member_id: m1.id, amount: 3000, title: "M1 hospital" });
    expect(created.status).toBe(201);
    const eventId = created.body.data.id;

    // Pool is empty → collect the full 3000 as equal shares.
    const funded = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "collect" });
    expect(funded.status).toBe(200);
    expect(funded.body.data.event.status).toBe("collecting");

    const detail = await request(app).get(`/api/welfares/${w.id}/events/${eventId}`).set("Authorization", auth(admin));
    expect(detail.body.data.shares).toHaveLength(3); // beneficiary included
    const totalDue = detail.body.data.shares.reduce((a, s) => a + Number(s.amount_due), 0);
    expect(totalDue).toBeCloseTo(3000, 2);
    expect(detail.body.data.shares.find((s) => s.member_id === m1.id)).toBeTruthy(); // beneficiary pays too

    // Members pay their shares → events pool fills.
    for (const m of [m1, m2, m3]) {
      const r = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/shares/${m.id}/pay`).set("Authorization", auth(admin)).send({});
      expect(r.status).toBe(200);
    }
    expect(Number((await ev(admin, w).list()).body.data.pool_balance)).toBeCloseTo(3000, 2);

    // Disburse.
    const payout = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/payout`).set("Authorization", auth(admin)).send({});
    expect(payout.status).toBe(200);
    expect(payout.body.data.event.status).toBe("disbursed");
    expect(Number(payout.body.data.event.disbursed_amount)).toBe(3000);
    expect(Number(payout.body.data.poolBalance)).toBeCloseTo(0, 2);

    // The savings pool is untouched — nobody's equity moved.
    for (const m of members) expect(await memberSavings(m.id)).toBe(0);
  });

  it("disburses straight from the events pool when it already covers the amount", async () => {
    const { admin, w, members } = await welfareSetup(2);
    const [m1] = members;
    // Seed the events pool with a standing balance (leftover from prior events).
    await query(
      `INSERT INTO welfare_event_ledger (tenant_id, welfare_id, type, amount, direction, balance_after)
       SELECT tenant_id, id, 'contribution', 5000, 1, 5000 FROM groups WHERE id=$1`,
      [w.id],
    );
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: m1.id, amount: 3000, title: "M1 event" });
    const eventId = created.body.data.id;

    const funded = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "pool" });
    expect(funded.status).toBe(200);
    expect(funded.body.data.event.status).toBe("disbursed");
    expect(Number(funded.body.data.poolBalance)).toBeCloseTo(2000, 2); // 5000 - 3000
    // No shares were raised.
    const detail = await request(app).get(`/api/welfares/${w.id}/events/${eventId}`).set("Authorization", auth(admin));
    expect(detail.body.data.shares).toHaveLength(0);
  });

  it("won't disburse from the pool when it can't cover the amount, and won't pay out before collection completes", async () => {
    const { admin, w, members } = await welfareSetup(2);
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: members[0].id, amount: 4000 });
    const eventId = created.body.data.id;

    const poolFund = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "pool" });
    expect(poolFund.status).toBe(400); // empty pool can't cover

    await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "collect" });
    // Only one of two members pays → pool has 2000 < 4000.
    await request(app).post(`/api/welfares/${w.id}/events/${eventId}/shares/${members[0].id}/pay`).set("Authorization", auth(admin)).send({});
    const early = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/payout`).set("Authorization", auth(admin)).send({});
    expect(early.status).toBe(400);
  });

  it("rejects an event whose beneficiary isn't an active member of the welfare", async () => {
    const { admin, w } = await welfareSetup(1);
    const r = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: 999999, amount: 1000 });
    expect(r.status).toBe(400);
  });
});
