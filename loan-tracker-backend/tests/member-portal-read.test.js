// Phase B — the welfare member self-service read API (/api/welfare/member/*).
// A member sees only their own data; a borrower (lender tenant) hitting these
// routes gets a clean 403 from resolveMember.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

// A tenant-scoped customer token (skips the login/select-tenant dance covered in
// the invite test).
const customerToken = (pcId, tenantId) =>
  "Bearer " +
  jwt.sign(
    { platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

async function makeMember(admin, welfareId, over = {}) {
  return (
    await request(app)
      .post(`/api/welfares/${welfareId}/members`)
      .set("Authorization", auth(admin))
      .send({ first_name: "Jane", last_name: "Doe", phone_number: over.phone || "0795200111", id_number: over.id || "MBR1", ...over })
  ).body.data;
}
async function invite(admin, welfareId, memberId) {
  await request(app).post(`/api/welfares/${welfareId}/members/${memberId}/invite`).set("Authorization", auth(admin));
}
async function pcIdByPhone(phone) {
  return (await query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone])).rows[0].id;
}

async function welfareSetup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind = 'welfare' WHERE id = $1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  return { tenant: t, admin, welfare: w };
}

describe("member portal read API", () => {
  it("returns the member's own overview, ledger, loans", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200111", id: "MBRA1" });
    await invite(admin, welfare.id, m.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    await request(app).post(`/api/welfares/${welfare.id}/members/${m.id}/loans`).set("Authorization", auth(admin)).send({ principal: 20000, interest_rate: 12, duration_months: 6 });

    const tok = customerToken(await pcIdByPhone("+254795200111"), tenant.id);

    const ov = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(ov.status).toBe(200);
    expect(Number(ov.body.data.savings_balance)).toBe(50000);
    expect(ov.body.data.welfare.name).toBe("Umoja");
    expect(ov.body.data.loans.active).toBe(1);
    expect(Number(ov.body.data.loans.outstanding)).toBe(21200);

    const loans = await request(app).get("/api/welfare/member/loans").set("Authorization", tok);
    expect(loans.body.data).toHaveLength(1);
    expect(loans.body.data[0].loan_code).toMatch(/^MBL-/);

    const led = await request(app).get("/api/welfare/member/ledger").set("Authorization", tok);
    expect(led.body.data.transactions.some((x) => x.type === "contribution")).toBe(true);
  });

  it("isolates members — one member can't see another's loans", async () => {
    const { tenant, admin, welfare } = await welfareSetup();
    const a = await makeMember(admin, welfare.id, { phone: "0795200201", id: "ISOA" });
    const b = await makeMember(admin, welfare.id, { phone: "0795200202", id: "ISOB" });
    await invite(admin, welfare.id, a.id);
    await invite(admin, welfare.id, b.id);
    await request(app).post(`/api/welfares/${welfare.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 30000 });
    await request(app).post(`/api/welfares/${welfare.id}/members/${a.id}/loans`).set("Authorization", auth(admin)).send({ principal: 10000, interest_rate: 10, duration_months: 3 });

    const tokB = customerToken(await pcIdByPhone("+254795200202"), tenant.id);
    const loansB = await request(app).get("/api/welfare/member/loans").set("Authorization", tokB);
    expect(loansB.body.data).toHaveLength(0);
    const ovB = await request(app).get("/api/welfare/member/overview").set("Authorization", tokB);
    expect(Number(ovB.body.data.savings_balance)).toBe(0);
  });

  it("403s a borrower (non-member) hitting member routes", async () => {
    const { admin, welfare } = await welfareSetup();
    const m = await makeMember(admin, welfare.id, { phone: "0795200311", id: "BRW1" });
    await invite(admin, welfare.id, m.id);
    const pcId = await pcIdByPhone("+254795200311");

    // Link the SAME person to a lender tenant as a borrower (client_id), then
    // select that tenant — they are not a member there.
    const lender = await createTenant();
    const client = await createClient(lender.id);
    await query(
      "INSERT INTO customer_tenant_links (platform_customer_id, tenant_id, client_id, status) VALUES ($1,$2,$3,'active')",
      [pcId, lender.id, client.id],
    );
    const tok = customerToken(pcId, lender.id);
    const res = await request(app).get("/api/welfare/member/overview").set("Authorization", tok);
    expect(res.status).toBe(403);
  });
});
