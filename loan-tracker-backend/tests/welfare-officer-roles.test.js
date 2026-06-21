// Welfare officer roles (migration 096): a member can be chair / treasurer /
// secretary, at most one of each per welfare. Admin can set/clear directly
// (bootstrap before elections); assigning an officer role demotes the prior
// holder. The role surfaces on the member portal overview.
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
  const mk = async (fn, phone, id) => (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: fn, last_name: "K", phone_number: phone, id_number: id })).body.data;
  return { t, admin, w, mk };
}
const setRole = (w, admin, id, role) => request(app).put(`/api/welfares/${w.id}/members/${id}/role`).set("Authorization", auth(admin)).send({ role });

describe("welfare officer roles", () => {
  it("assigns an officer role, rejects junk, and clears back to member", async () => {
    const { admin, w, mk } = await setup();
    const a = await mk("Asha", "0795400111", "OFR1");

    expect((await setRole(w, admin, a.id, "chair")).body.data.role).toBe("chair");
    expect((await setRole(w, admin, a.id, "nonsense")).status).toBe(400);
    expect((await setRole(w, admin, a.id, "member")).body.data.role).toBe("member");
  });

  it("keeps at most one chair per welfare — assigning a new chair demotes the old one", async () => {
    const { admin, w, mk } = await setup();
    const a = await mk("Asha", "0795400201", "ONE1");
    const b = await mk("Brian", "0795400202", "ONE2");

    await setRole(w, admin, a.id, "chair");
    const second = await setRole(w, admin, b.id, "chair");
    expect(second.status).toBe(200);
    expect(second.body.data.role).toBe("chair");

    const roles = (await query("SELECT id, role FROM members WHERE welfare_id=$1 ORDER BY id", [w.id])).rows;
    expect(roles.find((r) => r.id === a.id).role).toBe("member"); // demoted
    expect(roles.find((r) => r.id === b.id).role).toBe("chair");
    // Different officer roles coexist.
    expect((await setRole(w, admin, a.id, "treasurer")).body.data.role).toBe("treasurer");
  });

  it("surfaces the member's role on the portal overview", async () => {
    const { admin, w, mk } = await setup();
    const a = await mk("Asha", "0795400301", "POV1");
    await request(app).post(`/api/welfares/${w.id}/members/${a.id}/invite`).set("Authorization", auth(admin));
    await setRole(w, admin, a.id, "secretary");
    const tok = customerToken(await pcIdByPhone("+254795400301"), (await query("SELECT tenant_id FROM groups WHERE id=$1", [w.id])).rows[0].tenant_id);

    const ov = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov.body.data.member.role).toBe("secretary");
  });
});
