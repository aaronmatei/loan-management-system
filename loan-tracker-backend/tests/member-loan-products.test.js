// Member loan products (migration 089) — the welfare analogue of loan_packages:
// pre-configured rate/method/fees/penalty terms that range-validate a member
// loan application. CRUD + archive + duplicate/validation guards.
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
  await request(app).put(`/api/welfares/${w.id}/settings/loans`).set("Authorization", auth(admin)).send({ enabled: true });
  return { t, admin, w };
}

const base = (w) => `/api/welfares/${w.id}/loans/products`;
const PROD = { name: "Emergency 12%", annual_interest_rate: 12, interest_method: "reducing", processing_fee_rate: 1, min_amount: 1000, max_amount: 200000, min_duration_months: 1, max_duration_months: 12, late_fee: 500, penalty_rate: 5 };

describe("member loan products", () => {
  it("creates, lists, edits and archives a product", async () => {
    const { admin, w } = await setup();
    const created = await request(app).post(base(w)).set("Authorization", auth(admin)).send(PROD);
    expect(created.status).toBe(201);
    expect(created.body.data.interest_method).toBe("reducing");
    expect(Number(created.body.data.late_fee)).toBe(500);
    const id = created.body.data.id;

    const list = await request(app).get(base(w)).set("Authorization", auth(admin));
    expect(list.body.data).toHaveLength(1);
    expect(Number(list.body.data[0].loan_count)).toBe(0);

    const edited = await request(app).put(`${base(w)}/${id}`).set("Authorization", auth(admin)).send({ annual_interest_rate: 15, max_amount: 300000 });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.data.annual_interest_rate)).toBe(15);
    expect(Number(edited.body.data.max_amount)).toBe(300000);

    const archived = await request(app).delete(`${base(w)}/${id}`).set("Authorization", auth(admin));
    expect(archived.status).toBe(200);
    expect(archived.body.data.active).toBe(false);
  });

  it("rejects a duplicate active name and an invalid amount range", async () => {
    const { admin, w } = await setup();
    await request(app).post(base(w)).set("Authorization", auth(admin)).send(PROD);
    const dup = await request(app).post(base(w)).set("Authorization", auth(admin)).send(PROD);
    expect(dup.status).toBe(409);

    const bad = await request(app).post(base(w)).set("Authorization", auth(admin)).send({ ...PROD, name: "Bad", min_amount: 5000, max_amount: 1000 });
    expect(bad.status).toBe(400);
  });

  it("archived names free up; same name can be re-created", async () => {
    const { admin, w } = await setup();
    const a = await request(app).post(base(w)).set("Authorization", auth(admin)).send(PROD);
    await request(app).delete(`${base(w)}/${a.body.data.id}`).set("Authorization", auth(admin));
    const again = await request(app).post(base(w)).set("Authorization", auth(admin)).send(PROD);
    expect(again.status).toBe(201);
  });
});
