// Welfare dashboard + per-member reports: read-only aggregation over the pool,
// contributions, penalties, loans, dividends and attendance.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { closePool } from "./helpers/db.js";
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

describe("welfare reports", () => {
  it("summarises pool, members, contributions and surplus", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    const b = await addMember(admin, w, "B");
    await contribute(admin, w, a, 2000);
    await contribute(admin, w, b, 1000);
    // Penalty income → pool surplus.
    const pen = (await request(app).post(`/api/welfares/${w.id}/penalties`).set("Authorization", auth(admin)).send({ member_id: a.id, amount: 300 })).body.data;
    await request(app).post(`/api/welfares/${w.id}/penalties/${pen.id}/pay`).set("Authorization", auth(admin)).send({});

    const r = await request(app).get(`/api/welfares/${w.id}/reports/summary`).set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.members.active).toBe(2);
    expect(d.pool.total_contributions).toBe(3000);
    expect(d.pool.members_savings).toBe(3000);
    expect(d.pool.balance).toBe(3300); // 3000 contributions + 300 penalty
    expect(d.pool.surplus).toBe(300);
    expect(d.penalties.collected).toBe(300);
  });

  it("reflects an open cycle's contribution compliance", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    const b = await addMember(admin, w, "B");
    const cycle = (await request(app).post(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin)).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const sched = (await request(app).get(`/api/welfares/${w.id}/cycles/${cycle.id}`).set("Authorization", auth(admin))).body.data.schedules.find((s) => s.member_id === a.id);
    await request(app).post(`/api/welfares/${w.id}/cycles/${cycle.id}/schedules/${sched.id}/pay`).set("Authorization", auth(admin)).send({});

    const r = await request(app).get(`/api/welfares/${w.id}/reports/summary`).set("Authorization", auth(admin));
    expect(r.body.data.compliance.total).toBe(2);
    expect(r.body.data.compliance.paid).toBe(1);
    expect(r.body.data.compliance.paid_pct).toBe(50);
  });

  it("charts: pool growth, MONTHLY-only contributions, latest-cycle timeliness, savings per member", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await addMember(admin, w, "B");
    // A monthly plan auto-opens the current month's cycle; pay one member.
    await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", amount: 1000, due_day: 10 });
    const cyc = (await request(app).get(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin))).body.data[0];
    const sched = (await request(app).get(`/api/welfares/${w.id}/cycles/${cyc.id}`).set("Authorization", auth(admin))).body.data.schedules.find((s) => s.member_id === a.id);
    await request(app).post(`/api/welfares/${w.id}/cycles/${cyc.id}/schedules/${sched.id}/pay`).set("Authorization", auth(admin)).send({});

    const year = new Date().getFullYear();
    const r = await request(app).get(`/api/welfares/${w.id}/reports/charts?year=${year}`).set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(Array.isArray(d.pool_growth)).toBe(true);
    expect(d.contributions.some((x) => x.collected === 1000 && x.expected === 2000)).toBe(true);
    expect(d.cycle_breakdown.on_time + d.cycle_breakdown.late + d.cycle_breakdown.unpaid).toBe(2);
    expect(d.savings_per_member).toHaveLength(2);
    expect(d.savings_per_member[0].savings).toBe(1000); // sorted desc, the payer first
    expect(Array.isArray(d.fines)).toBe(true);
    expect(Array.isArray(d.attendance)).toBe(true);
  });

  it("builds per-member statement rows", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1500);

    const r = await request(app).get(`/api/welfares/${w.id}/reports/members`).set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    const row = r.body.data[0];
    expect(row.name).toBe("A M");
    expect(row.savings).toBe(1500);
    expect(row.contributions).toBe(1500);
    expect(row.loan_outstanding).toBe(0);
    expect(row.attendance_pct).toBe(null);
  });

  it("excludes inactive members unless include=all", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await addMember(admin, w, "B");
    await request(app).post(`/api/welfares/${w.id}/members/${a.id}/exit`).set("Authorization", auth(admin)).send({});

    const active = await request(app).get(`/api/welfares/${w.id}/reports/members`).set("Authorization", auth(admin));
    expect(active.body.data).toHaveLength(1);
    const all = await request(app).get(`/api/welfares/${w.id}/reports/members?include=all`).set("Authorization", auth(admin));
    expect(all.body.data).toHaveLength(2);
  });

  it("exports the member table as CSV", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1200);

    const r = await request(app).get(`/api/welfares/${w.id}/reports/members.csv`).set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.headers["content-disposition"]).toMatch(/attachment/);
    const lines = r.text.trim().split("\n");
    expect(lines[0]).toContain("Member No");
    expect(lines[1]).toContain("A M");
    expect(lines[1]).toContain("1200");
  });

  it("streams a group statement PDF", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 1000);
    const r = await request(app).get(`/api/welfares/${w.id}/reports/statement.pdf`).set("Authorization", auth(admin)).buffer(true).parse((res, cb) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("streams a per-member statement PDF", async () => {
    const { admin, w } = await setup();
    const a = await addMember(admin, w, "A");
    await contribute(admin, w, a, 800);
    const r = await request(app).get(`/api/welfares/${w.id}/reports/members/${a.id}/statement.pdf`).set("Authorization", auth(admin)).buffer(true).parse((res, cb) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
