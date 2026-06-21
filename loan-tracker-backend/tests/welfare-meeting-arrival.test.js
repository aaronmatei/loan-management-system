// Meeting start time + grace + per-member arrival time (migration 099). The
// admin records arrival times; the system marks late past start+grace, absent
// when no arrival is recorded, and excused (no fine) when an apology is logged.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const mk = async (fn, phone) => (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: fn, last_name: "K", phone_number: phone })).body.data;
  return { t, admin, w, mk };
}
const finesFor = (meetingId) =>
  query(`SELECT member_id, trigger, amount FROM penalty_assessments WHERE source_type='meeting' AND source_id=$1`, [meetingId]).then((r) => r.rows);

describe("meeting arrival times → auto attendance", () => {
  it("derives present/late from arrival vs start+grace; blank=absent; apology=excused (no fine)", async () => {
    const { admin, w, mk } = await setup();
    const a = await mk("Asha", "0795700101");   // arrives on time
    const b = await mk("Brian", "0795700102");  // arrives late
    const c = await mk("Cara", "0795700103");   // no-show, no apology → absent
    const d = await mk("Dan", "0795700104");    // no-show with apology → excused

    const mtg = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))
      .send({ title: "AGM", meeting_date: "2026-06-27", start_time: "10:00", grace_minutes: 15, fine_late: 200, fine_absent: 500 })).body.data;
    expect(mtg.start_time).toMatch(/^10:00/);
    expect(mtg.grace_minutes).toBe(15);

    await request(app).post(`/api/welfares/${w.id}/meetings/${mtg.id}/attendance`).set("Authorization", auth(admin)).send({
      records: [
        { member_id: a.id, arrival_time: "10:05" },           // within grace → present
        { member_id: b.id, arrival_time: "10:30" },           // past 10:15 → late
        { member_id: c.id },                                  // blank → absent
        { member_id: d.id, apology: true },                   // blank + apology → excused
      ],
    });

    const roster = (await request(app).get(`/api/welfares/${w.id}/meetings/${mtg.id}`).set("Authorization", auth(admin))).body.data.roster;
    const status = (id) => roster.find((r) => r.member_id === id).attendance_status;
    expect(status(a.id)).toBe("present");
    expect(status(b.id)).toBe("late");
    expect(status(c.id)).toBe("absent");
    expect(status(d.id)).toBe("excused");

    const fines = await finesFor(mtg.id);
    expect(fines.find((f) => f.member_id === b.id)).toMatchObject({ trigger: "attendance_late", amount: "200" });
    expect(fines.find((f) => f.member_id === c.id)).toMatchObject({ trigger: "attendance_absent", amount: "500" });
    expect(fines.find((f) => f.member_id === a.id)).toBeUndefined();  // present → no fine
    expect(fines.find((f) => f.member_id === d.id)).toBeUndefined();  // excused → no fine
  });

  it("with no scheduled start time, any recorded arrival counts as present", async () => {
    const { admin, w, mk } = await setup();
    const a = await mk("Asha", "0795700201");
    const mtg = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))
      .send({ title: "Informal", meeting_date: "2026-06-27", fine_late: 200 })).body.data;
    await request(app).post(`/api/welfares/${w.id}/meetings/${mtg.id}/attendance`).set("Authorization", auth(admin))
      .send({ records: [{ member_id: a.id, arrival_time: "23:59" }] });
    const roster = (await request(app).get(`/api/welfares/${w.id}/meetings/${mtg.id}`).set("Authorization", auth(admin))).body.data.roster;
    expect(roster.find((r) => r.member_id === a.id).attendance_status).toBe("present");
  });
});
