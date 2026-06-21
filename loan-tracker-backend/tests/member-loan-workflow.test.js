// Member loan engine phase 2 — application → review → approve → disburse, the
// installment schedule (flat + reducing), pool debit + processing-fee income,
// and the pool-cover gate at disburse.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup(fund = 0) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0790000001" })).body.data;
  if (fund > 0) await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: fund });
  return { t, admin, w, m };
}
const loans = (w) => `/api/welfares/${w.id}/loans`;
const mkProduct = (w, admin, over = {}) =>
  request(app).post(`${loans(w)}/products`).set("Authorization", auth(admin))
    .send({ name: "Std", annual_interest_rate: 12, interest_method: "flat", min_amount: 1000, max_amount: 200000, min_duration_months: 1, max_duration_months: 12, ...over }).then((r) => r.body.data);

async function takeToActive(w, admin, body) {
  const created = await request(app).post(loans(w)).set("Authorization", auth(admin)).send(body);
  const id = created.body.data.id;
  await request(app).post(`${loans(w)}/${id}/approve`).set("Authorization", auth(admin)).send({});
  const disb = await request(app).post(`${loans(w)}/${id}/disburse`).set("Authorization", auth(admin)).send({});
  return { id, created, disb };
}

describe("member loan workflow + schedule", () => {
  it("flat loan: application → approve → disburse builds an even schedule and debits the pool", async () => {
    const { admin, w, m } = await setup(50000);
    const prod = await mkProduct(w, admin);
    const { id, created, disb } = await takeToActive(w, admin, { member_id: m.id, product_id: prod.id, principal: 12000, duration_months: 6 });
    expect(created.status).toBe(201);
    expect(Number(created.body.data.total_interest)).toBe(720); // 12000 × 12% × 0.5yr
    expect(disb.status).toBe(200);
    expect(Number(disb.body.pool_balance)).toBe(38000); // 50000 − 12000

    const detail = (await request(app).get(`${loans(w)}/${id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.loan.status).toBe("active");
    expect(detail.schedule).toHaveLength(6);
    expect(Number(detail.schedule[0].amount_due)).toBe(2120); // 12720 / 6
    expect(Number(detail.schedule[0].interest_portion)).toBe(120); // flat: constant
    expect(Number(detail.schedule[5].interest_portion)).toBe(120);
    expect(Number(detail.schedule[5].balance_after)).toBe(0);
  });

  it("reducing loan: interest declines across the schedule", async () => {
    const { admin, w, m } = await setup(50000);
    const prod = await mkProduct(w, admin, { name: "Red", interest_method: "reducing" });
    const { id } = await takeToActive(w, admin, { member_id: m.id, product_id: prod.id, principal: 12000, duration_months: 6 });
    const detail = (await request(app).get(`${loans(w)}/${id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.schedule).toHaveLength(6);
    expect(Number(detail.schedule[0].interest_portion)).toBeGreaterThan(Number(detail.schedule[5].interest_portion));
    expect(Number(detail.loan.total_interest)).toBeLessThan(720); // reducing costs less than flat
  });

  it("processing fee is retained in the pool as income", async () => {
    const { admin, w, m } = await setup(50000);
    const prod = await mkProduct(w, admin, { name: "Fee", processing_fee_rate: 1 });
    const { disb } = await takeToActive(w, admin, { member_id: m.id, product_id: prod.id, principal: 12000, duration_months: 6 });
    // −12000 principal +120 fee → pool drops by 11880, not 12000.
    expect(Number(disb.body.pool_balance)).toBe(38120);
  });

  it("disburse is blocked when the pool can't cover the principal", async () => {
    const { admin, w, m } = await setup(5000);
    const created = await request(app).post(loans(w)).set("Authorization", auth(admin)).send({ member_id: m.id, principal: 10000, duration_months: 3, interest_rate: 10 });
    const id = created.body.data.id;
    await request(app).post(`${loans(w)}/${id}/approve`).set("Authorization", auth(admin)).send({});
    const disb = await request(app).post(`${loans(w)}/${id}/disburse`).set("Authorization", auth(admin)).send({});
    expect(disb.status).toBe(400);
    expect(disb.body.error).toMatch(/can't disburse/i);
  });

  it("rejects an out-of-range amount and enforces the status machine", async () => {
    const { admin, w, m } = await setup(50000);
    const prod = await mkProduct(w, admin); // max 200000
    const over = await request(app).post(loans(w)).set("Authorization", auth(admin)).send({ member_id: m.id, product_id: prod.id, principal: 999999, duration_months: 6 });
    expect(over.status).toBe(400);

    const created = await request(app).post(loans(w)).set("Authorization", auth(admin)).send({ member_id: m.id, product_id: prod.id, principal: 5000, duration_months: 6 });
    const id = created.body.data.id;
    // Can't disburse before approval.
    const early = await request(app).post(`${loans(w)}/${id}/disburse`).set("Authorization", auth(admin)).send({});
    expect(early.status).toBe(400);
    // Reject path.
    const rej = await request(app).post(`${loans(w)}/${id}/reject`).set("Authorization", auth(admin)).send({ reason: "incomplete" });
    expect(rej.body.data.status).toBe("rejected");
    // Can't approve a rejected loan.
    const reapprove = await request(app).post(`${loans(w)}/${id}/approve`).set("Authorization", auth(admin)).send({});
    expect(reapprove.status).toBe(400);
  });
});
