// Creating a client (via the real route) also provisions a verified
// customer-portal account linked to that tenant, with the default password.
import { describe, it, expect } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

// Find the platform_customer linked to a given client (avoids depending on
// the exact stored phone format).
async function pcForClient(clientId) {
  const r = await query(
    `SELECT pc.* FROM platform_customers pc
       JOIN customer_tenant_links l ON l.platform_customer_id = pc.id
      WHERE l.client_id = $1`,
    [clientId],
  );
  return r.rows[0];
}

describe("Auto portal account for new clients", () => {
  it("creates a verified platform_customer + tenant link with the default password", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });

    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", auth(admin))
      .send({
        first_name: "Portal",
        last_name: "Client",
        phone_number: "0712000999",
        id_number: "99887766",
      });
    expect(res.status).toBe(201);
    const client = res.body.data;

    const pc = await pcForClient(client.id);
    expect(pc).toBeTruthy();
    expect(pc.phone_verified).toBe(true);
    // stored in the portal's "+254…" form so portal login can find it
    expect(pc.phone_number).toBe("+254712000999");
    expect(await bcryptjs.compare("Customer2026", pc.password_hash)).toBe(true);

    const link = await query(
      `SELECT 1 FROM customer_tenant_links
        WHERE platform_customer_id = $1 AND tenant_id = $2
          AND client_id = $3 AND status = 'active'`,
      [pc.id, tenant.id, client.id],
    );
    expect(link.rows.length).toBe(1);
  });

  it("reuses one portal account across tenants (same phone) — links both", async () => {
    const t1 = await createTenant();
    const a1 = await createUser(t1.id, { role: "admin" });
    const t2 = await createTenant();
    const a2 = await createUser(t2.id, { role: "admin" });
    const phone = "0712000111";

    const r1 = await request(app)
      .post("/api/clients")
      .set("Authorization", auth(a1))
      .send({ first_name: "A", last_name: "One", phone_number: phone, id_number: "IDREUSE1" });
    const r2 = await request(app)
      .post("/api/clients")
      .set("Authorization", auth(a2))
      .send({ first_name: "A", last_name: "Two", phone_number: phone, id_number: "IDREUSE1" });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const pc1 = await pcForClient(r1.body.data.id);
    const pc2 = await pcForClient(r2.body.data.id);
    expect(pc1.id).toBe(pc2.id); // one customer…

    const links = await query(
      "SELECT tenant_id FROM customer_tenant_links WHERE platform_customer_id = $1",
      [pc1.id],
    );
    expect(links.rows.length).toBe(2); // …linked to both tenants
  });
});
