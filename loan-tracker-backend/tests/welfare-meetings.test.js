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
  it("a meeting's own rule fines late + absent; detail lists the fines and rule", async () => {
    const { admin, w, members } = await setup(3);
    const rule = (await request(app).post(`/api/welfares/${w.id}/penalty-rules`).set("Authorization", auth(admin))
      .send({ trigger: "attendance_late", calc_type: "fixed", amount: 500, notes: "Event attendance" })).body.data;
    const meeting = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))
      .send({ title: "Dowry hand-out", meeting_date: "2026-03-31", penalty_rule_id: rule.id })).body.data;
    expect(meeting.penalty_rule_id).toBe(rule.id);

    await request(app).post(`/api/welfares/${w.id}/meetings/${meeting.id}/attendance`).set("Authorization", auth(admin)).send({
      records: [
        { member_id: members[0].id, status: "present" },
        { member_id: members[1].id, status: "late" },
        { member_id: members[2].id, status: "absent" },
      ],
    });

    const detail = (await request(app).get(`/api/welfares/${w.id}/meetings/${meeting.id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.meeting.rule.id).toBe(rule.id);
    // The meeting's single rule applies to BOTH the late and the absent member.
    expect(detail.fines).toHaveLength(2);
    expect(detail.fines.every((f) => Number(f.amount) === 500)).toBe(true);
    expect(detail.fines.map((f) => f.trigger).sort()).toEqual(["attendance_absent", "attendance_late"]);
  });
});
