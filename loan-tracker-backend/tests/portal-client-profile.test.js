// Business + location captured at portal sign-up must flow onto the per-tenant
// client record when the customer links to a lender — so a portal-created
// client looks the same as a tenant-added one.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);
const PASSWORD = "PortalPass1234!";
const CUSTOMER = {
  phone_number: "0712909090",
  id_number: "90909090",
  first_name: "Biz",
  last_name: "Owner",
  business_name: "Mama Mboga Stores",
  business_type: "Retail Shop",
  county: "Nairobi",
  city: "Westlands",
  address: "P.O Box 123",
};

let tenant;
beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  await query(
    `UPDATE tenants
        SET customer_portal_enabled = true, allow_self_signup = true
      WHERE id = $1`,
    [tenant.id],
  );
});
afterAll(closePool);

describe("portal sign-up captures business + location", () => {
  it("propagates them to the client created on link", async () => {
    const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
    expect(reg.status).toBe(200);
    const customerId = reg.body.customer_id;

    // Stored on the cross-tenant platform_customers record.
    const pc = await query(
      "SELECT business_name, business_type, county, city, address FROM platform_customers WHERE id = $1",
      [customerId],
    );
    expect(pc.rows[0].business_type).toBe("Retail Shop");
    expect(pc.rows[0].county).toBe("Nairobi");

    await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: customerId, password: PASSWORD });
    await api()
      .post("/api/portal/auth/add-tenant")
      .send({ target_tenant_id: tenant.id, customer_id: customerId, password: PASSWORD });

    // The new client at the lender inherits the business + location.
    const client = await query(
      `SELECT business_name, business_type, county, city, address
         FROM clients WHERE tenant_id = $1 AND id_number = $2`,
      [tenant.id, CUSTOMER.id_number],
    );
    expect(client.rows.length).toBe(1);
    expect(client.rows[0].business_name).toBe("Mama Mboga Stores");
    expect(client.rows[0].business_type).toBe("Retail Shop");
    expect(client.rows[0].county).toBe("Nairobi");
    expect(client.rows[0].city).toBe("Westlands");
    expect(client.rows[0].address).toBe("P.O Box 123");
  });
});
