// Integration tests for the auth endpoints, hitting the real Express app
// and the loan_tracker_test database via Supertest.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, seedUser, closePool } from "./helpers/db.js";

const CREDS = { email: "tester@testlender.test", password: "TestPass1234!" };

beforeEach(async () => {
  await truncate();
  const tenant = await seedTenant();
  await seedUser({
    tenant_id: tenant.id,
    email: CREDS.email,
    password: CREDS.password,
  });
});

afterAll(closePool);

describe("POST /api/auth/login", () => {
  it("returns a JWT and the user for correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send(CREDS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.user).toMatchObject({
      email: CREDS.email,
      tenant_id: expect.any(Number),
    });
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ ...CREDS, password: "WrongPass1234!" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("rejects an unknown user with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@testlender.test", password: CREDS.password });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("rejects an inactive account with 401", async () => {
    await truncate();
    const tenant = await seedTenant();
    await seedUser({
      tenant_id: tenant.id,
      email: CREDS.email,
      password: CREDS.password,
      is_active: false,
    });

    const res = await request(app).post("/api/auth/login").send(CREDS);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Account is inactive");
  });

  it("requires both email and password (400)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: CREDS.email });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/register", () => {
  // KNOWN BUG surfaced by testing: register never sets users.tenant_id
  // (NOT NULL, FK to tenants) and its INSERT ... RETURNING references a
  // non-existent `full_name` column, so it 500s against the current
  // schema. Real user creation goes through tenant onboarding instead.
  // Convert this to a real test once register is fixed.
  it.todo(
    "register should set tenant_id and stop selecting the missing full_name column",
  );
});
