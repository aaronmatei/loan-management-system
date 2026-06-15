// Welfare M-Pesa allocation: a confirmed STK payment credits its target
// (contribution schedule / member loan / penalty) and posts the cash into the
// pool. Allocation is idempotent (callback + manual reconcile both safe). The
// STK *initiation* needs live Daraja creds, so we test the money core directly
// plus the manual reconciliation endpoint.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { allocateWelfarePayment } from "../src/services/welfareMpesaService.js";

const PASS = "Welfare@2026xy";
afterAll(closePool);

let seq = 0;
async function bootstrap(memberNames = ["A", "B"]) {
  seq += 1;
  const signup = await request(app).post("/api/tenants/welfare-signup").send({
    welfare_name: "Umoja", subdomain: `umoja-mpx-${seq}`,
    contact_name: "Jane", contact_email: `mpx${seq}@x.example`, admin_password: PASS,
  });
  const adminAuth = `Bearer ${signup.body.token}`;
  const welfareId = signup.body.welfare_group_id;
  const tenantId = signup.body.user.tenant_id;
  const members = [];
  for (const n of memberNames) {
    const m = (await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: n, last_name: "M" })).body.data;
    members.push(m);
  }
  return { welfareId, tenantId, adminAuth, members };
}

// Insert a confirmed (success) welfare M-Pesa transaction pointing at a target.
async function successTx({ tenantId, welfareId, memberId, targetType, targetId, amount, purpose }) {
  const r = await query(
    `INSERT INTO mpesa_transactions
       (tenant_id, purpose, welfare_id, member_id, target_type, target_id,
        phone_number, amount, status, mpesa_receipt_number, allocated)
     VALUES ($1,$2,$3,$4,$5,$6,'254700000000',$7,'success','QABC123',false) RETURNING *`,
    [tenantId, purpose, welfareId, memberId, targetType, targetId, amount],
  );
  return r.rows[0];
}

async function poolBalance(welfareId) {
  const r = await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1`, [welfareId]);
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

describe("welfare M-Pesa allocation", () => {
  it("allocates a contribution payment to its schedule and grows the pool, idempotently", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(["A"]);
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const detail = await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth);
    const sched = detail.body.data.schedules[0];

    const tx = await successTx({ tenantId, welfareId, memberId: members[0].id, targetType: "contribution_schedule", targetId: sched.id, amount: 1000, purpose: "welfare_contribution" });
    const r1 = await allocateWelfarePayment(tx, { amount: 1000 });
    expect(r1.applied).toBe(true);

    const s = (await query(`SELECT * FROM contribution_schedules WHERE id=$1`, [sched.id])).rows[0];
    expect(s.status).toBe("paid");
    expect(parseFloat(s.amount_paid)).toBe(1000);
    expect(await poolBalance(welfareId)).toBe(1000);

    // Re-run with the now-allocated row: no double credit.
    const reloaded = (await query(`SELECT * FROM mpesa_transactions WHERE id=$1`, [tx.id])).rows[0];
    const r2 = await allocateWelfarePayment(reloaded, { amount: 1000 });
    expect(r2.applied).toBe(false);
    expect(await poolBalance(welfareId)).toBe(1000);
  });

  it("allocates a partial loan repayment and reactivates a defaulted loan", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(["A"]);
    // Fund the pool so a loan can be issued.
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 5000, due_date: "2026-12-31" })).body.data;
    const sched = (await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth)).body.data.schedules[0];
    await request(app).post(`/api/welfares/${welfareId}/cycles/${cycle.id}/schedules/${sched.id}/pay`).set("Authorization", adminAuth).send({});

    const loan = (await request(app).post(`/api/welfares/${welfareId}/members/${members[0].id}/loans`).set("Authorization", adminAuth).send({ principal: 2000, duration_months: 1, interest_rate: 0 })).body.data;
    await request(app).post(`/api/welfares/${welfareId}/members/${members[0].id}/loans/${loan.id}/default`).set("Authorization", adminAuth).send({});

    const tx = await successTx({ tenantId, welfareId, memberId: members[0].id, targetType: "member_loan", targetId: loan.id, amount: 500, purpose: "welfare_loan_repayment" });
    const r = await allocateWelfarePayment(tx, { amount: 500 });
    expect(r.applied).toBe(true);

    const l = (await query(`SELECT * FROM member_loans WHERE id=$1`, [loan.id])).rows[0];
    expect(parseFloat(l.amount_paid)).toBe(500);
    expect(l.status).toBe("active"); // partial repayment lifts the default
  });

  it("allocates a penalty payment to its assessment", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(["A"]);
    const assessment = (await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth).send({ member_id: members[0].id, amount: 300, description: "Late" })).body.data;

    const tx = await successTx({ tenantId, welfareId, memberId: members[0].id, targetType: "penalty_assessment", targetId: assessment.id, amount: 300, purpose: "welfare_penalty" });
    const r = await allocateWelfarePayment(tx, { amount: 300 });
    expect(r.applied).toBe(true);

    const a = (await query(`SELECT * FROM penalty_assessments WHERE id=$1`, [assessment.id])).rows[0];
    expect(a.status).toBe("paid");
    expect(parseFloat(a.paid_amount)).toBe(300);
  });

  it("manual reconcile endpoint allocates a success+unallocated tx, then rejects re-allocation", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(["A"]);
    const cycle = (await request(app).post(`/api/welfares/${welfareId}/cycles`).set("Authorization", adminAuth).send({ amount: 1000, due_date: "2026-12-31" })).body.data;
    const sched = (await request(app).get(`/api/welfares/${welfareId}/cycles/${cycle.id}`).set("Authorization", adminAuth)).body.data.schedules[0];
    const tx = await successTx({ tenantId, welfareId, memberId: members[0].id, targetType: "contribution_schedule", targetId: sched.id, amount: 1000, purpose: "welfare_contribution" });

    const ok = await request(app).post(`/api/welfares/${welfareId}/mpesa/transactions/${tx.id}/allocate`).set("Authorization", adminAuth).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.applied).toBe(true);

    const again = await request(app).post(`/api/welfares/${welfareId}/mpesa/transactions/${tx.id}/allocate`).set("Authorization", adminAuth).send({});
    expect(again.status).toBe(400);
  });

  it("lists the welfare M-Pesa transactions log", async () => {
    const { welfareId, tenantId, adminAuth, members } = await bootstrap(["A"]);
    await successTx({ tenantId, welfareId, memberId: members[0].id, targetType: "penalty_assessment", targetId: 999, amount: 100, purpose: "welfare_penalty" });
    const list = await request(app).get(`/api/welfares/${welfareId}/mpesa/transactions`).set("Authorization", adminAuth);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data[0].purpose).toBe("welfare_penalty");
  });
});
