// Phase B — the welfare member self-service read API (/api/welfare/member/*).
// A member sees only their own data; a borrower (lender tenant) hitting these
// routes gets a clean 403 from resolveMember.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

// A tenant-scoped customer token (skips the login/select-tenant dance covered in
// the invite test).
const customerToken = (pcId, tenantId) =>
  "Bearer " +
  jwt.sign(
    { platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

async function makeMember(admin, welfareId, over = {}) {
  return (
    await request(app)
      .post(`/api/welfares/${welfareId}/members`)
      .set("Authorization", auth(admin))
      .send({ first_name: "Jane", last_name: "Doe", phone_number: over.phone || "0795200111", id_number: over.id || "MBR1", ...over })
  ).body.data;
}
async function invite(admin, welfareId, memberId) {
  await request(app).post(`/api/welfares/${welfareId}/members/${memberId}/invite`).set("Authorization", auth(admin));
}
async function pcIdByPhone(phone) {
  return (await query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone])).rows[0].id;
}

async function welfareSetup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind = 'welfare' WHERE id = $1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  return { tenant: t, admin, welfare: w };
}

describe("member portal read API", () => {
  it("returns the member's own overview, ledger, loans", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200111", id: "MBRA1" });
    await invite(admin, welfare.id, m.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/loans`).set("Authorization", auth(admin)).send({ principal: 20000, interest_rate: 12, duration_months: 6 });

    const tok = customerToken(await pcIdByPhone("+254795200111"), tenant.id);

    const ov = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov.status).toBe(200);
    expect(Number(ov.body.data.savings_balance)).toBe(50000);
    expect(ov.body.data.welfare.name).toBe("Umoja");
    expect(ov.body.data.loans.active).toBe(1);
    expect(Number(ov.body.data.loans.outstanding)).toBe(21200);

    const loans = await request(app).get("/api/welfare/member/loans").set("Authorization", tok);
    expect(loans.body.data).toHaveLength(1);
    expect(loans.body.data[0].loan_code).toMatch(/^MBL-/);

    const led = await request(app).get("/api/welfare/member/ledger").set("Authorization", tok);
    expect(led.body.data.transactions.some((x) => x.type === "contribution")).toBe(true);
  });

  it("surfaces compliance %, attendance %, and a self statement PDF", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200401", id: "STMT1" });
    await invite(admin, welfare.id, m.id);
    // A monthly contribution, paid → compliance 100%.
    await request(app).post(`/api/welfares/${welfare.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", amount: 1000, due_day: 10 });
    const cyc = (await request(app).get(`/api/welfares/${welfare.id}/cycles`).set("Authorization", auth(admin))).body.data.find((x) => x.frequency === "monthly");
    const sched = (await request(app).get(`/api/welfares/${welfare.id}/cycles/${cyc.id}`).set("Authorization", auth(admin))).body.data.schedules.find((s) => s.member_id === m.id);
    await request(app).post(`/api/welfares/${welfare.id}/cycles/${cyc.id}/schedules/${sched.id}/pay`).set("Authorization", auth(admin)).send({});
    // A held meeting with the member present → attendance 100%.
    const mtg = (await request(app).post(`/api/welfares/${welfare.id}/meetings`).set("Authorization", auth(admin)).send({ title: "AGM", meeting_date: "2026-03-01" })).body.data;
    await request(app).post(`/api/welfares/${welfare.id}/meetings/${mtg.id}/attendance`).set("Authorization", auth(admin)).send({ records: [{ member_id: m.id, status: "present" }] });

    const tok = customerToken(await pcIdByPhone("+254795200401"), tenant.id);
    const ov = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov.body.data.compliance_pct).toBe(100);
    expect(ov.body.data.attendance_pct).toBe(100);

    const pdf = await request(app).get("/api/welfare/member/statement.pdf").set("Authorization", tok).buffer(true).parse((res, cb) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => cb(null, Buffer.concat(c)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("a member sees the same group dashboard + charts the admin sees", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200601", id: "DSH1" });
    await invite(admin, welfare.id, m.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 5000 });

    const tok = customerToken(await pcIdByPhone("+254795200601"), tenant.id);
    const dash = await request(app).get("/api/welfare/member/dashboard").set("Authorization", tok);
    expect(dash.status).toBe(200);
    expect(dash.body.data.pool.balance).toBe(5000);
    expect(dash.body.data.members.active).toBe(1);

    const charts = await request(app).get("/api/welfare/member/charts").set("Authorization", tok);
    expect(charts.status).toBe(200);
    expect(Array.isArray(charts.body.data.pool_growth)).toBe(true);

    // ...and every member's standing (the admin Reports table).
    const grp = await request(app).get("/api/welfare/member/group-members").set("Authorization", tok);
    expect(grp.status).toBe(200);
    expect(grp.body.data).toHaveLength(1);
    expect(Number(grp.body.data[0].savings)).toBe(5000);

    // ...plus read-only group activity (loans / expenses / cycles).
    for (const p of ["group-loans", "group-cycles"]) {
      const r = await request(app).get(`/api/welfare/member/${p}`).set("Authorization", tok);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
    }
    const exp = await request(app).get("/api/welfare/member/group-expenses").set("Authorization", tok);
    expect(exp.status).toBe(200);
    expect(Array.isArray(exp.body.data.expenses)).toBe(true);
  });

  it("projects the member's dividend share from the surplus", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200501", id: "DVP1" });
    await invite(admin, welfare.id, m.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 10000 });
    // A paid penalty grows the pool above savings → distributable surplus.
    const pen = (await request(app).post(`/api/welfares/${welfare.id}/penalties`).set("Authorization", auth(admin)).send({ member_id: m.id, amount: 500 })).body.data;
    await request(app).post(`/api/welfares/${welfare.id}/penalties/${pen.id}/pay`).set("Authorization", auth(admin)).send({});

    const tok = customerToken(await pcIdByPhone("+254795200501"), tenant.id);
    const p = await request(app).get("/api/welfare/member/dividends-projection").set("Authorization", tok);
    expect(p.status).toBe(200);
    expect(p.body.data.surplus).toBe(500);
    expect(p.body.data.projected.equal).toBe(500); // sole active member
    expect(p.body.data.projected.savings).toBe(500);
  });

  it("isolates members — one member can't see another's loans", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const a = await makeMember(admin, welfare.id, { phone: "0795200201", id: "ISOA" });
    const b = await makeMember(admin, welfare.id, { phone: "0795200202", id: "ISOB" });
    await invite(admin, welfare.id, a.id);
    await invite(admin, welfare.id, b.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 30000 });
    await request(app).post(`/api/welfares/${welfare.id}/members/${a.id}/loans`).set("Authorization", auth(admin)).send({ principal: 10000, interest_rate: 10, duration_months: 3 });

    const tokB = customerToken(await pcIdByPhone("+254795200202"), tenant.id);
    const loansB = await request(app).get("/api/welfare/member/loans").set("Authorization", tokB);
    expect(loansB.body.data).toHaveLength(0);
    const ovB = await request(app).get("/api/welfare/member/overview").set("Authorization", tokB);
    expect(Number(ovB.body.data.savings_balance)).toBe(0);
  });

  it("a member reads the chama's contributions, plan overview and cycle (read-only)", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200701", id: "CON1" });
    await invite(admin, welfare.id, m.id);
    const plan = (await request(app).post(`/api/welfares/${welfare.id}/contribution-plans`).set("Authorization", auth(admin)).send({ name: "Monthly", amount: 1000, frequency: "monthly", due_day: 10 })).body.data;
    const tok = customerToken(await pcIdByPhone("+254795200701"), tenant.id);

    const list = await request(app).get("/api/welfare/member/contrib/contribution-plans").set("Authorization", tok);
    expect(list.status).toBe(200);
    expect(list.body.data.plans.some((p) => p.name === "Monthly")).toBe(true);

    const ov = await request(app).get(`/api/welfare/member/contrib/contribution-plans/${plan.id}/overview`).set("Authorization", tok);
    expect(ov.status).toBe(200);
    expect(ov.body.data.plan.name).toBe("Monthly");
  });

  it("a member views a meeting's attendance roster", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200801", id: "MTG1" });
    await invite(admin, welfare.id, m.id);
    const mtg = (await request(app).post(`/api/welfares/${welfare.id}/meetings`).set("Authorization", auth(admin)).send({ title: "AGM", meeting_date: "2026-06-27" })).body.data;
    await request(app).post(`/api/welfares/${welfare.id}/meetings/${mtg.id}/attendance`).set("Authorization", auth(admin)).send({ records: [{ member_id: m.id, arrival_time: "10:00" }] });
    const tok = customerToken(await pcIdByPhone("+254795200801"), tenant.id);

    const r = await request(app).get(`/api/welfare/member/meetings/${mtg.id}`).set("Authorization", tok);
    expect(r.status).toBe(200);
    expect(r.body.data.roster.find((x) => x.member_id === m.id).attendance_status).toBe("present");
  });

  it("403s a borrower (non-member) hitting member routes", async () => {
    const { admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200311", id: "BRW1" });
    await invite(admin, welfare.id, m.id);
    const pcId = await pcIdByPhone("+254795200311");

    // Link the SAME person to a lender tenant as a borrower (client_id), then
    // select that tenant — they are not a member there.
    const lender = await createTenant();
    const client = await createClient(lender.id);
    await query(
      "INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status) VALUES ($1,$2,$3,'active')",
      [pcId, lender.id, client.id],
    );
    const tok = customerToken(pcId, lender.id);
    const res = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(res.status).toBe(403);
  });
});
