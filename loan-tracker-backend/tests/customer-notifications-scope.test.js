// Customer notifications must be scoped to the tenant the customer is currently
// in. A platform_customer can be linked to several tenants (e.g. a welfare AND a
// lender); the bell must not leak one tenant's notifications into another's
// portal (a welfare member was seeing a lender's "payment received" notices).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const customerToken = (pc, tenant) =>
  "Bearer " + jwt.sign({ platform_customer_id: pc, user_type: "customer", current_tenant_id: tenant, current_client_id: null }, process.env.JWT_SECRET, { expiresIn: "1h" });
afterAll(closePool);

describe("customer notifications are scoped to the current tenant", () => {
  it("a welfare member doesn't see another linked tenant's notifications", async () => {
    // A welfare the member actually belongs to (real platform_customer + link).
    const t = await createTenant();
    await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
    const admin = await createUser(t.id, { role: "admin" });
    const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
    const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Jane", last_name: "D", phone_number: "0795400931", id_number: "NS931" })).body.data;
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    const pc = (await query("SELECT id FROM platform_customers WHERE phone_number = $1", ["+254795400931"])).rows[0].id;

    // A different tenant (a lender) the same person also has a notification under.
    const lender = await createTenant();
    await query(
      `INSERT INTO customer_notifications (platform_customer_id, tenant_id, type, dedupe_key, amount)
       VALUES ($1,$2,'payment','welfare-1',100),($1,$3,'payment','lender-1',200)`,
      [pc, t.id, lender.id],
    );

    const inWelfare = (await request(app).get("/api/portal/customer/notifications").set("Authorization", customerToken(pc, t.id))).body.data;
    const tenants = inWelfare.map((n) => n.tenant_id);
    expect(tenants).toContain(t.id);          // sees its own welfare notification
    expect(tenants).not.toContain(lender.id); // never the lender's
  });
});
