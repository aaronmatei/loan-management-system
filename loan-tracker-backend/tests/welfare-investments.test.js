// Welfare investments (migrations 100 + 101): record interest monthly, withdraw
// sometimes. Income = total interest earned and must NOT drop on a withdrawal.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  return { t, admin, w };
}

describe("welfare investments ledger", () => {
  it("records interest, withdraws, and keeps income = interest earned", async () => {
    const { admin, w } = await setup();
    const base = `/api/welfares/${w.id}/investments`;
    const inv = (await request(app).post(base).set("Authorization", auth(admin)).send({ name: "CIC MMF", amount_invested: 100000, current_balance: 108000 })).body.data;
    expect(inv.income).toBe(8000);          // interest already earned at creation
    expect(inv.current_balance).toBe(108000);

    // Monthly interest update.
    const afterInt = (await request(app).post(`${base}/${inv.id}/interest`).set("Authorization", auth(admin)).send({ amount: 2000 })).body.data;
    expect(afterInt.interest_earned).toBe(10000);
    expect(afterInt.current_balance).toBe(110000);
    expect(afterInt.income).toBe(10000);

    // Withdraw — current drops, income (interest) does NOT.
    const afterWd = (await request(app).post(`${base}/${inv.id}/withdraw`).set("Authorization", auth(admin)).send({ amount: 30000 })).body.data;
    expect(afterWd.current_balance).toBe(80000);
    expect(afterWd.withdrawn).toBe(30000);
    expect(afterWd.income).toBe(10000); // ← the whole point: a withdrawal isn't a loss

    // Over-withdraw is rejected.
    expect((await request(app).post(`${base}/${inv.id}/withdraw`).set("Authorization", auth(admin)).send({ amount: 999999 })).status).toBe(400);

    // Ledger has deposit + 2 interest + withdrawal.
    const txns = (await request(app).get(`${base}/${inv.id}/transactions`).set("Authorization", auth(admin))).body.data;
    expect(txns.filter((x) => x.type === "interest")).toHaveLength(2);
    expect(txns.filter((x) => x.type === "withdrawal")).toHaveLength(1);
    expect(txns.filter((x) => x.type === "deposit")).toHaveLength(1);

    // Dashboard rollup: income from interest, not current − invested.
    const dash = (await request(app).get(`/api/welfares/${w.id}/reports/summary`).set("Authorization", auth(admin))).body.data;
    expect(dash.investments).toMatchObject({ invested: 100000, current: 80000, income: 10000, withdrawn: 30000, count: 1 });
  });

  it("validates name + 404s a missing investment", async () => {
    const { admin, w } = await setup();
    const base = `/api/welfares/${w.id}/investments`;
    expect((await request(app).post(base).set("Authorization", auth(admin)).send({ amount_invested: 100 })).status).toBe(400);
    expect((await request(app).post(`${base}/999999/interest`).set("Authorization", auth(admin)).send({ amount: 1 })).status).toBe(404);
  });
});
