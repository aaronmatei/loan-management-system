// Platform billing for welfare accounts: a flat monthly fee + 5% of the
// interest they earn on member loans (from the welfare pool, NOT lender capital).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { calculateTenantInterest, generateInvoice } from "../src/services/billingService.js";

afterAll(closePool);

const PASS = "Welfare@2026xy";

// Register a welfare and run one fully-repaid member loan through its pool.
async function welfareWithRepaidLoan(sub, email) {
  const signup = await request(app).post("/api/tenants/welfare-signup").send({
    welfare_name: "Umoja Welfare",
    subdomain: sub,
    contact_name: "Jane Chair",
    contact_email: email,
    admin_password: PASS,
  });
  const auth = `Bearer ${signup.body.token}`;
  const tenantId = signup.body.user.tenant_id;
  const welfareId = signup.body.welfare_group_id;
  await request(app).put(`/api/welfares/${welfareId}/settings/loans`).set("Authorization", auth).send({ enabled: true });

  const m = (
    await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", auth).send({ first_name: "A", last_name: "B" })
  ).body.data;
  await request(app).post(`/api/welfares/${welfareId}/members/${m.id}/contributions`).set("Authorization", auth).send({ amount: 50000 });
  const loan = (
    await request(app).post(`/api/welfares/${welfareId}/members/${m.id}/loans`).set("Authorization", auth).send({ principal: 20000, interest_rate: 12, duration_months: 6 })
  ).body.data;
  // 12% annual flat over 6mo → interest 1,200; total 21,200.
  await request(app).post(`/api/welfares/${welfareId}/members/${m.id}/loans/${loan.id}/payments`).set("Authorization", auth).send({});
  return { tenantId };
}

describe("welfare platform billing", () => {
  it("a welfare is billed a monthly fee + 5% of member-loan interest", async () => {
    const { tenantId } = await welfareWithRepaidLoan("bill-welfare", "bill@welfare.example");

    const tenant = (await query("SELECT kind, billing_enabled, billing_base_fee, billing_fee_percentage FROM tenants WHERE id = $1", [tenantId])).rows[0];
    expect(tenant.kind).toBe("welfare");
    expect(tenant.billing_enabled).toBe(true);
    expect(Number(tenant.billing_base_fee)).toBe(500);
    expect(Number(tenant.billing_fee_percentage)).toBe(5);

    const now = new Date();
    const calc = await calculateTenantInterest(tenantId, now.getFullYear(), now.getMonth() + 1);
    expect(calc.interest_earned).toBeCloseTo(1200, 2); // interest from the repaid member loan

    const inv = await generateInvoice(tenantId, now.getFullYear(), now.getMonth() + 1);
    expect(Number(inv.interest_earned)).toBeCloseTo(1200, 2);
    expect(Number(inv.amount_due)).toBeCloseTo(60, 2); // 5% of 1,200
    expect(Number(inv.base_fee)).toBe(500); // monthly fee
    expect(Number(inv.total_amount)).toBeCloseTo(560, 2); // 60 + 500
  });

  it("welfare interest comes from member loans, not the lending capital", async () => {
    const { tenantId } = await welfareWithRepaidLoan("calc-welfare", "calc@welfare.example");
    // The lender-side interest query (transactions+loans) would be 0 for a
    // welfare; the welfare branch returns the member-loan interest instead.
    const now = new Date();
    const calc = await calculateTenantInterest(tenantId, now.getFullYear(), now.getMonth() + 1);
    expect(calc.interest_earned).toBeGreaterThan(0);
    expect(calc.payment_count).toBe(1);
  });
});
