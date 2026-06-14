// Vehicle security for logbook loans: a logbook-type loan (created through the
// standard /api/loans flow) carries a pledged vehicle whose logbook is held
// under a lien. Staff record/edit the vehicle, release the lien on repayment,
// or repossess on default.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function logbookPackage(tenantId) {
  const r = await query(
    `INSERT INTO loan_packages
       (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method,
        min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
     VALUES ($1, 'Logbook Loan', 36, 0, 'flat', 1000, 5000000, 1, 24, 'logbook')
     RETURNING *`,
    [tenantId],
  );
  return r.rows[0];
}

async function seedPool(tenantId) {
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 5000000, 0, 0)",
    [tenantId],
  );
}

// Create a logbook-type loan via the standard flow and return its id.
async function createLogbookLoan(admin, pkg, client) {
  const res = await request(app)
    .post("/api/loans")
    .set("Authorization", auth(admin))
    .send({
      client_id: client.id,
      package_id: pkg.id,
      principal_amount: 500000,
      loan_duration_months: 12,
    });
  expect(res.status).toBe(201);
  expect(res.body.data.loan_type).toBe("logbook");
  return res.body.data.id;
}

const VEHICLE = {
  make: "Toyota",
  model: "Premio",
  year: 2015,
  registration_number: "kca 123a",
  logbook_number: "LB-99887",
  chassis_number: "CHS-1234",
  engine_number: "ENG-5678",
  color: "Silver",
  valuation: 900000,
  storage_location: "Safe drawer 2",
};

describe("vehicle security (logbook loans)", () => {
  it("records a vehicle on a logbook loan (reg normalized, lien active)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);

    const res = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);
    expect(res.status).toBe(201);
    const v = res.body.data;
    expect(v.registration_number).toBe("KCA 123A"); // uppercased
    expect(v.lien_status).toBe("active");
    expect(v.logbook_held).toBe(true);
    expect(Number(v.valuation)).toBe(900000);
  });

  it("upserts — a second POST updates the same row, not a duplicate", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);

    await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);
    await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send({ ...VEHICLE, color: "Black", valuation: 850000 });

    const rows = (
      await query("SELECT * FROM loan_vehicle_security WHERE loan_id = $1", [loanId])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].color).toBe("Black");
    expect(Number(rows[0].valuation)).toBe(850000);
  });

  it("requires a registration number and a positive valuation", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);

    const noReg = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send({ ...VEHICLE, registration_number: "" });
    expect(noReg.status).toBe(400);

    const noVal = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send({ ...VEHICLE, valuation: 0 });
    expect(noVal.status).toBe(400);
  });

  it("rejects vehicle security on a non-logbook loan", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    // A plain personal loan (no logbook package).
    const create = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 10000,
        annual_interest_rate: 24,
        loan_duration_months: 6,
      });
    const personalId = create.body.data.id;

    const res = await request(app)
      .post(`/api/loans/${personalId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);
    expect(res.status).toBe(404);
  });

  it("releases the lien (logbook returned)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);
    await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);

    const res = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security/release`)
      .set("Authorization", auth(admin))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.lien_status).toBe("released");
    expect(res.body.data.logbook_held).toBe(false);
    expect(res.body.data.released_at).toBeTruthy();
  });

  it("repossesses the vehicle on default", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);
    await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);

    const res = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security/repossess`)
      .set("Authorization", auth(admin))
      .send({ notes: "Borrower unreachable for 90 days" });
    expect(res.status).toBe(200);
    expect(res.body.data.lien_status).toBe("repossessed");
    expect(res.body.data.repossessed_at).toBeTruthy();
  });

  it("blocks a loan_officer from releasing or repossessing (admin/manager only)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);
    // Officer CAN record the vehicle...
    const rec = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(officer))
      .send(VEHICLE);
    expect(rec.status).toBe(201);
    // ...but NOT release it.
    const rel = await request(app)
      .post(`/api/loans/${loanId}/vehicle-security/release`)
      .set("Authorization", auth(officer))
      .send({});
    expect(rel.status).toBe(403);
  });

  it("generates a vehicle security certificate PDF", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await logbookPackage(t.id);
    const loanId = await createLogbookLoan(admin, pkg, client);
    await request(app)
      .post(`/api/loans/${loanId}/vehicle-security`)
      .set("Authorization", auth(admin))
      .send(VEHICLE);

    const res = await request(app)
      .get(`/api/loans/${loanId}/vehicle-security/certificate`)
      .set("Authorization", auth(admin))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
