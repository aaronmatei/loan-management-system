// Welfare contribution cycles: opening a cycle generates per-member schedules;
// payments allocate against them and grow the pool/savings; overdue schedules
// drive contribution_late penalties (idempotent accrual).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { welfareSignup } from "./helpers/factory.js";
import { query, closePool } from "./helpers/db.js";
import { createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const PASS = "Welfare@2026xy";
afterAll(closePool);

let seq = 0;
async function bootstrap(memberNames = ["A", "B"]) {
  seq += 1;
  const signup = await welfareSignup({
    welfare_name: "Umoja", subdomain: `umoja-cyc-${seq}`,
    contact_name: "Jane", contact_email: `cyc${seq}@x.example`, admin_password: PASS,
  });
  const adminAuth = `Bearer ${signup.body.token}`;
  const welfareId = signup.body.welfare_group_id;
  const tenantId = signup.body.user.tenant_id;
  const members = [];
  for (const n of memberNames) {
    const m = (await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: n, last_name: "M" })).body.data;
    members.push(m);
  }
  return { welfareId, tenantId, adminAuth, members };
}

describe("welfare contribution cycles", () => {
  it("opens a cycle with a schedule per active member", async () => {
    const { welfareId, adminAuth } = await bootstrap(["A", "B", "C"]);
    const res = await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth)
      .send({ name: "July", amount: 1000, due_date: "2026-07-31" });
    expect(res.status).toBe(201);
    expect(res.body.data.member_count).toBe(3);

    const list = await request(app).get(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth);
    expect(list.body.data[0].expected).toBe(3000);
    expect(list.body.data[0].collected).toBe(0);
    expect(list.body.data[0].paid_count).toBe(0);
  });

  it("records a contribution against a schedule (pool + savings grow)", async () => {
    const { welfareId, adminAuth, members } = await bootstrap(["A", "B"]);
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const detail = await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth);
    const sched = detail.body.data.schedules.find((s) => s.member_id === members[0].id);

    const pay = await request(app)
      .post(`/api/welfares/${welfareId}/cycles/${cycle.id}/schedules/${sched.id}/pay`)
      .set("Authorization", adminAuth).send({}); // full
    expect(pay.status).toBe(200);
    expect(pay.body.status).toBe("paid");
    expect(pay.body.pool_balance).toBe(1000);

    // The member's savings reflect the contribution.
    const mem = await request(app).get(`/api/welfares/${welfareId}/members/${members[0].id}`).set("Authorization", adminAuth);
    expect(mem.body.data.savings_balance).toBe(1000);

    // Cycle rollup updated.
    const list = await request(app).get(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth);
    expect(list.body.data[0].collected).toBe(1000);
    expect(list.body.data[0].paid_count).toBe(1);
  });

  it("supports partial payment", async () => {
    const { welfareId, adminAuth, members } = await bootstrap(["A"]);
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const detail = await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth);
    const sched = detail.body.data.schedules[0];
    const pay = await request(app).post(`/api/welfares/${welfareId}/cycles/${cycle.id}/schedules/${sched.id}/pay`).set("Authorization", adminAuth).send({ amount: 400 });
    expect(pay.body.status).toBe("partial");
    expect(pay.body.outstanding).toBe(600);
  });

  it("accrues contribution_late penalties for overdue schedules, idempotently", async () => {
    const { welfareId, tenantId, adminAuth } = await bootstrap(["A", "B"]);
    // A cycle already past due, with its own inline daily-fixed late fine.
    await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth)
      .send({ amount: 1000, due_date: "2026-01-01", fine_calc_type: "daily_fixed", fine_amount: 50 });

    const run1 = await request(app).post(`/api/welfares/${welfareId}/cycles/0/assess-late`).set("Authorization", adminAuth).send({});
    expect(run1.status).toBe(200);
    expect(run1.body.assessed).toBe(2); // both members overdue

    const after1 = (await query("SELECT COUNT(*)::int AS n FROM penalty_assessments WHERE tenant_id=$1", [tenantId])).rows[0].n;
    expect(after1).toBe(2);

    // Re-run: no new rows (updates the same daily assessments).
    await request(app).post(`/api/welfares/${welfareId}/cycles/0/assess-late`).set("Authorization", adminAuth).send({});
    const after2 = (await query("SELECT COUNT(*)::int AS n FROM penalty_assessments WHERE tenant_id=$1", [tenantId])).rows[0].n;
    expect(after2).toBe(2);

    // Schedules flagged overdue.
    const overdue = (await query("SELECT COUNT(*)::int AS n FROM contribution_schedules WHERE tenant_id=$1 AND status='overdue'", [tenantId])).rows[0].n;
    expect(overdue).toBe(2);
  });

  it("blocks a loan_officer from opening a cycle (admin/manager only)", async () => {
    const { welfareId, tenantId } = await bootstrap(["A"]);
    const officer = await createUser(tenantId, { role: "loan_officer" });
    const res = await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", auth(officer)).send({ amount: 1000, due_date: "2026-12-31" });
    expect(res.status).toBe(403);
  });
});
