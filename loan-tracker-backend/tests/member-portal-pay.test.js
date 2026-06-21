// Phase C — member-initiated M-Pesa pay. STK initiation needs live Daraja, so
// we mock just initiateSTKPush and assert the member can only pay their OWN
// targets, and a pending mpesa_transactions row is recorded with their member_id.
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../src/services/mpesaService.js", async (importActual) => {
  const actual = await importActual();
  let n = 0;
  return {
    ...actual,
    initiateSTKPush: vi.fn(async ({ amount }) => {
      n += 1;
      return {
        checkoutRequestId: `ws_CO_${n}`,
        merchantRequestId: `mr_${n}`,
        customerMessage: "STK sent",
        normalizedPhone: "254716000111",
        amount,
        raw: {},
      };
    }),
  };
});

const { default: app } = await import("../src/app.js");
const { query, closePool } = await import("./helpers/db.js");
const { createTenant, createUser, tokenFor } = await import("./helpers/factory.js");

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

const customerToken = (pcId, tenantId) =>
  "Bearer " +
  jwt.sign(
    { platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );

async function pcIdByPhone(phone) {
  return (await query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone])).rows[0].id;
}

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind = 'welfare' WHERE id = $1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  const mk = async (phone, id) =>
    (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "M", last_name: phone, phone_number: phone, id_number: id })).body.data;
  const a = await mk("0795300111", "PAYA");
  const b = await mk("0795300222", "PAYB");
  await request(app).post(`/api/welfares/${w.id}/members/${a.id}/invite`).set("Authorization", auth(admin));
  await request(app).post(`/api/welfares/${w.id}/members/${b.id}/invite`).set("Authorization", auth(admin));
  // Member A gets a chama loan to repay.
  await request(app).post(`/api/welfares/${w.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
  const loanA = (await request(app).post(`/api/welfares/${w.id}/members/${a.id}/loans`).set("Authorization", auth(admin)).send({ principal: 10000, interest_rate: 12, duration_months: 6 })).body.data;
  return { tenant: t, admin, welfare: w, a, b, loanA };
}

describe("member portal pay (M-Pesa)", () => {
  it("lets a member repay their own loan and records a pending tx", async () => {
    const { tenant, a, loanA } = await setup();
    const tok = customerToken(await pcIdByPhone("+254795300111"), tenant.id);
    const res = await request(app)
      .post("/api/welfare/member/mpesa/loan-repayment")
      .set("Authorization", tok)
      .send({ loan_id: loanA.id });
    expect(res.status).toBe(200);
    expect(res.body.checkout_request_id).toMatch(/^ws_CO_/);

    const tx = (
      await query("SELECT * FROM mpesa_transactions WHERE target_type='member_loan' AND target_id=$1", [loanA.id])
    ).rows[0];
    expect(tx).toBeTruthy();
    expect(tx.member_id).toBe(a.id);
    expect(tx.status).toBe("pending");
    expect(tx.initiated_by_user_id).toBeNull();
  });

  it("won't let a member pay another member's loan", async () => {
    const { tenant, loanA } = await setup();
    const tokB = customerToken(await pcIdByPhone("+254795300222"), tenant.id);
    const res = await request(app)
      .post("/api/welfare/member/mpesa/loan-repayment")
      .set("Authorization", tokB)
      .send({ loan_id: loanA.id });
    expect(res.status).toBe(404);
  });

  it("lists only the member's own transactions", async () => {
    const { tenant, a, loanA } = await setup();
    const tok = customerToken(await pcIdByPhone("+254795300111"), tenant.id);
    await request(app).post("/api/welfare/member/mpesa/loan-repayment").set("Authorization", tok).send({ loan_id: loanA.id });
    const list = await request(app).get("/api/welfare/member/mpesa/transactions").set("Authorization", tok);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((x) => x.target_type === "member_loan")).toBe(true);
  });
});
