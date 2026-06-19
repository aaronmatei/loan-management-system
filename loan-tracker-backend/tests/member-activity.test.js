// Member detail activity: contribution status, fines (with what they were for),
// and attendance score across meetings + events.
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
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
    .send({ first_name: "Asha", last_name: "K", phone_number: "0790000001" })).body.data;
  return { admin, w, m };
}

describe("member activity", () => {
  it("returns contribution status, fines with source, and attendance score", async () => {
    const { admin, w, m } = await setup();

    // An overdue one-off contribution with a 300 late fine, left unpaid → assessed.
    const cyc = (await request(app).post(`/api/welfares/${w.id}/cycles`).set("Authorization", auth(admin))
      .send({ name: "Building fund", amount: 1000, due_date: "2026-01-10", fine_calc_type: "fixed", fine_amount: 300 })).body.data;
    await request(app).post(`/api/welfares/${w.id}/cycles/0/assess-late`).set("Authorization", auth(admin)).send({});

    // A meeting with a late fine; mark the member late → fine + attendance.
    const meeting = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin))
      .send({ title: "AGM", meeting_date: "2026-02-01", fine_late: 200 })).body.data;
    await request(app).post(`/api/welfares/${w.id}/meetings/${meeting.id}/attendance`).set("Authorization", auth(admin))
      .send({ records: [{ member_id: m.id, status: "late" }] });

    const d = (await request(app).get(`/api/welfares/${w.id}/members/${m.id}/activity`).set("Authorization", auth(admin))).body.data;

    // Contributions
    expect(d.contributions.some((c) => c.cycle_name === "Building fund" && c.status !== "paid")).toBe(true);
    expect(d.contribution_summary.total).toBe(1);

    // Fines — one from the contribution, one from the meeting, each source-labelled.
    expect(d.fines).toHaveLength(2);
    const byKind = Object.fromEntries(d.fines.map((f) => [f.source_kind, f]));
    expect(Number(byKind.contribution.amount)).toBe(300);
    expect(byKind.contribution.source_label).toBe("Building fund");
    expect(Number(byKind.meeting.amount)).toBe(200);
    expect(byKind.meeting.source_label).toBe("AGM");
    expect(d.fines_outstanding).toBe(500);

    // Attendance — late counts as attended → 1/1 = 100%.
    expect(d.attendance.recorded).toBe(1);
    expect(d.attendance.attended).toBe(1);
    expect(d.attendance.rate).toBe(100);
  });
});
