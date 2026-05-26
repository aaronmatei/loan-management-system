// Tenant-code generation must not collide when tenants have been deleted.
// The old generator used COUNT(*)+1 — fine on a virgin DB, but it picks
// numbers that already exist whenever a row was removed.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";

afterAll(closePool);

describe("POST /api/tenants/signup — tenant_code uniqueness", () => {
  it("uses MAX(numeric suffix)+1 so it never collides with an existing TNT code", async () => {
    const ts = Date.now();
    // Seed a tenant with a deliberately high TNT-pattern code so any
    // COUNT(*)+1 strategy would land far below it. The new generator must
    // pick MAX+1 = 100000 (not whatever COUNT(*) happens to be).
    await query(
      `INSERT INTO tenants
         (tenant_code, business_name, subdomain, contact_name, contact_email,
          status, billing_enabled)
       VALUES ('TNT99999', 'High-Code Tenant ' || $1, 'high-' || $1,
               'Owner', 'high-' || $1 || '@test.com', 'active', true)`,
      [String(ts)],
    );

    const payload = {
      business_name: "Brand New Lender " + ts,
      subdomain: `bnl${ts}`,
      contact_name: "Jane Owner",
      contact_email: `jane.signup.${ts}@example.com`,
      contact_phone: "+254700000000",
      admin_password: "StrongPass1!Aa2025",
      physical_address: "Nairobi",
      city: "Nairobi",
      county: "Nairobi",
      business_type: "microfinance",
    };
    const res = await request(app).post("/api/tenants/signup").send(payload);
    expect(res.status).toBe(201);

    const created = (
      await query("SELECT tenant_code FROM tenants WHERE subdomain = $1", [
        payload.subdomain,
      ])
    ).rows[0];
    expect(created.tenant_code).toBe("TNT100000"); // MAX 99999 + 1
  });
});
