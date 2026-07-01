// Welfare penalty engine: per-chama configurable rules + assessment ledger,
// with payments posting into the pool (income), not the member's savings.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { welfareSignup } from "./helpers/factory.js";
import { query, closePool } from "./helpers/db.js";
import { createUser, tokenFor } from "./helpers/factory.js";
import { computePenaltyAmount } from "../src/utils/penaltyEngine.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const PASS = "Welfare@2026xy";
afterAll(closePool);

let seq = 0;
async function bootstrap() {
  seq += 1;
  const signup = await welfareSignup({
    welfare_name: "Umoja Welfare",
    subdomain: `umoja-pen-${seq}`,
    contact_name: "Jane Chair",
    contact_email: `chair${seq}@pen.example`,
    admin_password: PASS,
  });
  const token = signup.body.token;
  const tenantId = signup.body.user.tenant_id;
  const welfareId = signup.body.welfare_group_id;
  const adminAuth = `Bearer ${token}`;
  const m = (
    await request(app).post(`/api/welfares/${welfareId}/members`).set("Authorization", adminAuth).send({ first_name: "A", last_name: "B" })
  ).body.data;
  return { tenantId, welfareId, adminAuth, member: m };
}

describe("computePenaltyAmount", () => {
  it("computes each calc type and honours the cap", () => {
    expect(computePenaltyAmount({ calc_type: "fixed", amount: 300 })).toBe(300);
    expect(computePenaltyAmount({ calc_type: "percentage", rate: 2 }, { basis: 5000 })).toBe(100);
    expect(computePenaltyAmount({ calc_type: "daily_fixed", amount: 100 }, { daysLate: 5 })).toBe(500);
    expect(computePenaltyAmount({ calc_type: "daily_percentage", rate: 2 }, { basis: 5000, daysLate: 3 })).toBe(300);
    expect(computePenaltyAmount({ calc_type: "daily_fixed", amount: 100, cap: 350 }, { daysLate: 10 })).toBe(350);
  });
});

describe("welfare penalty rules + assessments", () => {
  it("configures rules (admin only) and validates them", async () => {
    const { welfareId, adminAuth, tenantId } = await bootstrap();
    const officer = await createUser(tenantId, { role: "loan_officer" });

    const blocked = await request(app)
      .post(`/api/welfares/${welfareId}/penalty-rules`)
      .set("Authorization", auth(officer))
      .send({ trigger: "attendance_absent", calc_type: "fixed", amount: 500 });
    expect(blocked.status).toBe(403);

    const bad = await request(app)
      .post(`/api/welfares/${welfareId}/penalty-rules`)
      .set("Authorization", adminAuth)
      .send({ trigger: "attendance_absent", calc_type: "fixed" }); // no amount
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post(`/api/welfares/${welfareId}/penalty-rules`)
      .set("Authorization", adminAuth)
      .send({ trigger: "contribution_late", calc_type: "daily_fixed", amount: 100, cap: 1000 });
    expect(ok.status).toBe(201);

    const list = await request(app).get(`/api/welfares/${welfareId}/penalty-rules`).set("Authorization", adminAuth);
    expect(list.body.data).toHaveLength(1);
  });

  it("assesses a penalty (direct amount and via a rule) and lists outstanding", async () => {
    const { welfareId, adminAuth, member } = await bootstrap();
    const rule = (
      await request(app).post(`/api/welfares/${welfareId}/penalty-rules`).set("Authorization", adminAuth)
        .send({ trigger: "attendance_absent", calc_type: "fixed", amount: 500 })
    ).body.data;

    // Via rule (amount computed = 500).
    const a1 = await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth)
      .send({ member_id: member.id, rule_id: rule.id });
    expect(a1.status).toBe(201);
    expect(Number(a1.body.data.amount)).toBe(500);

    // Direct amount.
    const a2 = await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth)
      .send({ member_id: member.id, amount: 250, description: "Late to meeting" });
    expect(a2.status).toBe(201);

    const list = await request(app).get(`/api/welfares/${welfareId}/penalties?status=outstanding`).set("Authorization", adminAuth);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.outstanding_total).toBe(750);
  });

  it("paying a penalty grows the pool but not the member's savings", async () => {
    const { welfareId, adminAuth, member } = await bootstrap();
    // A contribution first → savings + pool = 5000.
    await request(app).post(`/api/welfares/${welfareId}/members/${member.id}/contributions`).set("Authorization", adminAuth).send({ amount: 5000 });
    const a = (
      await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth)
        .send({ member_id: member.id, amount: 500 })
    ).body.data;

    const pay = await request(app).post(`/api/welfares/${welfareId}/penalties/${a.id}/pay`).set("Authorization", adminAuth).send({});
    expect(pay.status).toBe(200);
    expect(pay.body.status).toBe("paid");
    expect(pay.body.pool_balance).toBe(5500); // 5000 contribution + 500 penalty

    // Member savings still 5000 (penalty is income, not savings).
    const detail = await request(app).get(`/api/welfares/${welfareId}/members/${member.id}`).set("Authorization", adminAuth);
    expect(detail.body.data.savings_balance).toBe(5000);
  });

  it("waives a penalty (admin/manager only)", async () => {
    const { welfareId, adminAuth, member, tenantId } = await bootstrap();
    const officer = await createUser(tenantId, { role: "loan_officer" });
    const a = (
      await request(app).post(`/api/welfares/${welfareId}/penalties`).set("Authorization", adminAuth).send({ member_id: member.id, amount: 500 })
    ).body.data;

    const blocked = await request(app).post(`/api/welfares/${welfareId}/penalties/${a.id}/waive`).set("Authorization", auth(officer)).send({});
    expect(blocked.status).toBe(403);

    const ok = await request(app).post(`/api/welfares/${welfareId}/penalties/${a.id}/waive`).set("Authorization", adminAuth).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("waived");
  });

  it("saves per-chama settings", async () => {
    const { welfareId, adminAuth } = await bootstrap();
    const put = await request(app).put(`/api/welfares/${welfareId}/settings`).set("Authorization", adminAuth)
      .send({ contribution_frequency: "weekly", contribution_amount: 1000, contribution_grace_days: 3, attendance_grace_minutes: 15 });
    expect(put.status).toBe(200);
    expect(put.body.data.contribution_frequency).toBe("weekly");
    expect(Number(put.body.data.contribution_amount)).toBe(1000);
  });
});
