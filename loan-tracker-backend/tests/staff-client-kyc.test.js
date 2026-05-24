// Staff client detail (GET /api/clients/:id) surfaces the client's KYC
// images — profile photo + both ID sides — pulled from the linked
// customer-portal account so the lender can verify identity.
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

async function createClientViaRoute(admin, overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", auth(admin))
    .send({
      first_name: "Kyc",
      last_name: "Client",
      phone_number: "0712555888",
      id_number: "44556677",
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("Staff client detail — KYC images", () => {
  it("returns the linked portal account's photo + ID images", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const client = await createClientViaRoute(admin);

    // The POST auto-provisioned a portal account + link; set its images.
    await query(
      `UPDATE platform_customers SET
         profile_photo_url = 'https://cdn/x/dp.jpg',
         id_front_url      = 'https://cdn/x/front.jpg',
         id_back_url       = 'https://cdn/x/back.jpg'
       WHERE id = (
         SELECT platform_customer_id FROM customer_tenant_links
          WHERE client_id = $1 AND tenant_id = $2 AND status = 'active'
       )`,
      [client.id, tenant.id],
    );

    const res = await request(app)
      .get(`/api/clients/${client.id}`)
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.profile_photo_url).toBe("https://cdn/x/dp.jpg");
    expect(res.body.data.id_front_url).toBe("https://cdn/x/front.jpg");
    expect(res.body.data.id_back_url).toBe("https://cdn/x/back.jpg");

    // The client profile page actually reads from /credit-profile — it must
    // carry the same images.
    const cp = await request(app)
      .get(`/api/clients/${client.id}/credit-profile`)
      .set("Authorization", auth(admin));
    expect(cp.status).toBe(200);
    expect(cp.body.data.client.profile_photo_url).toBe("https://cdn/x/dp.jpg");
    expect(cp.body.data.client.id_front_url).toBe("https://cdn/x/front.jpg");
    expect(cp.body.data.client.id_back_url).toBe("https://cdn/x/back.jpg");
  });

  it("returns null image fields when nothing is uploaded", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const client = await createClientViaRoute(admin, {
      phone_number: "0712555999",
      id_number: "44556678",
    });

    const res = await request(app)
      .get(`/api/clients/${client.id}`)
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.profile_photo_url).toBeNull();
    expect(res.body.data.id_front_url).toBeNull();
    expect(res.body.data.id_back_url).toBeNull();
  });
});
