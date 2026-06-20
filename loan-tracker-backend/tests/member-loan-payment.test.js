// Member loan engine phase 3 — repayment allocation (penalty → interest →
// principal), the pool accounting invariant (interest/penalty grow the pool as
// profit, principal restores it, member savings untouched), reducing-balance
// prepayment, and overpayment rejection.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup(fund = 50000) {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0790000001" })).body.data;
  if (fund > 0) await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: fund });
  return { t, admin, w, m };
}
const L = (w) => `/api/welfares/${w.id}/loans`;
async function active(w, admin, body) {
  const id = (await request(app).post(L(w)).set("Authorization", auth(admin)).send(body)).body.data.id;
  await request(app).post(`${L(w)}/${id}/approve`).set("Authorization", auth(admin)).send({});
  await request(app).post(`${L(w)}/${id}/disburse`).set("Authorization", auth(admin)).send(body.disburse || {});
  return id;
}
const detail = (w, admin, id) => request(app).get(`${L(w)}/${id}`).set("Authorization", auth(admin)).then((r) => r.body.data);
const pay = (w, admin, id, amount) => request(app).post(`${L(w)}/${id}/payments`).set("Authorization", auth(admin)).send({ amount });
const summary = (w, admin) => request(app).get(`/api/welfares/${w.id}/reports/summary`).set("Authorization", auth(admin)).then((r) => r.body.data);

describe("member loan repayment allocation", () => {
  it("flat full repayment: interest grows the pool, principal restores it, savings untouched", async () => {
    const { admin, w, m } = await setup(50000);
    const id = await active(w, admin, { member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12 });
    const paid = await pay(w, admin, id, 12720); // 12000 principal + 720 interest
    expect(paid.body.completed).toBe(true);
    expect(paid.body.allocation).toMatchObject({ interest: 720, principal: 12000, penalty: 0 });
    // Pool = initial 50000 + 720 interest profit (disburse −12000, repay +12720).
    expect(Number(paid.body.pool_balance)).toBe(50720);

    const d = await detail(w, admin, id);
    expect(d.loan.status).toBe("completed");
    expect(d.schedule.every((s) => s.status === "paid")).toBe(true);
    // Member savings are still just the 50000 they contributed — interest is group profit.
    const s = await summary(w, admin);
    expect(s.pool.members_savings).toBe(50000);
    expect(s.pool.balance).toBe(50720);
  });

  it("partial payment fills interest before principal, per installment", async () => {
    const { admin, w, m } = await setup();
    const id = await active(w, admin, { member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12 });
    const paid = await pay(w, admin, id, 200); // row1: 120 interest + 80 principal
    expect(paid.body.allocation).toMatchObject({ interest: 120, principal: 80, penalty: 0 });
    expect(paid.body.completed).toBe(false);
  });

  it("reducing-balance prepayment knocks down principal and cuts total interest", async () => {
    const { admin, w, m } = await setup();
    const id = await active(w, admin, { member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12, interest_method: "reducing" });
    const before = await detail(w, admin, id);
    const beforeInterest = Number(before.loan.total_interest);
    await pay(w, admin, id, 8000); // settle row 1 + knock principal down
    const after = await detail(w, admin, id);
    expect(Number(after.loan.total_interest)).toBeLessThan(beforeInterest);
  });

  it("rejects an over-payment", async () => {
    const { admin, w, m } = await setup();
    const id = await active(w, admin, { member_id: m.id, principal: 12000, duration_months: 6, interest_rate: 12 });
    const over = await pay(w, admin, id, 99999);
    expect(over.status).toBe(400);
  });

  it("allocates penalty first on an overdue installment", async () => {
    const { admin, w, m } = await setup();
    // Off-product loan with a late fee; back-date the schedule so row 1 is overdue.
    const id = await active(w, admin, {
      member_id: m.id, principal: 9000, duration_months: 3, interest_rate: 10, late_fee: 500,
      disburse: { disbursement_date: "2026-02-01", start_date: "2026-03-01" },
    });
    const paid = await pay(w, admin, id, 100); // smaller than the accrued late fee
    expect(paid.body.allocation.penalty).toBe(100);
    expect(paid.body.allocation.interest).toBe(0);
    expect(paid.body.allocation.principal).toBe(0);
  });
});
