// Salary / check-off advances: a salary-type loan (standard /api/loans flow)
// carries employer + payslip details, an affordability assessment (instalment
// vs a capped share of net pay), and a check-off instruction lifecycle.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function salaryPackage(tenantId) {
  const r = await query(
    `INSERT INTO loan_packages
       (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method,
        min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
     VALUES ($1, 'Salary Advance', 36, 0, 'flat', 1000, 5000000, 1, 24, 'salary')
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

async function createSalaryLoan(admin, pkg, client, principal = 60000) {
  const res = await request(app)
    .post("/api/loans")
    .set("Authorization", auth(admin))
    .send({
      client_id: client.id,
      package_id: pkg.id,
      principal_amount: principal,
      loan_duration_months: 12,
    });
  expect(res.status).toBe(201);
  expect(res.body.data.loan_type).toBe("salary");
  return res.body.data.id;
}

const EMPLOYER = {
  employer_name: "Acme Ltd",
  employer_contact: "hr@acme.example",
  staff_number: "EMP-001",
  net_monthly_pay: 80000,
  payday_day: 28,
  max_deduction_percent: 50,
};

describe("salary advances (check-off)", () => {
  it("records salary details and returns an affordability assessment", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);

    const res = await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send(EMPLOYER);
    expect(res.status).toBe(201);
    expect(res.body.data.check_off_status).toBe("pending");
    const a = res.body.affordability;
    expect(a.installment).toBeGreaterThan(0);
    expect(a.affordable_ceiling).toBe(40000); // 50% of 80,000
    expect(a.affordable).toBe(true);
  });

  it("flags an unaffordable deduction when net pay is too low", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);

    const res = await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send({ ...EMPLOYER, net_monthly_pay: 8000 });
    expect(res.status).toBe(201);
    // 50% of 8,000 = 4,000 ceiling; the instalment on a 60k/12mo loan exceeds it.
    expect(res.body.affordability.affordable).toBe(false);
  });

  it("upserts — a second POST updates the same row", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);

    await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send(EMPLOYER);
    await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send({ ...EMPLOYER, employer_name: "Globex Ltd", net_monthly_pay: 95000 });

    const rows = (
      await query("SELECT * FROM loan_salary_details WHERE loan_id = $1", [loanId])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].employer_name).toBe("Globex Ltd");
    expect(Number(rows[0].net_monthly_pay)).toBe(95000);
  });

  it("validates employer name, net pay, payday and cap", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);
    const post = (body) =>
      request(app)
        .post(`/api/loans/${loanId}/salary-details`)
        .set("Authorization", auth(admin))
        .send(body);

    expect((await post({ ...EMPLOYER, employer_name: "" })).status).toBe(400);
    expect((await post({ ...EMPLOYER, net_monthly_pay: 0 })).status).toBe(400);
    expect((await post({ ...EMPLOYER, payday_day: 40 })).status).toBe(400);
    expect((await post({ ...EMPLOYER, max_deduction_percent: 150 })).status).toBe(400);
  });

  it("rejects salary details on a non-salary loan", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
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
      .post(`/api/loans/${personalId}/salary-details`)
      .set("Authorization", auth(admin))
      .send(EMPLOYER);
    expect(res.status).toBe(404);
  });

  it("activates and then stops the check-off", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);
    await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send(EMPLOYER);

    const act = await request(app)
      .post(`/api/loans/${loanId}/salary-details/activate`)
      .set("Authorization", auth(admin))
      .send({});
    expect(act.status).toBe(200);
    expect(act.body.data.check_off_status).toBe("active");
    expect(act.body.data.activated_at).toBeTruthy();

    const stop = await request(app)
      .post(`/api/loans/${loanId}/salary-details/stop`)
      .set("Authorization", auth(admin))
      .send({ notes: "Employee resigned" });
    expect(stop.status).toBe(200);
    expect(stop.body.data.check_off_status).toBe("stopped");
    expect(stop.body.data.stopped_at).toBeTruthy();
  });

  it("blocks a loan_officer from activating the check-off (admin/manager only)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);
    // Officer CAN record the details...
    const rec = await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(officer))
      .send(EMPLOYER);
    expect(rec.status).toBe(201);
    // ...but NOT activate the check-off.
    const act = await request(app)
      .post(`/api/loans/${loanId}/salary-details/activate`)
      .set("Authorization", auth(officer))
      .send({});
    expect(act.status).toBe(403);
  });

  it("generates a check-off authorization letter PDF", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await salaryPackage(t.id);
    const loanId = await createSalaryLoan(admin, pkg, client);
    await request(app)
      .post(`/api/loans/${loanId}/salary-details`)
      .set("Authorization", auth(admin))
      .send(EMPLOYER);

    const res = await request(app)
      .get(`/api/loans/${loanId}/salary-details/check-off-letter`)
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
