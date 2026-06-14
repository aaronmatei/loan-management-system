// Member contributions pool (Part 1): a members' fund separate from the lending
// capital_pool. Members are their own roster; they contribute to / withdraw from
// a shared pool, with per-member savings balances.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function makeMember(admin, over = {}) {
  const r = await request(app)
    .post("/api/members")
    .set("Authorization", auth(admin))
    .send({ first_name: "Jane", last_name: "Doe", phone_number: "0700000000", ...over });
  return r.body.data;
}

describe("member contributions pool", () => {
  it("enrols members with an auto member number", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const m = await makeMember(admin);
    expect(m.member_no).toMatch(/^MBR-\d{5}$/);
    expect(m.status).toBe("active");
    const m2 = await makeMember(admin, { first_name: "Ann" });
    expect(m2.member_no).toBe("MBR-00002");
  });

  it("records contributions and tracks pool + per-member balances", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const a = await makeMember(admin, { first_name: "A" });
    const b = await makeMember(admin, { first_name: "B" });

    const c1 = await request(app)
      .post(`/api/members/${a.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 5000 });
    expect(c1.status).toBe(201);
    expect(c1.body.pool_balance).toBe(5000);
    expect(c1.body.savings_balance).toBe(5000);

    await request(app)
      .post(`/api/members/${b.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 3000 });

    const pool = await request(app).get("/api/members/pool").set("Authorization", auth(admin));
    expect(pool.body.data.balance).toBe(8000);
    expect(pool.body.data.total_contributions).toBe(8000);
    expect(pool.body.data.member_count).toBe(2);

    const aDetail = await request(app).get(`/api/members/${a.id}`).set("Authorization", auth(admin));
    expect(aDetail.body.data.savings_balance).toBe(5000);
  });

  it("blocks withdrawing more than the member has saved", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const a = await makeMember(admin);
    await request(app)
      .post(`/api/members/${a.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 2000 });

    const over = await request(app)
      .post(`/api/members/${a.id}/withdrawals`)
      .set("Authorization", auth(admin))
      .send({ amount: 2500 });
    expect(over.status).toBe(400);

    const ok = await request(app)
      .post(`/api/members/${a.id}/withdrawals`)
      .set("Authorization", auth(admin))
      .send({ amount: 2000 });
    expect(ok.status).toBe(201);
    expect(ok.body.savings_balance).toBe(0);
    expect(ok.body.pool_balance).toBe(0);
  });

  it("keeps the member pool entirely separate from the lending capital pool", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    await query(
      "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 100000, 0, 0)",
      [t.id],
    );
    const a = await makeMember(admin);
    await request(app)
      .post(`/api/members/${a.id}/contributions`)
      .set("Authorization", auth(admin))
      .send({ amount: 9000 });

    // capital_pool untouched by member contributions.
    const cap = (
      await query("SELECT total_collected, total_disbursed FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(cap.total_collected)).toBe(0);
    expect(Number(cap.total_disbursed)).toBe(0);
  });

  it("scopes members + pool to their tenant", async () => {
    const t1 = await createTenant();
    const t2 = await createTenant();
    const admin1 = await createUser(t1.id, { role: "admin" });
    const admin2 = await createUser(t2.id, { role: "admin" });
    const m = await makeMember(admin1);
    await request(app)
      .post(`/api/members/${m.id}/contributions`)
      .set("Authorization", auth(admin1))
      .send({ amount: 4000 });

    const cross = await request(app).get(`/api/members/${m.id}`).set("Authorization", auth(admin2));
    expect(cross.status).toBe(404);

    const pool2 = await request(app).get("/api/members/pool").set("Authorization", auth(admin2));
    expect(pool2.body.data.balance).toBe(0);
  });

  it("blocks a loan_officer from withdrawing (admin/manager only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const m = await makeMember(admin);
    // Officer can enrol + contribute...
    const c = await request(app)
      .post(`/api/members/${m.id}/contributions`)
      .set("Authorization", auth(officer))
      .send({ amount: 1000 });
    expect(c.status).toBe(201);
    // ...but not withdraw.
    const w = await request(app)
      .post(`/api/members/${m.id}/withdrawals`)
      .set("Authorization", auth(officer))
      .send({ amount: 500 });
    expect(w.status).toBe(403);
  });
});
