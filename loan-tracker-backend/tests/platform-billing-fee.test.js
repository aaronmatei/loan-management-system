// Platform admin can set each lender's billing fee (the % of interest earned
// the platform charges), which drives invoice generation.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("PUT /api/platform/admin/tenants/:id/billing-fee", () => {
  it("sets a tenant's interest-earned fee percentage", async () => {
    const t = await createTenant({ billing_fee_percentage: 5 });
    const platformAdmin = await createUser(t.id, {
      role: "admin",
      is_platform_admin: true,
    });

    const res = await request(app)
      .put(`/api/platform/admin/tenants/${t.id}/billing-fee`)
      .set("Authorization", auth(platformAdmin))
      .send({ billing_fee_percentage: 8.5 });

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.data.billing_fee_percentage)).toBe(8.5);

    const row = (
      await query("SELECT billing_fee_percentage FROM tenants WHERE id = $1", [t.id])
    ).rows[0];
    expect(parseFloat(row.billing_fee_percentage)).toBe(8.5);
  });

  it("rejects an out-of-range percentage", async () => {
    const t = await createTenant();
    const platformAdmin = await createUser(t.id, {
      role: "admin",
      is_platform_admin: true,
    });
    const res = await request(app)
      .put(`/api/platform/admin/tenants/${t.id}/billing-fee`)
      .set("Authorization", auth(platformAdmin))
      .send({ billing_fee_percentage: 150 });
    expect(res.status).toBe(400);
  });

  it("forbids a non-platform-admin", async () => {
    const t = await createTenant();
    const staff = await createUser(t.id, { role: "admin" }); // tenant admin, not platform
    const res = await request(app)
      .put(`/api/platform/admin/tenants/${t.id}/billing-fee`)
      .set("Authorization", auth(staff))
      .send({ billing_fee_percentage: 7 });
    expect(res.status).toBe(403);
  });
});
