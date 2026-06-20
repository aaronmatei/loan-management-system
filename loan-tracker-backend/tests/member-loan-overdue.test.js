// Member loan engine phase 4 — overdue penalty accrual. The daily pass flips
// past-due unpaid installments to 'overdue' and snapshots the accruing late fee
// / penalty interest onto the schedule row (lender model), idempotently.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";
import { accrueMemberLoanPenalties } from "../src/services/welfarePenaltyAccrual.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function activeLoan() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0790000001" })).body.data;
  await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
  const L = `/api/welfares/${w.id}/loans`;
  // late fee + penalty rate; back-date the start so the early installments are
  // overdue while the later ones are still in the future.
  const id = (await request(app).post(L).set("Authorization", auth(admin)).send({ member_id: m.id, principal: 9000, duration_months: 6, interest_rate: 10, late_fee: 500, penalty_rate: 5 })).body.data.id;
  await request(app).post(`${L}/${id}/approve`).set("Authorization", auth(admin)).send({});
  await request(app).post(`${L}/${id}/disburse`).set("Authorization", auth(admin)).send({ disbursement_date: "2026-02-01", start_date: "2026-03-01" });
  return { t, w, admin, m, id };
}
const sched = (loanId) => query(`SELECT * FROM member_loan_schedules WHERE member_loan_id=$1 ORDER BY payment_number`, [loanId]).then((r) => r.rows);

describe("member loan overdue accrual", () => {
  it("flips past-due installments to overdue and snapshots the fine", async () => {
    const { t, id } = await activeLoan();
    const before = await sched(id);
    expect(before.every((s) => s.status === "pending")).toBe(true);

    const r = await accrueMemberLoanPenalties(t.id);
    expect(r.overdue).toBeGreaterThan(0);

    const after = await sched(id);
    const row1 = after[0];
    expect(row1.status).toBe("overdue");
    expect(Number(row1.late_fee_charged)).toBeGreaterThan(0);
    expect(Number(row1.penalty_interest_charged)).toBeGreaterThan(0);
    expect(Number(row1.days_late)).toBeGreaterThan(0);
    // A not-yet-due installment stays pending.
    expect(after[after.length - 1].status).toBe("pending");
  });

  it("is idempotent — re-running never reduces a recorded charge", async () => {
    const { t, id } = await activeLoan();
    await accrueMemberLoanPenalties(t.id);
    const first = (await sched(id))[0];
    await accrueMemberLoanPenalties(t.id);
    const second = (await sched(id))[0];
    expect(Number(second.late_fee_charged)).toBeGreaterThanOrEqual(Number(first.late_fee_charged));
    expect(Number(second.penalty_interest_charged)).toBeGreaterThanOrEqual(Number(first.penalty_interest_charged));
  });

  it("a loan with no late terms accrues nothing", async () => {
    const t = await createTenant();
    await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
    const admin = await createUser(t.id, { role: "admin" });
    const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "U2" })).body.data;
    const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "B", last_name: "K", phone_number: "0790000009" })).body.data;
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
    const L = `/api/welfares/${w.id}/loans`;
    const id = (await request(app).post(L).set("Authorization", auth(admin)).send({ member_id: m.id, principal: 9000, duration_months: 3, interest_rate: 10 })).body.data.id; // no late_fee/penalty
    await request(app).post(`${L}/${id}/approve`).set("Authorization", auth(admin)).send({});
    await request(app).post(`${L}/${id}/disburse`).set("Authorization", auth(admin)).send({ disbursement_date: "2026-01-01", start_date: "2026-02-01" });
    const r = await accrueMemberLoanPenalties(t.id);
    expect(r.overdue).toBe(0);
  });
});
