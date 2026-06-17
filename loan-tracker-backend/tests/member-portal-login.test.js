// Welfare MEMBER front door: a members-only login + invite-driven temp password
// + set-password, all on the shared platform_customers identity. The member
// door must surface ONLY welfare memberships (never borrower links) and force a
// password change after the admin's temporary one.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

let seq = 0;
const uniquePhone = () => "0796" + String(100000 + ++seq).slice(-6); // 07XXXXXXXX
const fpOf = (phone) => "+254" + phone.slice(1);
const pcByPhone = async (fp) =>
  (await query("SELECT * FROM platform_customers WHERE phone_number=$1", [fp])).rows[0];
const setPw = async (fp, pw, mustChange) =>
  query(
    "UPDATE platform_customers SET password_hash=$1, phone_verified=true, must_change_password=$2 WHERE phone_number=$3",
    [await bcryptjs.hash(pw, 4), mustChange, fp],
  );

// A welfare with one invited member (admin-set temp password in place).
async function invitedMember(phone) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const m = (
    await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({
      first_name: "Jane", last_name: "Doe", phone_number: phone,
      id_number: "MBR" + phone.slice(-6), email: `j${phone}@ex.com`,
    })
  ).body.data;
  await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
  return { t, admin, w, m, phone, fp: fpOf(phone) };
}

describe("welfare member door", () => {
  it("invite provisions an account with a temp password and forces a change", async () => {
    const { fp } = await invitedMember(uniquePhone());
    const pc = await pcByPhone(fp);
    expect(pc.password_hash).toBeTruthy();
    expect(pc.must_change_password).toBe(true);
    expect(pc.phone_verified).toBe(true); // admin-vouched → can log in immediately
  });

  it("member-login returns welfare-only links and the must_change_password flag", async () => {
    const phone = uniquePhone();
    const { t, fp } = await invitedMember(phone);
    await setPw(fp, "KnownPass12#", true);
    const res = await request(app).post("/api/portal/auth/member-login")
      .send({ phone_number: phone, password: "KnownPass12#" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("member");
    expect(res.body.must_change_password).toBe(true);
    expect(res.body.tenants).toHaveLength(1);
    expect(res.body.tenants[0].kind).toBe("welfare");
    expect(res.body.tenants[0].tenant_id).toBe(t.id);
  });

  it("rejects a borrower-only account at the member door", async () => {
    const t = await createTenant(); // lender (default kind)
    const client = await createClient(t.id);
    const phone = uniquePhone();
    const pc = (
      await query(
        `INSERT INTO platform_customers (phone_number, id_number, first_name, last_name, password_hash, phone_verified, is_active)
         VALUES ($1,$2,'Bob','Borrower',$3,true,true) RETURNING id`,
        [fpOf(phone), "ID" + phone.slice(-6), await bcryptjs.hash("KnownPass12#", 4)],
      )
    ).rows[0];
    await query(
      "INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status) VALUES ($1,$2,$3,'active')",
      [pc.id, t.id, client.id],
    );
    const res = await request(app).post("/api/portal/auth/member-login")
      .send({ phone_number: phone, password: "KnownPass12#" });
    expect(res.status).toBe(403);
    expect(res.body.action).toBe("use_borrower_login");
  });

  it("member-set-password sets a new password and clears the flag", async () => {
    const phone = uniquePhone();
    const { fp } = await invitedMember(phone);
    await setPw(fp, "TempPass12#x", true);
    const res = await request(app).post("/api/portal/auth/member-set-password")
      .send({ phone_number: phone, current_password: "TempPass12#x", new_password: "BrandNewPass1#" });
    expect(res.status).toBe(200);
    expect((await pcByPhone(fp)).must_change_password).toBe(false);

    const good = await request(app).post("/api/portal/auth/member-login")
      .send({ phone_number: phone, password: "BrandNewPass1#" });
    expect(good.status).toBe(200);
    expect(good.body.must_change_password).toBe(false);
    const bad = await request(app).post("/api/portal/auth/member-login")
      .send({ phone_number: phone, password: "TempPass12#x" });
    expect(bad.status).toBe(401);
  });

  it("member-set-password rejects a weak new password and a wrong current one", async () => {
    const phone = uniquePhone();
    const { fp } = await invitedMember(phone);
    await setPw(fp, "TempPass12#x", true);
    const weak = await request(app).post("/api/portal/auth/member-set-password")
      .send({ phone_number: phone, current_password: "TempPass12#x", new_password: "weak" });
    expect(weak.status).toBe(400);
    const wrong = await request(app).post("/api/portal/auth/member-set-password")
      .send({ phone_number: phone, current_password: "nope", new_password: "BrandNewPass1#" });
    expect(wrong.status).toBe(401);
  });

  it("re-invite does not reset a member's own password", async () => {
    const phone = uniquePhone();
    const { admin, w, m, fp } = await invitedMember(phone);
    await setPw(fp, "MyOwnPass12#", false); // member has chosen their own password
    const before = await pcByPhone(fp);
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    const after = await pcByPhone(fp);
    expect(after.password_hash).toBe(before.password_hash); // untouched
    expect(after.must_change_password).toBe(false);
  });
});
