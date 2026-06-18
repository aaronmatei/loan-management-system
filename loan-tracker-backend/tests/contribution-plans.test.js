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
