// Recurring contribution plans (migration 081): set the monthly contribution
// once → the current period's cycle auto-opens (idempotently) with the plan's
// fine rule, and late accrual uses the CYCLE's own rule.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

let seq = 0;
async function welfareSetup(n = 2) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  for (let i = 0; i < n; i++) {
    seq++;
    await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
      .send({ first_name: `M${seq}`, last_name: "X", phone_number: `0798${String(100000 + seq).slice(-6)}`, id_number: `CP${seq}` });
  }
  return { t, admin, w };
}

describe("recurring contribution plans", () => {
  it("setting the plan auto-opens the current month's cycle with its fine rule (idempotent)", async () => {
    const { admin, w } = await welfareSetup(2);
    // Fines come from the Penalties module — make a rule, then point the plan at it.
    const rule = (await request(app).post(`/api/welfares/${w.id}/penalty-rules`).set("Authorization", auth(admin)).send({ trigger: "contribution_late", calc_type: "fixed", amount: 50 })).body.data;
    const put = await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin))
      .send({ name: "Monthly", amount: 1000, due_day: 10, grace_days: 3, penalty_rule_id: rule.id });
    expect(put.status).toBe(201);

    const list = await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin));
    expect(list.body.data).toHaveLength(1);
    const c = list.body.data[0];
    expect(Number(c.amount)).toBe(1000);
    expect(c.fine_calc_type).toBe("fixed");
    expect(Number(c.fine_amount)).toBe(50);
    expect(c.grace_days).toBe(3);
    expect(c.member_count).toBe(2);
    expect(c.plan_id).toBeTruthy();

    // Re-listing (which lazy-opens) must NOT create a duplicate.
    await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin));
    const again = await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin));
    expect(again.body.data).toHaveLength(1);
  });

  it("year overview returns all 12 months (opened + projected) and a per-member matrix", async () => {
    const { admin, w } = await welfareSetup(3);
    const p = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", amount: 1000, due_day: 10 })).body.data;
    const ov = await request(app).get(`/api/welfares/${w.id}/contribution-plans/${p.id}/overview`).set("Authorization", auth(admin));
    expect(ov.status).toBe(200);
    expect(ov.body.data.periods).toHaveLength(12);
    expect(ov.body.data.members).toHaveLength(3);
    expect(ov.body.data.members[0].cells).toHaveLength(12);
    const dec = ov.body.data.periods[11]; // projected with the plan's expected total
    expect(Number(dec.expected)).toBe(3000); // 1000 × 3 members
    expect(dec.short).toBe("Dec");
  });

  it("runs MULTIPLE named contributions at once — each drills into its own matrix", async () => {
    const { admin, w } = await welfareSetup(2);
    const mo = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", frequency: "monthly", amount: 1070, due_day: 10 })).body.data;
    const qt = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Quarterly", frequency: "quarterly", amount: 10000, due_day: 5 })).body.data;

    // Both stay active — creating one does NOT deactivate the other.
    const active = (await query(`SELECT name, frequency FROM contribution_plans WHERE welfare_id=$1 AND active=true ORDER BY id`, [w.id])).rows;
    expect(active).toHaveLength(2);

    const list = (await request(app).get(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin))).body.data;
    expect(list.plans.map((p) => p.name).sort()).toEqual(["Monthly", "Quarterly"]);

    const moOv = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${mo.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(moOv.periods).toHaveLength(12);
    const qtOv = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${qt.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(qtOv.periods).toHaveLength(4);
    expect(qtOv.periods.map((p) => p.short)).toEqual(["Q1", "Q2", "Q3", "Q4"]);

    // A second contribution with the SAME name is rejected.
    const dup = await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", amount: 500, due_day: 1 });
    expect(dup.status).toBe(409);
  });

  it("benefit pool: contributions feed their own ledger (not savings) and payouts disburse to a beneficiary", async () => {
    const { admin, w } = await welfareSetup(2);
    const plan = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin))
      .send({ name: "Welfare", frequency: "monthly", amount: 1000, due_day: 10, pool_kind: "benefit" })).body.data;
    expect(plan.pool_kind).toBe("benefit");

    const cycle = (await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin))).body.data[0];
    const sched = (await request(app).get(`/api/welfares/${w.id}/cycles/${cycle.id}`).set("Authorization", auth(admin))).body.data.schedules;
    await request(app).post(`/api/welfares/${w.id}/cycles/${cycle.id}/schedules/${sched[0].id}/pay`).set("Authorization", auth(admin)).send({});

    let ov = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${plan.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(ov.pool.kind).toBe("benefit");
    expect(Number(ov.pool.balance)).toBe(1000);
    // The contribution must NOT touch the savings pool.
    expect((await query(`SELECT COUNT(*)::int n FROM member_pool_transactions WHERE welfare_id=$1`, [w.id])).rows[0].n).toBe(0);
    expect((await query(`SELECT COUNT(*)::int n FROM benefit_pool_ledger WHERE welfare_id=$1`, [w.id])).rows[0].n).toBe(1);

    // Pay a lump sum to a beneficiary — pool drops, payout is listed.
    const payout = await request(app).post(`/api/welfares/${w.id}/contribution-plans/${plan.id}/payouts`).set("Authorization", auth(admin))
      .send({ beneficiary_member_id: sched[1].member_id, amount: 600 });
    expect(payout.status).toBe(201);
    ov = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${plan.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(Number(ov.pool.balance)).toBe(400);
    expect(ov.pool.payouts).toHaveLength(1);
    expect(Number(ov.pool.payouts[0].amount)).toBe(600);

    // A savings plan rejects payouts.
    const sav = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Savings", amount: 100, due_day: 1 })).body.data;
    const bad = await request(app).post(`/api/welfares/${w.id}/contribution-plans/${sav.id}/payouts`).set("Authorization", auth(admin)).send({ beneficiary_member_id: sched[0].member_id, amount: 10 });
    expect(bad.status).toBe(400);
  });

  it("weekly contribution enumerates ~52 periods", async () => {
    const { admin, w } = await welfareSetup(2);
    const p = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Weekly", frequency: "weekly", amount: 100, due_day: 3 })).body.data;
    const ov = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${p.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(ov.plan.frequency).toBe("weekly");
    expect(ov.periods.length).toBeGreaterThanOrEqual(51);
    expect(ov.periods[0].short).toMatch(/^W\d+$/);
  });

  it("cycle detail reports per-member timeliness (on time vs late by N days)", async () => {
    const { admin, w } = await welfareSetup(2);
    const created = await request(app).post(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin))
      .send({ name: "Drive", amount: 500, due_date: "2020-01-10", grace_days: 0 });
    const cycleId = created.body.data.id;
    const s0 = (await request(app).get(`/api/welfares/${w.id}/cycles/${cycleId}`).set("Authorization", auth(admin))).body.data.schedules;
    await request(app).post(`/api/welfares/${w.id}/cycles/${cycleId}/schedules/${s0[0].id}/pay`).set("Authorization", auth(admin)).send({});

    const detail = (await request(app).get(`/api/welfares/${w.id}/cycles/${cycleId}`).set("Authorization", auth(admin))).body.data.schedules;
    const paid = detail.find((s) => s.id === s0[0].id);
    const unpaid = detail.find((s) => s.id === s0[1].id);
    expect(paid.status).toBe("paid");
    expect(paid.paid_on_time).toBe(false); // due 2020, paid now → late
    expect(Number(paid.paid_late_days)).toBeGreaterThan(0);
    expect(Number(unpaid.days_overdue)).toBeGreaterThan(0); // unpaid & overdue
  });

  it("accrues late fines using the cycle's own rule (rule_id null), not a global one", async () => {
    const { t, admin, w } = await welfareSetup(2);
    const rule = (await request(app).post(`/api/welfares/${w.id}/penalty-rules`).set("Authorization", auth(admin)).send({ trigger: "contribution_late", calc_type: "fixed", amount: 75 })).body.data;
    await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin))
      .send({ name: "Monthly", amount: 1000, due_day: 10, grace_days: 0, penalty_rule_id: rule.id });
    const cycle = (await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin))).body.data[0];
    // Make it overdue.
    await query(`UPDATE contribution_schedules SET due_date='2020-01-01' WHERE cycle_id=$1`, [cycle.id]);

    const assess = await request(app).post(`/api/welfares/${w.id}/cycles/0/assess-late`).set("Authorization", auth(admin)).send({});
    expect(assess.status).toBe(200);
    const fines = (await query(`SELECT * FROM penalty_assessments WHERE tenant_id=$1 AND trigger='contribution_late'`, [t.id])).rows;
    expect(fines).toHaveLength(2);
    expect(Number(fines[0].amount)).toBe(75);
    expect(fines[0].rule_id).toBeNull(); // the cycle's own rule, not a penalty_rules row
  });
});
