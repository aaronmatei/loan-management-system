// Creating a client (via the real route) also provisions a verified
// customer-portal account linked to that tenant, with the default password.
import { describe, it, expect } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";
import { formatPhone } from "../src/utils/formatter.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

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

    const pc = await query(
      "SELECT * FROM platform_customers WHERE phone_number = $1",
      [formatPhone("0712000999")],
    );
    expect(pc.rows.length).toBe(1);
    expect(pc.rows[0].phone_verified).toBe(true);
    expect(
      await bcryptjs.compare("Customer2026", pc.rows[0].password_hash),
    ).toBe(true);

    const link = await query(
      `SELECT 1 FROM customer_tenant_links
        WHERE platform_customer_id = $1 AND tenant_id = $2
          AND client_id = $3 AND status = 'active'`,
      [pc.rows[0].id, tenant.id, client.id],
    );
    expect(link.rows.length).toBe(1);
  });

  it("reuses one portal account across tenants (same phone) — links both", async () => {
    const t1 = await createTenant();
    const a1 = await createUser(t1.id, { role: "admin" });
    const t2 = await createTenant();
    const a2 = await createUser(t2.id, { role: "admin" });
    const phone = "0712000111";

    await request(app)
      .post("/api/clients")
      .set("Authorization", auth(a1))
      .send({ first_name: "A", last_name: "One", phone_number: phone, id_number: "IDREUSE1" });
    await request(app)
      .post("/api/clients")
      .set("Authorization", auth(a2))
      .send({ first_name: "A", last_name: "Two", phone_number: phone, id_number: "IDREUSE1" });

    const pc = await query(
      "SELECT * FROM platform_customers WHERE phone_number = $1",
      [formatPhone(phone)],
    );
    expect(pc.rows.length).toBe(1); // one customer…
    const links = await query(
      "SELECT tenant_id FROM customer_tenant_links WHERE platform_customer_id = $1",
      [pc.rows[0].id],
    );
    expect(links.rows.length).toBe(2); // …linked to both tenants
  });
});
