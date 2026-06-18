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
    const put = await request(app).put(`/api/welfares/${w.id}/contribution-plan`).set("Authorization", auth(admin))
      .send({ amount: 1000, due_day: 10, grace_days: 3, fine_calc_type: "fixed", fine_amount: 50 });
    expect(put.status).toBe(200);

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
    await request(app).put(`/api/welfares/${w.id}/contribution-plan`).set("Authorization", auth(admin)).send({ amount: 1000, due_day: 10 });
    const ov = await request(app).get(`/api/welfares/${w.id}/contributions/overview`).set("Authorization", auth(admin));
    expect(ov.status).toBe(200);
    expect(ov.body.data.periods).toHaveLength(12);
    expect(ov.body.data.members).toHaveLength(3);
    expect(ov.body.data.members[0].cells).toHaveLength(12);
    const dec = ov.body.data.periods[11]; // projected with the plan's expected total
    expect(Number(dec.expected)).toBe(3000); // 1000 × 3 members
    expect(dec.short).toBe("Dec");
  });

  it("supports other frequencies — quarterly (4 periods) and weekly (~52), switching deactivates the prior plan", async () => {
    const { admin, w } = await welfareSetup(2);
    // Quarterly, due the 5th of the 3rd month.
    await request(app).put(`/api/welfares/${w.id}/contribution-plan`).set("Authorization", auth(admin)).send({ frequency: "quarterly", amount: 500, due_day: 5 });
    let ov = (await request(app).get(`/api/welfares/${w.id}/contributions/overview`).set("Authorization", auth(admin))).body.data;
    expect(ov.plan.frequency).toBe("quarterly");
    expect(ov.periods).toHaveLength(4);
    expect(ov.periods.map((p) => p.short)).toEqual(["Q1", "Q2", "Q3", "Q4"]);

    // Switch to weekly (Wednesday) — the quarterly plan is deactivated.
    await request(app).put(`/api/welfares/${w.id}/contribution-plan`).set("Authorization", auth(admin)).send({ frequency: "weekly", amount: 100, due_day: 3 });
    ov = (await request(app).get(`/api/welfares/${w.id}/contributions/overview`).set("Authorization", auth(admin))).body.data;
    expect(ov.plan.frequency).toBe("weekly");
    expect(ov.periods.length).toBeGreaterThanOrEqual(51);
    expect(ov.periods[0].short).toMatch(/^W\d+$/);
    // only one active plan
    const active = (await query(`SELECT frequency FROM contribution_plans WHERE welfare_id=$1 AND active=true`, [w.id])).rows;
    expect(active).toHaveLength(1);
    expect(active[0].frequency).toBe("weekly");
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
    await request(app).put(`/api/welfares/${w.id}/contribution-plan`).set("Authorization", auth(admin))
      .send({ amount: 1000, due_day: 10, grace_days: 0, fine_calc_type: "fixed", fine_amount: 75 });
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
