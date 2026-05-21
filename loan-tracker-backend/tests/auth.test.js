// Integration tests for the auth endpoints, hitting the real Express app
// and the loan_tracker_test database via Supertest.
import request from "supertest";
import app from "../src/app.js";
import {
  truncate,
  seedTenant,
  seedUser,
  tokenFor,
  query,
  closePool,
} from "./helpers/db.js";

const CREDS = { email: "tester@testlender.test", password: "TestPass1234!" };

// The tenant seeded for each test; register tests create users inside it.
let tenant;

beforeEach(async () => {
  await truncate();
  tenant = await seedTenant();
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

describe("POST /api/auth/register (admin-gated)", () => {
  const NEW_USER = {
    username: "newstaff",
    email: "newstaff@testlender.test",
    password: "NewStaff1234!",
    first_name: "New",
    last_name: "Staff",
    role: "loan_officer",
  };

  // Create an admin in the seeded tenant and return a bearer token for it.
  async function adminToken() {
    const admin = await seedUser({
      tenant_id: tenant.id,
      username: "admin1",
      email: "admin1@testlender.test",
      role: "admin",
    });
    return tokenFor(admin);
  }

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/api/auth/register").send(NEW_USER);
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin (loan_officer) with 403", async () => {
    const officer = await seedUser({
      tenant_id: tenant.id,
      username: "officer1",
      email: "officer1@testlender.test",
      role: "loan_officer",
    });
    const res = await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${tokenFor(officer)}`)
      .send(NEW_USER);
    expect(res.status).toBe(403);
  });

  it("lets an admin create a user inside their own tenant (201)", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${token}`)
      .send(NEW_USER);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({
      email: NEW_USER.email,
      role: "loan_officer",
      tenant_id: tenant.id,
    });

    // tenant_id was taken from the admin's token, not the request body.
    const { rows } = await query(
      "SELECT tenant_id FROM users WHERE email = $1",
      [NEW_USER.email],
    );
    expect(rows[0].tenant_id).toBe(tenant.id);
  });

  it("rejects a weak password with 400", async () => {
    const token = await adminToken();
    const res = await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...NEW_USER, password: "weak" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email/username with 409", async () => {
    const token = await adminToken();
    await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${token}`)
      .send(NEW_USER);
    const res = await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${token}`)
      .send(NEW_USER);
    expect(res.status).toBe(409);
  });

  it("can log in with the newly registered credentials", async () => {
    const token = await adminToken();
    await request(app)
      .post("/api/auth/register")
      .set("Authorization", `Bearer ${token}`)
      .send(NEW_USER);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: NEW_USER.email, password: NEW_USER.password });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });
});
