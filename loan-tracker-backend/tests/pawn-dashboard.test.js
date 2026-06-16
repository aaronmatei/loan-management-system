// Pawn admin standalone shell: the pledge list (GET /api/pawn) and the
// dashboard summary (GET /api/pawn/summary) that power the pawn vertical.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function pawnPackage(tenantId) {
  return (await query(
    `INSERT INTO loan_packages (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method, min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
     VALUES ($1, 'Pawn Standard', 12, 0, 'flat', 100, 1000000, 1, 6, 'pawn') RETURNING *`,
    [tenantId],
  )).rows[0];
}
async function seedPool(tenantId) {
  await query("INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 1000000, 0, 0)", [tenantId]);
}
async function setup() {
  const t = await createTenant();
  await seedPool(t.id);
  const admin = await createUser(t.id, { role: "admin" });
  const pkg = await pawnPackage(t.id);
  return { t, admin, pkg };
}
const newPawn = (admin, pkg, clientId, over = {}) =>
  request(app).post("/api/pawn").set("Authorization", auth(admin)).send({
    client_id: clientId, package_id: pkg.id, appraised_value: 20000, ltv_percent: 60,
    duration_months: 1, item_description: "iPhone 13", item_category: "Electronics", ...over,
  });

describe("pawn dashboard + pledge list", () => {
  it("lists pledges with item, balance and overdue flag", async () => {
    const { t, admin, pkg } = await setup();
    const client = await createClient(t.id);
    const created = (await newPawn(admin, pkg, client.id)).body.data;

    const res = await request(app).get("/api/pawn").set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.id === created.loan.id);
    expect(row).toBeTruthy();
    expect(row.item).toBe("iPhone 13");
    expect(row.collateral_status).toBe("held");
    expect(row.balance).toBe(12120); // nothing paid yet
    expect(row.overdue).toBe(false);
  });

  it("summarises active pledges, cash out and collateral value", async () => {
    const { t, admin, pkg } = await setup();
    const c1 = await createClient(t.id);
    const c2 = await createClient(t.id);
    await newPawn(admin, pkg, c1.id, { appraised_value: 20000, ltv_percent: 60 }); // 12,000 cash
    await newPawn(admin, pkg, c2.id, { appraised_value: 10000, ltv_percent: 50 }); // 5,000 cash

    const res = await request(app).get("/api/pawn/summary").set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.active_pledges).toBe(2);
    expect(d.cash_out).toBe(17000);
    expect(d.collateral_value).toBe(30000); // 20,000 + 10,000 held
    expect(d.capital_available).toBe(983000); // 1,000,000 - 17,000 disbursed
  });

  it("reflects a redemption in the summary (item no longer counted as held)", async () => {
    const { t, admin, pkg } = await setup();
    const client = await createClient(t.id);
    const created = (await newPawn(admin, pkg, client.id)).body.data;
    await request(app).post(`/api/pawn/${created.loan.id}/redeem`).set("Authorization", auth(admin)).send({});

    const res = await request(app).get("/api/pawn/summary").set("Authorization", auth(admin));
    expect(res.body.data.active_pledges).toBe(0);
    expect(res.body.data.collateral_value).toBe(0); // returned, not held
    expect(res.body.data.redeemed_today).toBe(1);
  });

  it("scopes the list to the tenant", async () => {
    const a = await setup();
    const b = await setup();
    const ca = await createClient(a.t.id);
    await newPawn(a.admin, a.pkg, ca.id);

    const res = await request(app).get("/api/pawn").set("Authorization", auth(b.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0); // tenant B sees none of A's pledges
  });
});
