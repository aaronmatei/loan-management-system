// Welfare SMS: broadcast, contribution-due reminders, meeting reminders, and the
// auto receipt/penalty notices. SMS_ENABLED is off in tests, so sendSMS no-ops
// but still logs — we assert on the sms_logs rows produced.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";

const PASS = "Welfare@2026xy";
afterAll(closePool);

let seq = 0;
async function bootstrap(memberCount = 2) {
  seq += 1;
  const signup = await request(app).post("/api/tenants/welfare-signup").send({
    welfare_name: "Umoja", subdomain: `umoja-sms-${seq}`,
    contact_name: "Jane", contact_email: `sms${seq}@x.example`, admin_password: PASS,
  });
  const adminAuth = `Bearer ${signup.body.token}`;
  const welfareId = signup.body.welfare_group_id;
  const tenantId = signup.body.user.tenant_id;
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const m = (await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: `M${i}`, last_name: "X", phone_number: `07000000${10 + i}` })).body.data;
    members.push(m);
  }
  return { welfareId, tenantId, adminAuth, members };
}
const logCount = async (tenantId, type) =>
  (await query(`SELECT COUNT(*)::int AS n FROM sms_logs WHERE tenant_id=$1 AND message_type=$2`, [tenantId, type])).rows[0].n;
// Auto receipt/penalty SMS are fire-and-forget; poll briefly for the log row.
async function waitForLog(tenantId, type, want) {
  for (let i = 0; i < 20; i++) {
    if ((await logCount(tenantId, type)) >= want) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("welfare SMS", () => {
  it("broadcasts to all active members with a phone", async () => {
    const { welfareId, tenantId, adminAuth } = await bootstrap(3);
    const res = await request(app).post(`/api/welfares/${welfareId}/sms/broadcast`).set("Authorization", adminAuth).send({ message: "Meeting moved to Saturday" });
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(3);
    expect(res.body.sent).toBe(3);
    expect(await logCount(tenantId, "welfare_broadcast")).toBe(3);
  });

  it("broadcasts to a selected subset", async () => {
    const { welfareId, adminAuth, members } = await bootstrap(3);
    const res = await request(app).post(`/api/welfares/${welfareId}/sms/broadcast`).set("Authorization", adminAuth).send({ message: "Hi", member_ids: [members[0].id] });
    expect(res.body.recipients).toBe(1);
  });

  it("rejects an empty broadcast", async () => {
    const { welfareId, adminAuth } = await bootstrap(1);
    const res = await request(app).post(`/api/welfares/${welfareId}/sms/broadcast`).set("Authorization", adminAuth).send({ message: "  " });
    expect(res.status).toBe(400);
  });

  it("sends contribution-due reminders for upcoming unpaid schedules, once a day", async () => {
    const { welfareId, tenantId, adminAuth } = await bootstrap(2);
    // A cycle due in 2 days (inside the default 3-day window).
    const due = new Date(); due.setDate(due.getDate() + 2);
    await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: due.toISOString().split("T")[0] });

    const r1 = await request(app).post(`/api/welfares/${welfareId}/sms/contribution-reminders`).set("Authorization", adminAuth).send({});
    expect(r1.status).toBe(200);
    expect(r1.body.sent).toBe(2);
    expect(await logCount(tenantId, "welfare_contribution_due")).toBe(2);

    // Re-run same day: deduped, no new sends.
    const r2 = await request(app).post(`/api/welfares/${welfareId}/sms/contribution-reminders`).set("Authorization", adminAuth).send({});
    expect(r2.body.sent).toBe(0);
    expect(await logCount(tenantId, "welfare_contribution_due")).toBe(2);
  });

  it("sends a meeting reminder to all active members", async () => {
    const { welfareId, tenantId, adminAuth } = await bootstrap(2);
    const meeting = (await request(app).post(`/api/welfares/${welfareId}/meetings`).set("Authorization", adminAuth).send({ meeting_date: "2026-07-15", location: "Hall A" })).body.data;
    const res = await request(app).post(`/api/welfares/${welfareId}/sms/meeting-reminder`).set("Authorization", adminAuth).send({ meeting_id: meeting.id });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(2);
    expect(await logCount(tenantId, "welfare_meeting_reminder")).toBe(2);
  });

  it("auto-sends a receipt when a contribution is recorded", async () => {
    const { welfareId, tenantId, adminAuth } = await bootstrap(1);
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const sched = (await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth)).body.data.schedules[0];
    await request(app).post(`/api/welfares/${welfareId}/cycles/${cycle.id}/schedules/${sched.id}/pay`).set("Authorization", adminAuth).send({});
    expect(await waitForLog(tenantId, "welfare_contribution_receipt", 1)).toBe(true);
  });

  it("auto-sends a penalty notice when a penalty is assessed", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(1);
    await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth).send({ member_id: members[0].id, amount: 200, description: "Late" });
    expect(await waitForLog(tenantId, "welfare_penalty_notice", 1)).toBe(true);
  });

  it("lists the welfare SMS log", async () => {
    const { welfareId, adminAuth } = await bootstrap(1);
    await request(app).post(`/api/welfares/${welfareId}/sms/broadcast`).set("Authorization", adminAuth).send({ message: "Hello" });
    const res = await request(app).get(`/api/welfares/${welfareId}/sms/logs`).set("Authorization", adminAuth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].message_type.startsWith("welfare_")).toBe(true);
  });

  it("blocks a loan_officer from broadcasting (admin/manager only)", async () => {
    const { welfareId, tenantId } = await bootstrap(1);
    const { createUser, tokenFor } = await import("./helpers/factory.js");
    const officer = await createUser(tenantId, { role: "loan_officer" });
    const res = await request(app).post(`/api/welfares/${welfareId}/sms/broadcast`).set("Authorization", `Bearer ${tokenFor(officer)}`).send({ message: "x" });
    expect(res.status).toBe(403);
  });
});
