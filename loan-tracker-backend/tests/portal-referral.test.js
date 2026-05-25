// Refer & Earn: when a customer registers via a lender's referral link
// (?ref=<lender code>), they are auto-linked to that lender — the lender gains
// them as a client.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);
const PASSWORD = "PortalPass1234!";
const CUSTOMER = {
  phone_number: "0712707070",
  id_number: "70707070",
  first_name: "Ref",
  last_name: "Erred",
};

let tenant;
beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  await query("UPDATE tenants SET referral_code = $1, status = 'active' WHERE id = $2", [
    "REFTEST1",
    tenant.id,
  ]);
});
afterAll(closePool);

describe("Refer & Earn auto-link", () => {
  it("links a referred customer to the referring lender on signup", async () => {
    const reg = await api()
      .post("/api/portal/auth/register")
      .send({ ...CUSTOMER, ref: "REFTEST1" });
    expect(reg.status).toBe(200);
    const customerId = reg.body.customer_id;

    // The referring lender was recorded on the account.
    const pc = await query(
      "SELECT registration_tenant_id FROM platform_customers WHERE id = $1",
      [customerId],
    );
    expect(pc.rows[0].registration_tenant_id).toBe(tenant.id);

    await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: customerId, password: PASSWORD });

    // A client now exists at that lender, and the customer is linked.
    const client = await query(
      "SELECT id FROM clients WHERE tenant_id = $1 AND id_number = $2",
      [tenant.id, CUSTOMER.id_number],
    );
    expect(client.rows.length).toBe(1);

    const link = await query(
      `SELECT 1 FROM customer_tenant_links
        WHERE platform_customer_id = $1 AND tenant_id = $2 AND client_id = $3 AND status = 'active'`,
      [customerId, tenant.id, client.rows[0].id],
    );
    expect(link.rows.length).toBe(1);
  });

  it("registers normally with no referral code (no auto-link)", async () => {
    const reg = await api()
      .post("/api/portal/auth/register")
      .send({ ...CUSTOMER, phone_number: "0712707071", id_number: "70707071" });
    expect(reg.status).toBe(200);
    await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: reg.body.customer_id, password: PASSWORD });
    const links = await query(
      "SELECT 1 FROM customer_tenant_links WHERE platform_customer_id = $1",
      [reg.body.customer_id],
    );
    expect(links.rows.length).toBe(0);
  });
});
