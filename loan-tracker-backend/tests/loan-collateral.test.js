// Loan against collateral via the standard lender flow: any lender can attach a
// structured pledge to a normal /api/loans application. The loan is stored as
// loan_type='pawn' (shared collateral lifecycle) with a 'held' loan_collateral
// row — no separate pawn vertical needed.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function setup() {
  const tenant = await createTenant();
  const admin = await createUser(tenant.id, { role: "admin" });
  const client = await createClient(tenant.id);
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 5000000, 0, 0)",
    [tenant.id],
  );
  return { tenant, admin, client };
}

const COLLATERAL = {
  category: "jewelry",
  description: "Gold ring, 18k",
  serial_number: "RING-001",
  condition: "good",
  appraised_value: 80000,
  ltv_percent: 50,
  storage_location: "Safe drawer 1",
  photos: ["https://img/1.jpg", "https://img/2.jpg"],
};

describe("loan against collateral (standard flow)", () => {
  it("tags loan_type='pawn' and stores the pledge as held", async () => {
    const { admin, client } = await setup();
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 40000,
        annual_interest_rate: 48,
        loan_duration_months: 6,
        loan_type: "pawn",
        collateral: COLLATERAL,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.loan_type).toBe("pawn");

    const col = (
      await query("SELECT * FROM loan_collateral WHERE loan_id = $1", [res.body.data.id])
    ).rows[0];
    expect(col).toBeTruthy();
    expect(col.status).toBe("held");
    expect(col.description).toBe("Gold ring, 18k");
    expect(Number(col.appraised_value)).toBe(80000);
    expect(col.photos).toHaveLength(2);
  });

  it("infers a collateral loan from the pledge even without loan_type", async () => {
    const { admin, client } = await setup();
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 40000,
        annual_interest_rate: 48,
        loan_duration_months: 6,
        collateral: COLLATERAL,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.loan_type).toBe("pawn");
  });

  it("rejects a collateral loan with no item described", async () => {
    const { admin, client } = await setup();
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 40000,
        annual_interest_rate: 48,
        loan_duration_months: 6,
        loan_type: "pawn",
        collateral: { appraised_value: 80000 },
      });
    expect(res.status).toBe(400);
  });

  it("rejects a collateral loan with a non-positive appraised value", async () => {
    const { admin, client } = await setup();
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 40000,
        annual_interest_rate: 48,
        loan_duration_months: 6,
        loan_type: "pawn",
        collateral: { description: "Gold ring", appraised_value: 0 },
      });
    expect(res.status).toBe(400);
  });

  it("a normal loan stays personal with no collateral row", async () => {
    const { admin, client } = await setup();
    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        principal_amount: 40000,
        annual_interest_rate: 48,
        loan_duration_months: 6,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.loan_type).toBe("personal");
    const n = (
      await query("SELECT COUNT(*)::int AS n FROM loan_collateral WHERE loan_id = $1", [
        res.body.data.id,
      ])
    ).rows[0].n;
    expect(n).toBe(0);
  });
});
