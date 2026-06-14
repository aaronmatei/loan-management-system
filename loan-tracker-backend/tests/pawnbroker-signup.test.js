// Pawnbroker self-signup: registers its own account (a tenant of
// kind='pawnbroker') + admin user + capital pool, then logs in. Pawn-only,
// separate from lender/welfare tenants.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";

afterAll(closePool);

const PASS = "Pawnshop@2026xy";

function payload(over = {}) {
  return {
    business_name: "QuickCash Pawn",
    subdomain: "quickcash-pawn",
    contact_name: "Sam Broker",
    contact_email: "sam@quickcash.example",
    admin_password: PASS,
    ...over,
  };
}

describe("pawnbroker self-signup", () => {
  it("creates a pawnbroker account + admin + capital pool, and returns a token", async () => {
    const res = await request(app).post("/api/tenants/pawnbroker-signup").send(payload());
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.tenant.kind).toBe("pawnbroker");

    const tenantId = res.body.user.tenant_id;
    const tenant = (await query("SELECT kind, business_type FROM tenants WHERE id = $1", [tenantId])).rows[0];
    expect(tenant.kind).toBe("pawnbroker");
    // A capital pool exists (pawns draw cash from it).
    const pool = (await query("SELECT id FROM capital_pool WHERE tenant_id = $1", [tenantId])).rows;
    expect(pool).toHaveLength(1);
    // A Main branch was seeded for client creation.
    const branch = (await query("SELECT id FROM branches WHERE tenant_id = $1 AND is_default = true", [tenantId])).rows;
    expect(branch.length).toBeGreaterThan(0);
  });

  it("lets the pawnbroker admin log in, and login reports kind='pawnbroker'", async () => {
    await request(app).post("/api/tenants/pawnbroker-signup").send(
      payload({ subdomain: "goldcash-pawn", contact_email: "lead@goldcash.example" }),
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "lead@goldcash.example", password: PASS });
    expect(login.status).toBe(200);
    expect(login.body.user.tenant.kind).toBe("pawnbroker");
    expect(login.body.user.role).toBe("admin");
  });

  it("rejects a duplicate subdomain and weak passwords", async () => {
    await request(app).post("/api/tenants/pawnbroker-signup").send(payload({ subdomain: "dup-pawn", contact_email: "a@dp.example" }));
    const dup = await request(app).post("/api/tenants/pawnbroker-signup").send(payload({ subdomain: "dup-pawn", contact_email: "b@dp.example" }));
    expect(dup.status).toBe(409);
    const weak = await request(app).post("/api/tenants/pawnbroker-signup").send(payload({ subdomain: "weak-pawn", contact_email: "w@dp.example", admin_password: "weak" }));
    expect(weak.status).toBe(400);
  });
});
