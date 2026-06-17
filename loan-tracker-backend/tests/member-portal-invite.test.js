// Phase A — inviting a welfare member to the portal. The member becomes a
// platform_customers login linked to the welfare via customer_tenant_links
// .member_id (no client row). The regression that matters: a member-only
// customer must still see the welfare at login (the login query LEFT JOINs
// clients now — an INNER join silently dropped welfare links).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function welfareSetup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind = 'welfare' WHERE id = $1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (
    await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja Welfare" })
  ).body.data;
  const m = (
    await request(app)
      .post(`/api/welfares/${w.id}/members`)
      .set("Authorization", auth(admin))
      .send({ first_name: "Jane", last_name: "Doe", phone_number: "0716000111", id_number: "MBR99001" })
  ).body.data;
  return { tenant: t, admin, welfare: w, member: m };
}

describe("member portal invite", () => {
  it("provisions a platform customer and links it via member_id", async () => {
    const { tenant, admin, welfare, member } = await welfareSetup();

    const res = await request(app)
      .post(`/api/welfares/${welfare.id}/members/${member.id}/invite`)
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.portal_linked).toBe(true);
    expect(res.body.data.new_account).toBe(true);

    const pc = (
      await query("SELECT * FROM platform_customers WHERE phone_number = $1", ["+254716000111"])
    ).rows[0];
    expect(pc).toBeTruthy();
    expect(pc.id_number).toBe("MBR99001");

    const link = (
      await query("SELECT * FROM customer_tenant_links WHERE member_id = $1", [member.id])
    ).rows[0];
    expect(link).toBeTruthy();
    expect(link.tenant_id).toBe(tenant.id);
    expect(link.client_id).toBeNull();
    expect(link.platform_customer_id).toBe(pc.id);
  });

  it("is idempotent — re-inviting reports already linked", async () => {
    const { admin, welfare, member } = await welfareSetup();
    await request(app).post(`/api/welfares/${welfare.id}/members/${member.id}/invite`).set("Authorization", auth(admin));
    const again = await request(app)
      .post(`/api/welfares/${welfare.id}/members/${member.id}/invite`)
      .set("Authorization", auth(admin));
    expect(again.status).toBe(200);
    expect(again.body.data.already_linked).toBe(true);
  });

  it("rejects inviting a member with no ID number", async () => {
    const { admin, welfare } = await welfareSetup();
    const m2 = (
      await request(app)
        .post(`/api/welfares/${welfare.id}/members`)
        .set("Authorization", auth(admin))
        .send({ first_name: "No", last_name: "Id", phone_number: "0716000222" })
    ).body.data;
    const res = await request(app)
      .post(`/api/welfares/${welfare.id}/members/${m2.id}/invite`)
      .set("Authorization", auth(admin));
    expect(res.status).toBe(400);
  });

  it("a member-only customer sees the welfare tenant at login (kind='welfare')", async () => {
    const { tenant, admin, welfare, member } = await welfareSetup();
    await request(app).post(`/api/welfares/${welfare.id}/members/${member.id}/invite`).set("Authorization", auth(admin));

    // Give the provisioned account a password so we can log in.
    const hash = await bcryptjs.hash("Passw0rd!", 4);
    await query("UPDATE platform_customers SET password_hash = $1, phone_verified = true WHERE phone_number = $2", [
      hash,
      "+254716000111",
    ]);

    const login = await request(app)
      .post("/api/portal/auth/login")
      .send({ phone_number: "0716000111", password: "Passw0rd!" });
    expect(login.status).toBe(200);
    const welfareLink = (login.body.tenants || []).find((t) => t.tenant_id === tenant.id);
    expect(welfareLink).toBeTruthy();
    expect(welfareLink.kind).toBe("welfare");
    expect(welfareLink.client_code).toBe(member.member_no);
  });
});
