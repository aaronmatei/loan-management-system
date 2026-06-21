// Lender Books of Accounts (/api/books) — derived statements must BALANCE and
// reconcile with the capital model: assets = financed-by, trial-balance debits =
// credits, and net profit = interest − expenses − write-offs.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

describe("lender books of accounts", () => {
  it("produces balancing statements that reconcile with the capital pool", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    // Seed a capital pool + an operating expense + an active loan.
    await query(
      `INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned)
       VALUES ($1, 100000, 50000, 20000, 8000)`,
      [t.id],
    );
    await query(`INSERT INTO expenses (tenant_id, amount, description) VALUES ($1, 5000, 'Rent')`, [t.id]);
    const c = await createClient(t.id);
    await createLoan(t.id, c.id, { status: "active" });

    const r = await request(app).get("/api/books").set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    const b = r.body.data;

    // available = 100000 − 50000 + 20000 + 8000 − 5000 = 73000
    expect(b.capital.available_capital).toBeCloseTo(73000, 1);
    // outstanding principal = 50000 − 20000 − 0 = 30000
    expect(b.balance_sheet.assets.loans_receivable).toBeCloseTo(30000, 1);
    // net profit = 8000 − 5000 − 0 = 3000
    expect(b.income_statement.net_profit).toBeCloseTo(3000, 1);

    // Balance sheet balances: assets 103000 = capital 100000 + retained 3000.
    expect(b.balance_sheet.assets.total).toBeCloseTo(103000, 1);
    expect(b.balance_sheet.assets.total).toBeCloseTo(b.balance_sheet.financed_by.total, 1);

    // Trial balance balances: 73000 + 30000 + 5000 + 0 = 108000 = 100000 + 8000.
    expect(b.trial_balance.debit_total).toBeCloseTo(b.trial_balance.credit_total, 1);
    expect(b.trial_balance.debit_total).toBeCloseTo(108000, 1);

    // Income decomposition ties to the gross income kept.
    const inc = b.income_statement.income;
    expect(inc.loan_interest + inc.penalties + inc.processing_fees + inc.other).toBeCloseTo(inc.total, 1);

    // Portfolio reflects the active loan.
    expect(b.portfolio.by_status.active?.count).toBe(1);
  });

  it("404s when the tenant has no capital pool", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    expect((await request(app).get("/api/books").set("Authorization", auth(admin))).status).toBe(404);
  });
});
