// Meetings/events: a meeting picks its own attendance fine rule (applied to late
// AND absent), and its detail surfaces the fines it raised.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup(n = 2) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const members = [];
  for (let i = 0; i < n; i++) {
    members.push((await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
      .send({ first_name: `M${i}`, last_name: "X", phone_number: `0790${i}00000` })).body.data);
  }
  return { admin, w, members };
}

describe("welfare meetings — per-meeting attendance fine", () => {
  it("a benefit payout's gathering creates a linked meeting (with fines) under Meetings", async () => {
    const { admin, w, members } = await setup(2);
    const plan = (await request(app).post(`/api/welfares/${w.id}/contribution-plans`).set("Authorization", auth(admin))
      .send({ name: "Welfare", frequency: "monthly", amount: 1000, due_day: 10, pool_kind: "benefit" })).body.data;
    const payout = await request(app).post(`/api/welfares/${w.id}/contribution-plans/${plan.id}/payouts`).set("Authorization", auth(admin))
      .send({ beneficiary_member_id: members[0].id, amount: 300, gathering_title: "Hand-out — M0", gathering_date: "2026-03-15", gathering_fine_late: 500, gathering_fine_absent: 1000 });
    expect(payout.status).toBe(201);
    expect(payout.body.data.meeting_id).toBeTruthy();

    const mtg = (await request(app).get(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))).body.data.find((m) => m.title === "Hand-out — M0");
    expect(mtg).toBeTruthy();
    expect(Number(mtg.fine_late)).toBe(500);
    expect(Number(mtg.fine_absent)).toBe(1000);
    // The pool's payout is linked to it.
    const ov = (await request(app).get(`/api/welfares/${w.id}/contribution-plans/${plan.id}/overview`).set("Authorization", auth(admin))).body.data;
    expect(ov.pool.payouts[0].meeting_id).toBe(mtg.id);
  });

  it("a meeting carries DISTINCT late + absent fines; detail lists them per member", async () => {
    const { admin, w, members } = await setup(3);
    // Fines are defined ON the meeting: late 500, absent 1500.
    const meeting = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))
      .send({ title: "Utawala Meeting", meeting_date: "2026-03-31", fine_late: 500, fine_absent: 1500 })).body.data;
    expect(Number(meeting.fine_late)).toBe(500);
    expect(Number(meeting.fine_absent)).toBe(1500);

    await request(app).post(`/api/welfares/${w.id}/meetings/${meeting.id}/attendance`).set("Authorization", auth(admin)).send({
      records: [
        { member_id: members[0].id, status: "present" },
        { member_id: members[1].id, status: "late" },
        { member_id: members[2].id, status: "absent" },
      ],
    });

    const detail = (await request(app).get(`/api/welfares/${w.id}/meetings/${meeting.id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.fines).toHaveLength(2);
    const late = detail.fines.find((f) => f.trigger === "attendance_late");
    const absent = detail.fines.find((f) => f.trigger === "attendance_absent");
    expect(Number(late.amount)).toBe(500);
    expect(Number(absent.amount)).toBe(1500);

    // Re-marking the absent member present clears their fine.
    await request(app).post(`/api/welfares/${w.id}/meetings/${meeting.id}/attendance`).set("Authorization", auth(admin))
      .send({ records: [{ member_id: members[2].id, status: "present" }] });
    const after = (await request(app).get(`/api/welfares/${w.id}/meetings/${meeting.id}`).set("Authorization", auth(admin))).body.data;
    expect(after.fines).toHaveLength(1);
  });
});
