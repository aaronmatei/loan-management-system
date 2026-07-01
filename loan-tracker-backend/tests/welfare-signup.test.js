// Welfare self-signup: a welfare registers its own account (a tenant of
// kind='welfare') + admin user + one welfare group, then logs in. Separate from
// lender tenants; login surfaces tenant.kind so the UI can show a welfare-only
// experience.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";

afterAll(closePool);

const PASS = "Welfare@2026xy";

function payload(over = {}) {
  return {
    welfare_name: "Umoja Welfare",
    subdomain: "umoja-welfare",
    contact_name: "Jane Chair",
    contact_email: "jane@umoja.example",
    contact_phone: "0700000000",
    admin_password: PASS,
    ...over,
  };
}

describe("welfare self-signup", () => {
  it("creates a welfare account + admin + one welfare group, pending approval", async () => {
    const res = await request(app).post("/api/tenants/welfare-signup").send(payload());
    expect(res.status).toBe(201);
    // New signups are created pending review — no auto-login token.
    expect(res.body.pending).toBe(true);
    expect(res.body.token).toBeFalsy();
    expect(res.body.welfare_group_id).toBeTruthy();
    const tenantId = res.body.tenant.id;

    const tenant = (await query("SELECT kind, status FROM tenants WHERE id = $1", [tenantId])).rows[0];
    expect(tenant.kind).toBe("welfare");
    expect(tenant.status).toBe("pending");

    const group = (await query("SELECT * FROM groups WHERE id = $1", [res.body.welfare_group_id])).rows[0];
    expect(group.tenant_id).toBe(tenantId);
    expect(group.group_code).toBe("GRP-00001");
  });

  it("blocks login until approved (pending)", async () => {
    await request(app).post("/api/tenants/welfare-signup").send(
      payload({ subdomain: "pend-welfare", contact_email: "pend@x.example" }),
    );
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "pend@x.example", password: PASS });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("TENANT_PENDING");
  });

  it("once approved, the welfare admin can log in, and login reports kind='welfare'", async () => {
    const signup = await request(app).post("/api/tenants/welfare-signup").send(
      payload({ subdomain: "imani-welfare", contact_email: "lead@imani.example" }),
    );
    await query("UPDATE tenants SET status = 'active' WHERE id = $1", [signup.body.tenant.id]);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "lead@imani.example", password: PASS });
    expect(login.status).toBe(200);
    expect(login.body.user.tenant.kind).toBe("welfare");
    expect(login.body.user.role).toBe("admin");
  });

  it("a lender signup stays kind='lender'", async () => {
    const res = await request(app).post("/api/tenants/signup").send({
      business_name: "Acme Credit",
      business_type: "microfinance",
      subdomain: "acme-credit",
      contact_name: "Sam Lender",
      contact_email: "sam@acme.example",
      admin_password: PASS,
    });
    expect(res.status).toBe(201);
    const tenant = (await query("SELECT kind FROM tenants WHERE id = $1", [res.body.tenant.id])).rows[0];
    expect(tenant.kind).toBe("lender");
  });

  it("rejects a duplicate subdomain", async () => {
    await request(app).post("/api/tenants/welfare-signup").send(payload({ subdomain: "dup-welfare", contact_email: "a@dup.example" }));
    const again = await request(app).post("/api/tenants/welfare-signup").send(payload({ subdomain: "dup-welfare", contact_email: "b@dup.example" }));
    expect(again.status).toBe(409);
  });

  it("enforces the password policy", async () => {
    const res = await request(app).post("/api/tenants/welfare-signup").send(payload({ subdomain: "weak-welfare", contact_email: "weak@x.example", admin_password: "weak" }));
    expect(res.status).toBe(400);
  });
});
