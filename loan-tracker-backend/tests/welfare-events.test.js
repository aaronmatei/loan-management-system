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

  it("bridges the shortfall from the savings pool, then repays once members refill the events pool", async () => {
    const { admin, w, members } = await welfareSetup(3);
    const [m1, m2, m3] = members;
    // Seed the savings pool with cash (a member's contribution).
    await query(
      `INSERT INTO member_pool_transactions (tenant_id, welfare_id, member_id, type, amount, direction, balance_after)
       SELECT tenant_id, id, $2, 'contribution', 10000, 1, 10000 FROM groups WHERE id=$1`,
      [w.id, m1.id],
    );

    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: m1.id, amount: 3000, title: "Urgent" });
    const eventId = created.body.data.id;

    const funded = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "bridge" });
    expect(funded.status).toBe(200);
    expect(funded.body.data.event.status).toBe("disbursed");
    expect(Number(funded.body.data.event.bridged_amount)).toBe(3000);
    expect(Number(funded.body.data.savingsPoolBalance)).toBeCloseTo(7000, 2); // 10000 - 3000
    expect(Number(funded.body.data.eventsPoolBalance)).toBeCloseTo(0, 2);

    // Members refill the events pool (shares of 3000 split three ways).
    for (const m of [m1, m2, m3]) {
      await request(app).post(`/api/welfares/${w.id}/events/${eventId}/shares/${m.id}/pay`).set("Authorization", auth(admin)).send({});
    }
    const repay = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/repay-bridge`).set("Authorization", auth(admin)).send({});
    expect(repay.status).toBe(200);
    expect(Number(repay.body.data.event.bridge_repaid)).toBe(3000);
    expect(repay.body.data.event.status).toBe("settled");
    expect(Number(repay.body.data.savingsPoolBalance)).toBeCloseTo(10000, 2); // restored
    expect(Number(repay.body.data.eventsPoolBalance)).toBeCloseTo(0, 2);

    // The bridge never touched anyone's savings equity.
    expect(await memberSavings(m1.id)).toBe(10000);
  });

  it("won't bridge more than the savings pool holds", async () => {
    const { admin, w, members } = await welfareSetup(2);
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: members[0].id, amount: 3000 });
    const funded = await request(app).post(`/api/welfares/${w.id}/events/${created.body.data.id}/fund`).set("Authorization", auth(admin)).send({ mode: "bridge" });
    expect(funded.status).toBe(400); // empty savings pool
  });

  it("accrues event_late fines on overdue unpaid shares", async () => {
    const { t, admin, w, members } = await welfareSetup(2);
    await query(`INSERT INTO penalty_rules (tenant_id, trigger, calc_type, amount, active) VALUES ($1,'event_late','fixed',100,true)`, [t.id]);
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: members[0].id, amount: 2000 });
    const eventId = created.body.data.id;
    await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "collect" });
    await query(`UPDATE welfare_events SET due_date='2020-01-01' WHERE id=$1`, [eventId]); // simulate the deadline having passed

    const assess = await request(app).post(`/api/welfares/${w.id}/events/assess-late`).set("Authorization", auth(admin)).send({});
    expect(assess.status).toBe(200);
    expect(assess.body.data.assessed).toBe(2); // both members' shares
    const fines = (await query(`SELECT * FROM penalty_assessments WHERE tenant_id=$1 AND trigger='event_late'`, [t.id])).rows;
    expect(fines).toHaveLength(2);
    expect(Number(fines[0].amount)).toBe(100);
  });

  it("recovers an unpaid share from the member's savings", async () => {
    const { admin, w, members } = await welfareSetup(2);
    const [m1, m2] = members;
    await query(
      `INSERT INTO member_pool_transactions (tenant_id, welfare_id, member_id, type, amount, direction, balance_after)
       SELECT tenant_id, id, $2, 'contribution', 5000, 1, 5000 FROM groups WHERE id=$1`,
      [w.id, m2.id],
    );
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: m1.id, amount: 2000 });
    const eventId = created.body.data.id;
    await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "collect" }); // 1000 each

    const rec = await request(app).post(`/api/welfares/${w.id}/events/${eventId}/shares/${m2.id}/recover`).set("Authorization", auth(admin)).send({});
    expect(rec.status).toBe(200);
    expect(Number(rec.body.data.recovered)).toBe(1000);
    expect(Number(rec.body.data.memberSavings)).toBe(4000); // 5000 - 1000
    expect(rec.body.data.share.status).toBe("paid");
    expect(Number(rec.body.data.eventsPoolBalance)).toBe(1000);
  });

  it("M-Pesa callback allocates an event-share payment into the events pool, not savings", async () => {
    const { t, admin, w, members } = await welfareSetup(2);
    const [m1] = members;
    const created = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: m1.id, amount: 2000 });
    const eventId = created.body.data.id;
    await request(app).post(`/api/welfares/${w.id}/events/${eventId}/fund`).set("Authorization", auth(admin)).send({ mode: "collect" });
    const detail = await request(app).get(`/api/welfares/${w.id}/events/${eventId}`).set("Authorization", auth(admin));
    const share = detail.body.data.shares.find((s) => s.member_id === m1.id);

    const { allocateWelfarePayment } = await import("../src/services/welfareMpesaService.js");
    const r = await allocateWelfarePayment({
      id: 0, tenant_id: t.id, welfare_id: w.id, member_id: m1.id,
      target_type: "welfare_event_share", target_id: share.id, amount: Number(share.amount_due),
      allocated: false, mpesa_receipt_number: "TESTRCT",
    });
    expect(r.applied).toBe(true);

    const after = (await query("SELECT status FROM welfare_event_shares WHERE id=$1", [share.id])).rows[0];
    expect(after.status).toBe("paid");
    const pool = (await query("SELECT balance_after FROM welfare_event_ledger WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1", [w.id])).rows[0];
    expect(Number(pool.balance_after)).toBeCloseTo(Number(share.amount_due), 2);
    expect(await memberSavings(m1.id)).toBe(0); // never touched savings
  });

  it("rejects past dates and a deadline after the date needed", async () => {
    const { admin, w, members } = await welfareSetup(1);
    const body = { beneficiary_member_id: members[0].id, amount: 1000 };
    const past = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ ...body, needed_by: "2020-01-01" });
    expect(past.status).toBe(400);
    const order = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ ...body, needed_by: "2090-01-01", due_date: "2090-02-01" });
    expect(order.status).toBe(400); // deadline after needed
    const ok = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ ...body, needed_by: "2090-02-01", due_date: "2090-01-01" });
    expect(ok.status).toBe(201);
  });

  it("rejects an event whose beneficiary isn't an active member of the welfare", async () => {
    const { admin, w } = await welfareSetup(1);
    const r = await request(app).post(`/api/welfares/${w.id}/events`).set("Authorization", auth(admin)).send({ beneficiary_member_id: 999999, amount: 1000 });
    expect(r.status).toBe(400);
  });
});
