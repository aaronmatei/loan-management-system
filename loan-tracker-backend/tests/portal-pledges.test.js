// Pawn customer portal: a logged-in customer at a pawnbroker tenant can see
// their pledges (pawn loan + collateral) and the redemption balance.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);
const PASSWORD = "PortalPass1234!";
const CUSTOMER = { phone_number: "0712909090", id_number: "90909090", first_name: "Pawn", last_name: "Customer" };

let tenant;
beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  await query(`UPDATE tenants SET customer_portal_enabled = true, allow_self_signup = true, kind = 'pawnbroker' WHERE id = $1`, [tenant.id]);
});
afterAll(closePool);

async function loginLinkSelect() {
  const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
  await api().post("/api/portal/auth/verify-otp").send({ customer_id: reg.body.customer_id, password: PASSWORD });
  const login = await api().post("/api/portal/auth/login").send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
  await api().post("/api/portal/auth/add-tenant").set({ Authorization: `Bearer ${login.body.token}` }).send({ target_tenant_id: tenant.id });
  // Select the tenant to mint a tenant-scoped token (current_tenant_id set).
  const sel = await api().post("/api/portal/auth/select-tenant").set({ Authorization: `Bearer ${login.body.token}` }).send({ tenant_id: tenant.id });
  const clientId = (await query("SELECT id FROM clients WHERE tenant_id=$1 AND id_number=$2", [tenant.id, CUSTOMER.id_number])).rows[0].id;
  return { auth: { Authorization: `Bearer ${sel.body.token}` }, clientId, selBody: sel.body };
}

async function seedPledge(clientId, code, { paid = 0, status = "active", item = "iPhone 13" } = {}) {
  const loan = (await query(
    `INSERT INTO loans (tenant_id, client_id, loan_code, principal_amount, interest_rate, total_interest, total_amount_due, loan_duration_months, status, loan_type, end_date, created_at)
     VALUES ($1,$2,$3,12000,1,120,12120,1,$4,'pawn', CURRENT_DATE + 30, NOW()) RETURNING *`,
    [tenant.id, clientId, code, status],
  )).rows[0];
  await query(
    `INSERT INTO loan_collateral (tenant_id, loan_id, description, category, appraised_value, ltv_percent, status)
     VALUES ($1,$2,$3,'Electronics',20000,60,'held')`,
    [tenant.id, loan.id, item],
  );
  if (paid > 0) {
    await query(
      `INSERT INTO transactions (tenant_id, loan_id, client_id, amount_paid, payment_status, payment_method, payment_date, transaction_code)
       VALUES ($1,$2,$3,$4,'completed','M-Pesa', NOW(), $5)`,
      [tenant.id, loan.id, clientId, paid, `TXN-${code}`],
    );
  }
  return loan;
}

describe("pawn customer portal — pledges", () => {
  it("exposes the tenant kind on select-tenant", async () => {
    const { selBody } = await loginLinkSelect();
    expect(selBody.current_tenant.kind).toBe("pawnbroker");
  });

  it("lists the customer's pledges with item + redemption balance", async () => {
    const { auth, clientId } = await loginLinkSelect();
    await seedPledge(clientId, "LN-PAWN-1", { paid: 2000 });

    const res = await api().get("/api/portal/customer/pledges").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const p = res.body.data[0];
    expect(p.item).toBe("iPhone 13");
    expect(p.collateral_status).toBe("held");
    expect(p.balance).toBe(10120); // 12,120 due − 2,000 paid
    expect(p.overdue).toBe(false);
  });

  it("returns a single pledge with collateral + transactions", async () => {
    const { auth, clientId } = await loginLinkSelect();
    const loan = await seedPledge(clientId, "LN-PAWN-2", { paid: 5000 });

    const res = await api().get(`/api/portal/customer/pledges/${loan.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.collateral.description).toBe("iPhone 13");
    expect(res.body.data.balance).toBe(7120);
    expect(res.body.data.transactions).toHaveLength(1);
  });

  it("does not leak another client's pledge", async () => {
    const { auth } = await loginLinkSelect();
    // A pledge belonging to a different client in the same tenant.
    const other = (await query(
      `INSERT INTO clients (tenant_id, client_code, first_name, last_name, phone_number) VALUES ($1,'CLT-X','Other','Person','0700111222') RETURNING id`,
      [tenant.id],
    )).rows[0];
    const otherLoan = await seedPledge(other.id, "LN-PAWN-OTHER");

    const list = await api().get("/api/portal/customer/pledges").set(auth);
    expect(list.body.data).toHaveLength(0);
    const detail = await api().get(`/api/portal/customer/pledges/${otherLoan.id}`).set(auth);
    expect(detail.status).toBe(404);
  });
});
