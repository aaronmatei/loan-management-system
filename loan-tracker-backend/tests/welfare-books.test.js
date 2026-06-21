// Welfare Books of Accounts (/welfares/:id/books) — Receipts & Payments,
// Income & Expenditure, Balance Sheet and Trial Balance must balance exactly and
// reconcile with the pool: pool_cash + loans_receivable = savings + surplus.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import jwt from "jsonwebtoken";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);
const customerToken = (pcId, tenantId) => "Bearer " + jwt.sign({ platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null }, process.env.JWT_SECRET, { expiresIn: "1h" });
const pcIdByPhone = (phone) => query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone]).then((r) => r.rows[0].id);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0795800101", id_number: "BKM1" })).body.data;
  return { t, admin, w, m };
}
const books = (w, admin, year) => request(app).get(`/api/welfares/${w.id}/reports/books${year ? `?year=${year}` : ""}`).set("Authorization", auth(admin)).then((r) => r.body.data);

describe("welfare books of accounts", () => {
  it("balances and reconciles, with loan interest in the surplus", async () => {
    const { admin, w, m } = await setup();
    // Savings.
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    // A flat loan, fully repaid: 12000 principal + 720 interest.
    const L = `/api/welfares/${w.id}/loans`;
    const id = (await request(app).post(L).set("Authorization", auth(admin)).send({ member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12 })).body.data.id;
    await request(app).post(`${L}/${id}/approve`).set("Authorization", auth(admin)).send({});
    await request(app).post(`${L}/${id}/disburse`).set("Authorization", auth(admin)).send({});
    await request(app).post(`${L}/${id}/payments`).set("Authorization", auth(admin)).send({ amount: 12720 });

    const b = await books(w, admin);

    // Balance sheet balances.
    expect(b.balance_sheet.assets.total).toBeCloseTo(b.balance_sheet.members_funds.total, 1);
    // Trial balance ties.
    expect(b.trial_balance.debit_total).toBeCloseTo(b.trial_balance.credit_total, 1);

    // Savings untouched by interest; surplus = the 720 loan interest.
    expect(b.balance_sheet.members_funds.members_savings).toBeCloseTo(50000, 1);
    expect(b.income_expenditure.income.loan_interest).toBeCloseTo(720, 1);
    expect(b.income_expenditure.accumulated_surplus).toBeCloseTo(720, 1);
    // Loan fully repaid → no receivable; pool = 50000 + 720.
    expect(b.balance_sheet.assets.member_loans_receivable).toBeCloseTo(0, 1);
    expect(b.balance_sheet.assets.pool_cash).toBeCloseTo(50720, 1);
  });

  it("shows an outstanding loan as a receivable and still balances mid-loan", async () => {
    const { admin, w, m } = await setup();
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    const L = `/api/welfares/${w.id}/loans`;
    const id = (await request(app).post(L).set("Authorization", auth(admin)).send({ member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12 })).body.data.id;
    await request(app).post(`${L}/${id}/approve`).set("Authorization", auth(admin)).send({});
    await request(app).post(`${L}/${id}/disburse`).set("Authorization", auth(admin)).send({}); // disbursed, not yet repaid

    const b = await books(w, admin);
    // 12000 is out on loan → receivable 12000, pool cash 38000, still balances.
    expect(b.balance_sheet.assets.member_loans_receivable).toBeCloseTo(12000, 1);
    expect(b.balance_sheet.assets.pool_cash).toBeCloseTo(38000, 1);
    expect(b.balance_sheet.assets.total).toBeCloseTo(b.balance_sheet.members_funds.total, 1);
    expect(b.trial_balance.debit_total).toBeCloseTo(b.trial_balance.credit_total, 1);
  });

  it("scopes performance to the financial year and balances as at year-end", async () => {
    const { admin, w, m } = await setup();
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });

    const all = await books(w, admin);
    const y2026 = await books(w, admin, 2026); // all activity is in 2026
    expect(y2026.period.label).toBe("FY 2026");
    expect(y2026.period.available_years).toContain(2026);
    expect(y2026.income_expenditure.income.total).toBeCloseTo(all.income_expenditure.income.total, 1);
    expect(y2026.balance_sheet.assets.total).toBeCloseTo(all.balance_sheet.assets.total, 1);

    // A prior year: no activity → zero performance, position as at that year-end is nil, still balances.
    const y2025 = await books(w, admin, 2025);
    expect(y2025.income_expenditure.income.total).toBeCloseTo(0, 1);
    expect(y2025.receipts_payments.total_receipts).toBeCloseTo(0, 1);
    expect(y2025.balance_sheet.assets.total).toBeCloseTo(0, 1);
    expect(y2025.balance_sheet.assets.total).toBeCloseTo(y2025.balance_sheet.members_funds.total, 1);
  });

  it("a welfare member sees the same books in the portal", async () => {
    const { admin, w, m } = await setup();
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    const tenantId = (await query("SELECT tenant_id FROM groups WHERE id=$1", [w.id])).rows[0].tenant_id;
    const tok = customerToken(await pcIdByPhone("+254795800101"), tenantId);
    const r = await request(app).get("/api/welfare/member/books").set("Authorization", tok);
    expect(r.status).toBe(200);
    expect(r.body.data.balance_sheet.assets.total).toBeCloseTo(r.body.data.balance_sheet.members_funds.total, 1);
    expect(r.body.data.balance_sheet.members_funds.members_savings).toBeCloseTo(50000, 1);
  });
});
