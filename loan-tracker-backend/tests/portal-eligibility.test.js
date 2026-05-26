// Portal borrowing eligibility (mirrors the staff loans route): a client with
// a defaulted loan can't borrow, and a client may hold at most 3 active loans
// at a time with one lender.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createClient, createLoan } from "./helpers/factory.js";

let n = 0;
const uniqDigits = () =>
  String(700000000 + n++) + Math.floor(Math.random() * 90 + 10);

// Mint a portal customer + active link + customer JWT scoped to (tenant, client).
async function makeCustomer(tenantId, clientId) {
  const pc = await query(
    `INSERT INTO platform_customers
       (phone_number, id_number, first_name, last_name, is_active)
     VALUES ($1,$2,'Cust','Omer',true) RETURNING id`,
    [`0${uniqDigits()}`, `ID${uniqDigits()}`],
  );
  const pcId = pc.rows[0].id;
  await query(
    `INSERT INTO customer_tenant_links
       (platform_customer_id, tenant_id, client_id, status)
     VALUES ($1,$2,$3,'active')`,
    [pcId, tenantId, clientId],
  );
  return jwt.sign(
    {
      user_type: "customer",
      platform_customer_id: pcId,
      current_tenant_id: tenantId,
      current_client_id: clientId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const applyBody = {
  principal_amount: 5000,
  loan_duration_months: 6,
  purpose: "Business expansion",
};
const post = (token) =>
  request(app)
    .post("/api/portal/customer/applications")
    .set("Authorization", `Bearer ${token}`)
    .send(applyBody);

afterAll(closePool);

describe("POST /api/portal/customer/applications — eligibility", () => {
  it("blocks a client who has a defaulted loan with this lender", async () => {
    const t = await createTenant();
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "defaulted" });
    const res = await post(await makeCustomer(t.id, c.id));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/defaulted/i);
  });

  it("blocks a client who already has 3 active loans with this lender", async () => {
    const t = await createTenant();
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });
    await createLoan(t.id, c.id, { status: "active" });
    const res = await post(await makeCustomer(t.id, c.id));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3 active loans/i);
  });

  it("allows a client in good standing", async () => {
    const t = await createTenant();
    const c = await createClient(t.id);
    const res = await post(await makeCustomer(t.id, c.id));
    expect(res.status).toBe(201);
  });
});
