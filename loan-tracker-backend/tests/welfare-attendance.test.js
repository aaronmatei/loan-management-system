// Welfare meetings + member attendance, and the attendance penalties it drives.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";

const PASS = "Welfare@2026xy";
afterAll(closePool);

let seq = 0;
async function bootstrap() {
  seq += 1;
  const signup = await request(app).post("/api/tenants/welfare-signup").send({
    welfare_name: "Umoja", subdomain: `umoja-att-${seq}`,
    contact_name: "Jane", contact_email: `att${seq}@x.example`, admin_password: PASS,
  });
  const adminAuth = `Bearer ${signup.body.token}`;
  const welfareId = signup.body.welfare_group_id;
  const tenantId = signup.body.user.tenant_id;
  const A = (await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: "A", last_name: "M" })).body.data;
  const B = (await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: "B", last_name: "M" })).body.data;
  return { welfareId, tenantId, adminAuth, A, B };
}

describe("welfare meetings + attendance penalties", () => {
  it("records attendance over members and rolls up a summary", async () => {
    const { welfareId, adminAuth, A, B } = await bootstrap();
    const meeting = (await request(app).post(`/api/welfares/${welfareId}/meetings`).set("Authorization", adminAuth).send({ meeting_date: "2026-06-01", location: "Hall" })).body.data;

    const detail = await request(app).get(`/api/welfares/${welfareId}/meetings/${meeting.id}`).set("Authorization", adminAuth);
    expect(detail.body.data.roster).toHaveLength(2);
    expect(detail.body.data.roster[0].attendance_status).toBeNull();

    const rec = await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth)
      .send({ records: [{ member_id: A.id, status: "present" }, { member_id: B.id, status: "absent" }] });
    expect(rec.status).toBe(200);

    const list = await request(app).get(`/api/welfares/${welfareId}/meetings`).set("Authorization", adminAuth);
    expect(list.body.data[0].status).toBe("held");
    expect(Number(list.body.data[0].present_count)).toBe(1);

    const sum = await request(app).get(`/api/welfares/${welfareId}/attendance-summary`).set("Authorization", adminAuth);
    expect(sum.body.data.held_meetings).toBe(1);
    const byMember = Object.fromEntries(sum.body.data.members.map((m) => [m.member_id, m]));
    expect(byMember[A.id].rate).toBe(100);
    expect(byMember[B.id].rate).toBe(0);
  });

  it("auto-assesses absent/late penalties and clears them when status changes", async () => {
    const { welfareId, tenantId, adminAuth, A } = await bootstrap();
    // Fines are defined ON the meeting now (absent 500, late 200).
    const meeting = (await request(app).post(`/api/welfares/${welfareId}/meetings`).set("Authorization", adminAuth).send({ meeting_date: "2026-06-08", fine_absent: 500, fine_late: 200 })).body.data;

    // A absent → 500 penalty.
    await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth)
      .send({ records: [{ member_id: A.id, status: "absent" }] });
    let pen = (await query("SELECT * FROM penalty_assessments WHERE tenant_id=$1", [tenantId])).rows;
    expect(pen).toHaveLength(1);
    expect(Number(pen[0].amount)).toBe(500);
    expect(pen[0].trigger).toBe("attendance_absent");

    // Re-record A as late → absent penalty cleared, late (200) applied.
    await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth)
      .send({ records: [{ member_id: A.id, status: "late" }] });
    pen = (await query("SELECT * FROM penalty_assessments WHERE tenant_id=$1 AND status='outstanding'", [tenantId])).rows;
    expect(pen).toHaveLength(1);
    expect(Number(pen[0].amount)).toBe(200);
    expect(pen[0].trigger).toBe("attendance_late");

    // Re-record A as present → no outstanding attendance penalty.
    await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth)
      .send({ records: [{ member_id: A.id, status: "present" }] });
    pen = (await query("SELECT * FROM penalty_assessments WHERE tenant_id=$1 AND status='outstanding'", [tenantId])).rows;
    expect(pen).toHaveLength(0);
  });

  it("reverses (and refunds) a PAID attendance penalty when status is changed to present", async () => {
    const { welfareId, tenantId, adminAuth, A } = await bootstrap();
    const meeting = (await request(app).post(`/api/welfares/${welfareId}/meetings`).set("Authorization", adminAuth).send({ meeting_date: "2026-06-15", fine_absent: 500 })).body.data;
    await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth).send({ records: [{ member_id: A.id, status: "absent" }] });
    const a = (await query("SELECT id FROM penalty_assessments WHERE tenant_id=$1", [tenantId])).rows[0];
    // Pay it → status 'paid' and the cash grows the pool by 500.
    await request(app).post(`/api/welfares/${welfareId}/penalties/${a.id}/pay`).set("Authorization", adminAuth).send({});
    expect((await query("SELECT status, paid_amount FROM penalty_assessments WHERE id=$1", [a.id])).rows[0].status).toBe("paid");
    const poolAfterPay = (await query("SELECT COALESCE(SUM(direction*amount),0) AS v FROM member_pool_transactions WHERE tenant_id=$1 AND type='penalty'", [tenantId])).rows[0].v;
    expect(Number(poolAfterPay)).toBe(500);

    // Change status to present — the paid fine is reversed and refunded.
    await request(app).post(`/api/welfares/${welfareId}/meetings/${meeting.id}/attendance`).set("Authorization", adminAuth).send({ records: [{ member_id: A.id, status: "present" }] });
    const after = (await query("SELECT status, paid_amount FROM penalty_assessments WHERE id=$1", [a.id])).rows[0];
    expect(after.status).toBe("reversed");
    expect(Number(after.paid_amount)).toBe(0);
    // No outstanding/paid attendance fine remains.
    expect((await query("SELECT COUNT(*)::int AS n FROM penalty_assessments WHERE tenant_id=$1 AND status IN ('outstanding','paid')", [tenantId])).rows[0].n).toBe(0);
    // The pool penalty income nets back to zero (refund posted).
    const poolAfterReverse = (await query("SELECT COALESCE(SUM(direction*amount),0) AS v FROM member_pool_transactions WHERE tenant_id=$1 AND type='penalty'", [tenantId])).rows[0].v;
    expect(Number(poolAfterReverse)).toBe(0);
  });
});
