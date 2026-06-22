// Welfare investments (migration 100): admin records amount invested + current
// balance; income = the difference; totals surface on the dashboard summary.
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

describe("welfare investments", () => {
  it("records investments, computes income, and rolls up on the dashboard", async () => {
    const { admin, w } = await setup();
    const inv = await request(app).post(`/api/welfares/${w.id}/investments`).set("Authorization", auth(admin))
      .send({ name: "CIC MMF", amount_invested: 100000, current_balance: 108000 });
    expect(inv.status).toBe(201);
    expect(inv.body.data.income).toBe(8000); // 108000 − 100000

    await request(app).post(`/api/welfares/${w.id}/investments`).set("Authorization", auth(admin))
      .send({ name: "Sanlam MMF", amount_invested: 50000, current_balance: 51500 });

    const list = await request(app).get(`/api/welfares/${w.id}/investments`).set("Authorization", auth(admin));
    expect(list.body.data.investments).toHaveLength(2);
    expect(list.body.data.totals).toMatchObject({ invested: 150000, current: 159500, income: 9500 });

    // Dashboard summary carries the investments rollup.
    const dash = await request(app).get(`/api/welfares/${w.id}/reports/summary`).set("Authorization", auth(admin));
    expect(dash.body.data.investments).toMatchObject({ invested: 150000, current: 159500, income: 9500, count: 2 });

    // Update the current balance → income recomputes.
    const upd = await request(app).put(`/api/welfares/${w.id}/investments/${inv.body.data.id}`).set("Authorization", auth(admin)).send({ current_balance: 112000 });
    expect(upd.body.data.income).toBe(12000);

    // Delete one.
    expect((await request(app).delete(`/api/welfares/${w.id}/investments/${inv.body.data.id}`).set("Authorization", auth(admin))).status).toBe(200);
    expect((await request(app).get(`/api/welfares/${w.id}/investments`).set("Authorization", auth(admin))).body.data.investments).toHaveLength(1);
  });

  it("requires a name and 404s a missing investment", async () => {
    const { admin, w } = await setup();
    expect((await request(app).post(`/api/welfares/${w.id}/investments`).set("Authorization", auth(admin)).send({ amount_invested: 100 })).status).toBe(400);
    expect((await request(app).put(`/api/welfares/${w.id}/investments/999999`).set("Authorization", auth(admin)).send({ current_balance: 1 })).status).toBe(404);
  });
});
