// The per-welfare master "Loans" switch (welfare_settings.loans_enabled, mig 095):
// default OFF, exposed on /welfare/current + member /overview, and gating loan
// WRITES (create application / request) with 403 when off.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

const customerToken = (pcId, tenantId) =>
  "Bearer " + jwt.sign({ platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null }, process.env.JWT_SECRET, { expiresIn: "1h" });
const pcIdByPhone = (phone) => query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone]).then((r) => r.rows[0].id);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0795300111", id_number: "LSW1" })).body.data;
  return { t, admin, w, m };
}

describe("welfare master Loans switch", () => {
  it("defaults OFF and gates new-loan writes with 403, then allows when on", async () => {
    const { admin, w, m } = await setup();

    // Default OFF: creating a loan application is refused.
    const off = await request(app).post(`/api/welfares/${w.id}/loans`).set("Authorization", auth(admin))
      .send({ member_id: m.id, principal: 10000, duration_months: 6, interest_rate: 12 });
    expect(off.status).toBe(403);
    expect(off.body.blocker).toBe("loans_disabled");

    // The switch is exposed on /welfare/current (admin nav reads it).
    const cur = await request(app).get("/api/welfare/current").set("Authorization", auth(admin));
    expect(cur.body.data.loans_enabled).toBe(false);

    // Turn it on.
    const on = await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
    expect(on.body.data.loans_enabled).toBe(true);
    expect((await request(app).get(`/api/welfares/${w.id}/settings`).set("Authorization", auth(admin))).body.data.loans_enabled).toBe(true);

    // Now the application goes through.
    const created = await request(app).post(`/api/welfares/${w.id}/loans`).set("Authorization", auth(admin))
      .send({ member_id: m.id, principal: 10000, duration_months: 6, interest_rate: 12 });
    expect(created.status).toBe(201);

    // ...and toggling back off blocks again.
    await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: false });
    const again = await request(app).post(`/api/welfares/${w.id}/loans`).set("Authorization", auth(admin))
      .send({ member_id: m.id, principal: 5000, duration_months: 3, interest_rate: 10 });
    expect(again.status).toBe(403);
  });

  it("gates the member-portal loan request and exposes the flag on /overview", async () => {
    const { admin, w, m } = await setup();
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    const tok = customerToken(await pcIdByPhone("+254795300111"), (await query("SELECT tenant_id FROM groups WHERE id=$1", [w.id])).rows[0].tenant_id);

    // Loans off (default): the member can't request a loan, and the overview says so.
    const ov1 = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov1.body.data.welfare.loans_enabled).toBe(false);
    const req1 = await request(app).post("/api/welfare/member/loan-requests").set("Authorization", tok).send({ principal: 5000, duration_months: 6 });
    expect(req1.status).toBe(403);

    // Enable → overview flips, request succeeds.
    await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
    const ov2 = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov2.body.data.welfare.loans_enabled).toBe(true);
    const req2 = await request(app).post("/api/welfare/member/loan-requests").set("Authorization", tok).send({ principal: 5000, duration_months: 6 });
    expect(req2.status).toBe(201);
  });
});
