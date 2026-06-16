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

  it("returns default settings and saves overrides", async () => {
    const { admin } = await setup();
    const def = await request(app).get("/api/pawn/settings").set("Authorization", auth(admin));
    expect(def.status).toBe(200);
    expect(def.body.data.default_ltv_percent).toBe(50);
    expect(def.body.data.auction_notice_days).toBe(14);

    const put = await request(app).put("/api/pawn/settings").set("Authorization", auth(admin))
      .send({ default_ltv_percent: 65, default_monthly_fee_percent: 8, default_duration_months: 2, grace_days: 3, auction_notice_days: 7 });
    expect(put.status).toBe(200);
    const after = await request(app).get("/api/pawn/settings").set("Authorization", auth(admin));
    expect(Number(after.body.data.default_ltv_percent)).toBe(65);
    expect(after.body.data.auction_notice_days).toBe(7);
  });

  it("builds the accounting view: balances + a cash journal", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const created = (await newPawn(admin, pkg, c.id)).body.data; // 12,000 cash out

    const r = await request(app).get("/api/pawn/accounting").set("Authorization", auth(admin));
    expect(r.status).toBe(200);
    const a = r.body.data.accounts;
    expect(a.principal_disbursed).toBe(12000);
    expect(a.loans_receivable).toBe(12120); // nothing repaid yet
    expect(a.collateral_held).toBe(20000); // appraised value of the held item
    expect(a.cash_available).toBe(988000); // 1,000,000 - 12,000

    // Journal has the disbursement as Receivable↑ / Cash↓.
    const disb = r.body.data.journal.find((j) => j.ref === created.loan.loan_code);
    expect(disb).toBeTruthy();
    expect(disb.debit).toBe("Pawn Loans Receivable");
    expect(disb.credit).toBe("Cash");
    expect(disb.amount).toBe(12000);
  });

  it("books a pledge to a branch and filters list + summary by it", async () => {
    const { t, admin, pkg } = await setup();
    const c1 = await createClient(t.id);
    const c2 = await createClient(t.id);
    const branchA = (await query(`INSERT INTO branches (tenant_id, name, active) VALUES ($1,'Downtown',true) RETURNING id`, [t.id])).rows[0].id;
    const branchB = (await query(`INSERT INTO branches (tenant_id, name, active) VALUES ($1,'Uptown',true) RETURNING id`, [t.id])).rows[0].id;
    await newPawn(admin, pkg, c1.id, { branch_id: branchA });
    await newPawn(admin, pkg, c2.id, { branch_id: branchB });

    const all = await request(app).get("/api/pawn").set("Authorization", auth(admin));
    expect(all.body.data).toHaveLength(2);

    const onlyA = await request(app).get(`/api/pawn?branch_id=${branchA}`).set("Authorization", auth(admin));
    expect(onlyA.body.data).toHaveLength(1);
    expect(onlyA.body.data[0].branch_id).toBe(branchA);
    expect(onlyA.body.data[0].branch_name).toBe("Downtown");

    const sumB = await request(app).get(`/api/pawn/summary?branch_id=${branchB}`).set("Authorization", auth(admin));
    expect(sumB.body.data.active_pledges).toBe(1);
    expect(sumB.body.data.collateral_value).toBe(20000); // one item held at Uptown
  });

  it("404s a photo upload for a nonexistent pledge", async () => {
    const { admin } = await setup();
    const res = await request(app).post("/api/pawn/999999/photos").set("Authorization", auth(admin));
    expect(res.status).toBe(404);
  });

  it("rejects an out-of-range LTV", async () => {
    const { admin } = await setup();
    const res = await request(app).put("/api/pawn/settings").set("Authorization", auth(admin)).send({ default_ltv_percent: 150 });
    expect(res.status).toBe(400);
  });

  it("counts auction-due pledges using the notice period", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const created = (await newPawn(admin, pkg, c.id)).body.data;
    // Push maturity 30 days into the past so it's well overdue.
    await query("UPDATE loans SET end_date = CURRENT_DATE - 30 WHERE id=$1", [created.loan.id]);
    await request(app).put("/api/pawn/settings").set("Authorization", auth(admin)).send({ auction_notice_days: 14, grace_days: 0 });

    const sum = await request(app).get("/api/pawn/summary").set("Authorization", auth(admin));
    expect(sum.body.data.overdue).toBe(1);
    expect(sum.body.data.auction_due).toBe(1); // overdue beyond the 14-day notice

    // Widen the notice past the overdue age → no longer auction-due.
    await request(app).put("/api/pawn/settings").set("Authorization", auth(admin)).send({ auction_notice_days: 60 });
    const sum2 = await request(app).get("/api/pawn/summary").set("Authorization", auth(admin));
    expect(sum2.body.data.overdue).toBe(1);
    expect(sum2.body.data.auction_due).toBe(0);
  });
});
