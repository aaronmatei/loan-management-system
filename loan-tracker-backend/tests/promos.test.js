// Promo codes: a tenant creates a code, a customer signs up via
// ?promo=<code>, and the tenant sees that client under the code.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool, tokenFor } from "./helpers/db.js";
import { createUser } from "./helpers/factory.js";

const api = () => request(app);
const auth = (u) => ({ Authorization: `Bearer ${tokenFor(u)}` });
const PASSWORD = "PortalPass1234!";

let tenant, admin;
beforeEach(async () => {
  await truncate("promo_codes", "tenants", "platform_customers");
  tenant = await seedTenant();
  admin = await createUser(tenant.id, { role: "admin" });
});
afterAll(closePool);

describe("Promo codes", () => {
  it("creates a code, tags a referred sign-up, and lists the client", async () => {
    // 1. Tenant creates a promo code.
    const created = await api()
      .post("/api/promos")
      .set(auth(admin))
      .send({ code: "radio2026", label: "Radio campaign" });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe("RADIO2026"); // normalized
    const promoId = created.body.data.id;

    // 2. Public validate (used by the sign-up page).
    const v = await api().get("/api/promos/validate/radio2026");
    expect(v.body.valid).toBe(true);
    expect(v.body.tenant_name).toBe(tenant.business_name);

    // 3. A customer signs up via the promo link.
    const reg = await api().post("/api/portal/auth/register").send({
      phone_number: "0712606060",
      id_number: "60606060",
      first_name: "Promo",
      last_name: "Joiner",
      promo: "RADIO2026",
    });
    const customerId = reg.body.customer_id;
    await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: customerId, password: PASSWORD });

    // 4. The client exists at the tenant, tagged + linked.
    const client = await query(
      "SELECT id, signup_promo_code FROM clients WHERE tenant_id = $1 AND id_number = $2",
      [tenant.id, "60606060"],
    );
    expect(client.rows.length).toBe(1);
    expect(client.rows[0].signup_promo_code).toBe("RADIO2026");

    // 5. The tenant's promo list shows 1 sign-up, and the per-code clients
    //    endpoint returns that client.
    const list = await api().get("/api/promos").set(auth(admin));
    expect(list.body.data.find((p) => p.id === promoId).signups).toBe(1);

    const clients = await api()
      .get(`/api/promos/${promoId}/clients`)
      .set(auth(admin));
    expect(clients.body.data.length).toBe(1);
    expect(clients.body.data[0].first_name).toBe("Promo");
  });

  it("rejects a duplicate code", async () => {
    await api().post("/api/promos").set(auth(admin)).send({ code: "DUP1" });
    const dup = await api().post("/api/promos").set(auth(admin)).send({ code: "dup1" });
    expect(dup.status).toBe(409);
  });
});
