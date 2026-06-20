// Member loan engine phase 6 — collateral, guarantors (often other members),
// and the per-loan statement PDF.
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
  const a = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Asha", last_name: "K", phone_number: "0790000001" })).body.data;
  const b = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: "Brian", last_name: "M", phone_number: "0790000002" })).body.data;
  await request(app).post(`/api/welfares/${w.id}/members/${a.id}/contributions`).set("Authorization", auth(admin)).send({ amount: 50000 });
  const L = `/api/welfares/${w.id}/loans`;
  const id = (await request(app).post(L).set("Authorization", auth(admin)).send({ member_id: a.id, principal: 12000, duration_months: 6, interest_rate: 12 })).body.data.id;
  await request(app).post(`${L}/${id}/approve`).set("Authorization", auth(admin)).send({});
  await request(app).post(`${L}/${id}/disburse`).set("Authorization", auth(admin)).send({});
  return { t, w, admin, a, b, id, L };
}

describe("member loan collateral + guarantors + statement", () => {
  it("adds, lists, forfeits and removes collateral", async () => {
    const { w, admin, id, L } = await setup();
    const c = await request(app).post(`${L}/${id}/collateral`).set("Authorization", auth(admin)).send({ description: "TV", category: "electronics", appraised_value: 15000, ltv_percent: 60 });
    expect(c.status).toBe(201);
    const cid = c.body.data.id;
    const list = await request(app).get(`${L}/${id}/collateral`).set("Authorization", auth(admin));
    expect(list.body.data).toHaveLength(1);
    const f = await request(app).put(`${L}/${id}/collateral/${cid}`).set("Authorization", auth(admin)).send({ status: "forfeited" });
    expect(f.body.data.status).toBe("forfeited");
    expect(f.body.data.forfeited_at).toBeTruthy();
    const d = await request(app).delete(`${L}/${id}/collateral/${cid}`).set("Authorization", auth(admin));
    expect(d.status).toBe(200);
  });

  it("adds a fellow member as guarantor (name auto-filled)", async () => {
    const { w, admin, b, id, L } = await setup();
    const g = await request(app).post(`${L}/${id}/guarantors`).set("Authorization", auth(admin)).send({ guarantor_member_id: b.id, guaranteed_amount: 5000 });
    expect(g.status).toBe(201);
    expect(g.body.data.guarantor_name).toBe("Brian M");
    const detail = (await request(app).get(`${L}/${id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.guarantors).toHaveLength(1);
    expect(detail.guarantors[0].gm_first).toBe("Brian");
  });

  it("streams a loan statement PDF", async () => {
    const { w, admin, id, L } = await setup();
    const r = await request(app).get(`${L}/${id}/statement.pdf`).set("Authorization", auth(admin)).buffer(true).parse((res, cb) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/pdf/);
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
