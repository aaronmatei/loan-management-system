// Pawn / collateral loans: a pawn package drives a bullet loan whose amount is
// capped at LTV% of the appraised value, with a flat fee. Creating one disburses
// immediately (no application workflow); redeeming pays it off and returns the
// item; forfeiting defaults the loan and keeps (optionally sells) the item.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

// Create a pawn-type package (12% p.a. → 1%/month flat fee) for a tenant.
async function pawnPackage(tenantId) {
  const r = await query(
    `INSERT INTO loan_packages
       (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method,
        min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
     VALUES ($1, 'Pawn Standard', 12, 0, 'flat', 100, 1000000, 1, 6, 'pawn')
     RETURNING *`,
    [tenantId],
  );
  return r.rows[0];
}

async function seedPool(tenantId) {
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 1000000, 0, 0)",
    [tenantId],
  );
}

describe("pawn loans", () => {
  it("creates a pawn loan capped at LTV, with a flat fee and a single bullet schedule", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const res = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        item_description: "Apple iPhone 13 Pro",
        item_category: "Electronics",
        serial_number: "IMEI-123",
        item_condition: "Good",
        storage_location: "Safe A",
      });
    expect(res.status).toBe(201);
    const { loan, collateral } = res.body.data;

    // 60% of 20,000 = 12,000 principal; 1%/mo × 1mo = 120 fee; 12,120 due.
    expect(Number(loan.principal_amount)).toBe(12000);
    expect(Number(loan.total_interest)).toBe(120);
    expect(Number(loan.total_amount_due)).toBe(12120);
    expect(loan.status).toBe("active");
    expect(loan.loan_type).toBe("pawn");

    // Collateral recorded and held.
    expect(collateral.status).toBe("held");
    expect(Number(collateral.appraised_value)).toBe(20000);
    expect(Number(collateral.ltv_percent)).toBe(60);

    // A single bullet schedule due at maturity.
    const sched = (
      await query("SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number", [loan.id])
    ).rows;
    expect(sched).toHaveLength(1);
    expect(Number(sched[0].amount_due)).toBe(12120);

    // Capital pool: only the advanced principal goes out.
    const pool = (
      await query("SELECT total_disbursed FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(pool.total_disbursed)).toBe(12000);
  });

  it("rejects a loan amount above the LTV ceiling", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const res = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 50,
        principal_amount: 15000, // > 50% of 20,000
        item_description: "Gold chain",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a non-pawn package", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const personal = (
      await query(
        `INSERT INTO loan_packages
           (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method,
            min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
         VALUES ($1, 'Personal', 24, 0, 'flat', 100, 1000000, 1, 12, 'personal') RETURNING *`,
        [t.id],
      )
    ).rows[0];

    const res = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: personal.id,
        appraised_value: 20000,
        item_description: "Laptop",
      });
    expect(res.status).toBe(400);
  });

  it("redeems a pawn loan: pays it off, completes the loan, returns the item, recovers capital", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const created = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        item_description: "Apple iPhone 13 Pro",
      });
    const loanId = created.body.data.loan.id;

    const redeem = await request(app)
      .post(`/api/pawn/${loanId}/redeem`)
      .set("Authorization", auth(admin))
      .send({ payment_method: "Cash" }); // amount omitted → full outstanding
    expect(redeem.status).toBe(200);
    expect(redeem.body.redeemed).toBe(true);

    const loan = (await query("SELECT status FROM loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("completed");
    const col = (await query("SELECT status FROM loan_collateral WHERE loan_id = $1", [loanId])).rows[0];
    expect(col.status).toBe("returned");

    const pool = (
      await query("SELECT total_collected, total_interest_earned FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(pool.total_collected)).toBe(12000); // principal recovered
    expect(Number(pool.total_interest_earned)).toBe(120); // flat fee earned
  });

  it("forfeits an unredeemed pawn: defaults the loan and forfeits the item", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const created = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        item_description: "Apple iPhone 13 Pro",
      });
    const loanId = created.body.data.loan.id;

    const forfeit = await request(app)
      .post(`/api/pawn/${loanId}/forfeit`)
      .set("Authorization", auth(admin))
      .send({}); // not sold
    expect(forfeit.status).toBe(200);
    expect(forfeit.body.sold).toBe(false);

    const loan = (await query("SELECT status FROM loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("defaulted");
    const col = (await query("SELECT status FROM loan_collateral WHERE loan_id = $1", [loanId])).rows[0];
    expect(col.status).toBe("forfeited");
  });

  it("forfeits with a sale: marks the item sold and recovers the sale amount as capital", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const created = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        item_description: "Apple iPhone 13 Pro",
      });
    const loanId = created.body.data.loan.id;

    const forfeit = await request(app)
      .post(`/api/pawn/${loanId}/forfeit`)
      .set("Authorization", auth(admin))
      .send({ sale_amount: 14000 });
    expect(forfeit.status).toBe(200);
    expect(forfeit.body.sold).toBe(true);

    const col = (
      await query("SELECT status, sale_amount FROM loan_collateral WHERE loan_id = $1", [loanId])
    ).rows[0];
    expect(col.status).toBe("sold");
    expect(Number(col.sale_amount)).toBe(14000);

    const pool = (
      await query("SELECT total_collected FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(pool.total_collected)).toBe(14000);
  });

  it("blocks a loan_officer from forfeiting (admin/manager only)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const client = await createClient(t.id);
    const pkg = await pawnPackage(t.id);

    const created = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        appraised_value: 20000,
        ltv_percent: 60,
        item_description: "Apple iPhone 13 Pro",
      });
    const loanId = created.body.data.loan.id;

    const forfeit = await request(app)
      .post(`/api/pawn/${loanId}/forfeit`)
      .set("Authorization", auth(officer))
      .send({});
    expect(forfeit.status).toBe(403);
  });

  it("creates a custom pawn with NO package (fee set directly)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    const res = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id, // no package_id
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        monthly_fee_percent: 10,
        item_description: "Gold ring",
      });
    expect(res.status).toBe(201);
    const { loan } = res.body.data;
    expect(loan.package_id).toBeNull();
    expect(loan.loan_type).toBe("pawn");
    expect(Number(loan.principal_amount)).toBe(12000); // 60% of 20,000
    expect(Number(loan.total_interest)).toBe(1200); // 10% × 12,000 × 1mo
    expect(Number(loan.total_amount_due)).toBe(13200);
  });

  it("rejects a custom pawn with neither a package nor a fee", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);

    const res = await request(app)
      .post("/api/pawn")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        appraised_value: 20000,
        ltv_percent: 60,
        duration_months: 1,
        item_description: "Gold ring",
      });
    expect(res.status).toBe(400);
  });
});
