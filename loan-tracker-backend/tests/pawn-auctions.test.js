// Pawn auction workflow: schedule an overdue pledge for auction, then complete
// the sale with settlement (recover what was owed into the pool, track surplus
// owed back to the customer or a deficiency shortfall), or cancel it.
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
     VALUES ($1, 'Pawn', 12, 0, 'flat', 100, 1000000, 1, 6, 'pawn') RETURNING *`, [tenantId])).rows[0];
}
async function setup() {
  const t = await createTenant();
  await query("INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 1000000, 0, 0)", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const pkg = await pawnPackage(t.id);
  return { t, admin, pkg };
}
// 20,000 value × 60% = 12,000 principal; 1%/mo × 1 = 120 fee → 12,120 due.
const newPawn = (admin, pkg, clientId) =>
  request(app).post("/api/pawn").set("Authorization", auth(admin)).send({
    client_id: clientId, package_id: pkg.id, appraised_value: 20000, ltv_percent: 60, duration_months: 1, item_description: "Ring",
  });
const poolCollected = async (tid) => Number((await query("SELECT total_collected FROM capital_pool WHERE tenant_id=$1", [tid])).rows[0].total_collected);

describe("pawn auction workflow", () => {
  it("schedules an auction: loan defaulted, item forfeited", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan;

    const res = await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({ reserve_price: 12000, auction_date: "2026-08-01" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("scheduled");

    const after = (await query("SELECT status FROM loans WHERE id=$1", [loan.id])).rows[0];
    expect(after.status).toBe("defaulted");
    const col = (await query("SELECT status FROM loan_collateral WHERE loan_id=$1", [loan.id])).rows[0];
    expect(col.status).toBe("forfeited");
  });

  it("rejects a second scheduled auction for the same pledge", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan;
    await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({});
    const dup = await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({});
    expect(dup.status).toBe(400);
  });

  it("completes a sale ABOVE what's owed → surplus to customer, owed recovered to pool", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan; // owes 12,120
    const a = (await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({})).body.data;
    const before = await poolCollected(t.id);

    // Sell for 15,000, fees 500 → net 14,500; owed 12,120 → recovered 12,120, surplus 2,380.
    const res = await request(app).post(`/api/pawn/auctions/${a.id}/complete`).set("Authorization", auth(admin)).send({ sale_price: 15000, fees: 500, buyer_name: "Buyer A" });
    expect(res.status).toBe(200);
    expect(res.body.data.recovered).toBe(12120);
    expect(res.body.data.surplus).toBe(2380);
    expect(res.body.data.deficiency).toBe(0);
    expect(await poolCollected(t.id)).toBe(before + 12120);

    const col = (await query("SELECT status, sale_amount FROM loan_collateral WHERE loan_id=$1", [loan.id])).rows[0];
    expect(col.status).toBe("sold");
    expect(Number(col.sale_amount)).toBe(15000);
  });

  it("completes a sale BELOW what's owed → deficiency, only net recovered", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan; // owes 12,120
    const a = (await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({})).body.data;
    const before = await poolCollected(t.id);

    // Sell for 9,000, fees 0 → net 9,000 < 12,120 → recovered 9,000, deficiency 3,120.
    const res = await request(app).post(`/api/pawn/auctions/${a.id}/complete`).set("Authorization", auth(admin)).send({ sale_price: 9000 });
    expect(res.body.data.recovered).toBe(9000);
    expect(res.body.data.surplus).toBe(0);
    expect(res.body.data.deficiency).toBe(3120);
    expect(await poolCollected(t.id)).toBe(before + 9000);
  });

  it("cancels a scheduled auction → pledge active, item back on hold", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan;
    const a = (await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({})).body.data;

    const res = await request(app).post(`/api/pawn/auctions/${a.id}/cancel`).set("Authorization", auth(admin)).send({});
    expect(res.status).toBe(200);
    expect((await query("SELECT status FROM loans WHERE id=$1", [loan.id])).rows[0].status).toBe("active");
    expect((await query("SELECT status FROM loan_collateral WHERE loan_id=$1", [loan.id])).rows[0].status).toBe("held");
    // Can't complete a cancelled auction.
    const done = await request(app).post(`/api/pawn/auctions/${a.id}/complete`).set("Authorization", auth(admin)).send({ sale_price: 10000 });
    expect(done.status).toBe(400);
  });

  it("lists auctions for the shop", async () => {
    const { t, admin, pkg } = await setup();
    const c = await createClient(t.id);
    const loan = (await newPawn(admin, pkg, c.id)).body.data.loan;
    await request(app).post(`/api/pawn/${loan.id}/auction`).set("Authorization", auth(admin)).send({});
    const list = await request(app).get("/api/pawn/auctions").set("Authorization", auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].item).toBe("Ring");
  });
});
