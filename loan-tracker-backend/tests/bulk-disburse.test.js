// Mass-disburse endpoint: routing (not captured by /:id/disburse),
// per-loan validation, and capital burn-down across the batch.
import request from "supertest";
import { describe, it, beforeAll, expect, afterAll } from "vitest";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { query } from "../src/config/database.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
} from "./helpers/factory.js";

afterAll(async () => {
  await pool.end();
});

async function seed(initialCapital = 1_000_000) {
  const tenant = await createTenant();
  const admin = await createUser(tenant.id, { role: "admin" });
  await query(
    `INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed,
       total_collected, total_interest_earned)
     VALUES ($1, $2, 0, 0, 0)`,
    [tenant.id, initialCapital],
  );
  return { tenant, admin, token: tokenFor(admin) };
}

describe("POST /api/loans/bulk/disburse", () => {
  let token;
  let tenantId;
  beforeAll(async () => {
    const s = await seed();
    token = s.token;
    tenantId = s.tenant.id;
  });

  it("routes to the bulk handler — does not fall into /:id/disburse with id='bulk'", async () => {
    // Empty items → 400 from the bulk handler, NOT 'Loan not found' from /:id.
    const res = await request(app)
      .post("/api/loans/bulk/disburse")
      .set("Authorization", `Bearer ${token}`)
      .send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No loans/i);
  });

  it("disburses multiple approved loans and skips non-approved ones", async () => {
    const client = await createClient(tenantId);
    const okLoan = await createLoan(tenantId, client.id, {
      status: "approved",
      principal_amount: 10000,
      total_amount_due: 11000,
    });
    const pendingLoan = await createLoan(tenantId, client.id, {
      status: "pending",
      principal_amount: 5000,
      total_amount_due: 5500,
    });
    const okLoan2 = await createLoan(tenantId, client.id, {
      status: "approved",
      principal_amount: 8000,
      total_amount_due: 8800,
    });

    const today = new Date().toISOString().split("T")[0];
    const res = await request(app)
      .post("/api/loans/bulk/disburse")
      .set("Authorization", `Bearer ${token}`)
      .send({
        items: [
          {
            id: okLoan.id,
            disbursement_method: "mpesa",
            disbursement_date: today,
          },
          {
            id: pendingLoan.id,
            disbursement_method: "cash",
            disbursement_date: today,
          },
          {
            id: okLoan2.id,
            disbursement_method: "bank_transfer",
            disbursement_date: today,
            disbursement_reference: "TXN-42",
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.details).toHaveLength(1);
    expect(res.body.details[0].reason).toMatch(/status pending/);

    const ok = await query(
      "SELECT status FROM loans WHERE id = ANY($1) ORDER BY id",
      [[okLoan.id, okLoan2.id]],
    );
    expect(ok.rows.every((r) => r.status === "active")).toBe(true);
  });

  it("burns capital down across the batch — second large loan skipped when pool runs dry", async () => {
    const s = await seed(15000); // pool only covers one of the two loans
    const client = await createClient(s.tenant.id);
    const a = await createLoan(s.tenant.id, client.id, {
      status: "approved",
      principal_amount: 10000,
      total_amount_due: 11000,
    });
    const b = await createLoan(s.tenant.id, client.id, {
      status: "approved",
      principal_amount: 10000,
      total_amount_due: 11000,
    });
    const res = await request(app)
      .post("/api/loans/bulk/disburse")
      .set("Authorization", `Bearer ${s.token}`)
      .send({
        items: [
          { id: a.id, disbursement_method: "cash" },
          { id: b.id, disbursement_method: "cash" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.details[0].reason).toMatch(/insufficient capital/);
  });
});
