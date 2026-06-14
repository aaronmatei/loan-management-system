// Group / chama lending (Model A): a group wraps its members' individual loans
// and co-guarantees them. Tests cover group CRUD, membership, linking a member
// loan via the standard /api/loans flow, the rollup, and role gates.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

async function groupPackage(tenantId) {
  const r = await query(
    `INSERT INTO loan_packages
       (tenant_id, name, annual_interest_rate, processing_fee_rate, interest_method,
        min_amount, max_amount, min_duration_months, max_duration_months, loan_type)
     VALUES ($1, 'Group Loan', 24, 0, 'flat', 1000, 5000000, 1, 24, 'group')
     RETURNING *`,
    [tenantId],
  );
  return r.rows[0];
}

async function seedPool(tenantId) {
  await query(
    "INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 5000000, 0, 0)",
    [tenantId],
  );
}

async function makeGroup(admin) {
  const res = await request(app)
    .post("/api/groups")
    .set("Authorization", auth(admin))
    .send({ name: "Umoja Chama", meeting_frequency: "weekly" });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function addMember(admin, groupId, clientId, role) {
  return request(app)
    .post(`/api/groups/${groupId}/members`)
    .set("Authorization", auth(admin))
    .send({ client_id: clientId, role });
}

describe("group / chama lending", () => {
  it("creates a group with an auto group code (admin only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });

    const blocked = await request(app)
      .post("/api/groups")
      .set("Authorization", auth(officer))
      .send({ name: "Nope" });
    expect(blocked.status).toBe(403);

    const g = await makeGroup(admin);
    expect(g.group_code).toMatch(/^GRP-\d{5}$/);
    expect(g.status).toBe("active");
  });

  it("enrols members and rejects duplicates", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const g = await makeGroup(admin);

    const add = await addMember(admin, g.id, client.id, "chairperson");
    expect(add.status).toBe(201);
    expect(add.body.data.role).toBe("chairperson");

    const dup = await addMember(admin, g.id, client.id);
    expect(dup.status).toBe(409);

    const detail = await request(app)
      .get(`/api/groups/${g.id}`)
      .set("Authorization", auth(admin));
    expect(detail.status).toBe(200);
    expect(detail.body.data.members).toHaveLength(1);
    expect(detail.body.data.members[0].first_name).toBe(client.first_name);
  });

  it("links a member loan via the standard flow and rolls it up", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    await addMember(admin, g.id, client.id);

    const create = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        group_id: g.id,
        principal_amount: 50000,
        loan_duration_months: 6,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.loan_type).toBe("group");
    expect(create.body.data.group_id).toBe(g.id);
    const loanId = create.body.data.id;

    await request(app)
      .post(`/api/loans/${loanId}/approve`)
      .set("Authorization", auth(admin))
      .send({});
    await request(app)
      .post(`/api/loans/${loanId}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash" });

    const summary = await request(app)
      .get(`/api/groups/${g.id}/summary`)
      .set("Authorization", auth(admin));
    expect(summary.status).toBe(200);
    expect(summary.body.data.member_count).toBe(1);
    expect(summary.body.data.active_loans).toBe(1);
    expect(summary.body.data.total_disbursed).toBe(50000);
    expect(summary.body.data.total_outstanding).toBeGreaterThan(0);

    const loans = await request(app)
      .get(`/api/groups/${g.id}/loans`)
      .set("Authorization", auth(admin));
    expect(loans.body.data).toHaveLength(1);
    expect(loans.body.data[0].loan_code).toBe(create.body.data.loan_code);
  });

  it("rejects a group loan for a non-member", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const outsider = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);

    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: outsider.id,
        package_id: pkg.id,
        group_id: g.id,
        principal_amount: 50000,
        loan_duration_months: 6,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not an active member/i);
  });

  it("blocks removing a member who holds a group loan; allows otherwise", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const borrower = await createClient(t.id);
    const plain = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    const bAdd = await addMember(admin, g.id, borrower.id);
    const pAdd = await addMember(admin, g.id, plain.id);

    await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: borrower.id,
        package_id: pkg.id,
        group_id: g.id,
        principal_amount: 30000,
        loan_duration_months: 6,
      });

    const blocked = await request(app)
      .delete(`/api/groups/${g.id}/members/${bAdd.body.data.id}`)
      .set("Authorization", auth(admin));
    expect(blocked.status).toBe(400);

    const ok = await request(app)
      .delete(`/api/groups/${g.id}/members/${pAdd.body.data.id}`)
      .set("Authorization", auth(admin));
    expect(ok.status).toBe(200);
  });

  it("won't delete a group that has loans (close it instead)", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    await addMember(admin, g.id, client.id);
    await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        group_id: g.id,
        principal_amount: 30000,
        loan_duration_months: 6,
      });

    const del = await request(app)
      .delete(`/api/groups/${g.id}`)
      .set("Authorization", auth(admin));
    expect(del.status).toBe(400);

    // But an empty group deletes fine.
    const empty = await makeGroup(admin);
    const delEmpty = await request(app)
      .delete(`/api/groups/${empty.id}`)
      .set("Authorization", auth(admin));
    expect(delEmpty.status).toBe(200);
  });

  it("scopes groups to their tenant", async () => {
    const t1 = await createTenant();
    const t2 = await createTenant();
    const admin1 = await createUser(t1.id, { role: "admin" });
    const admin2 = await createUser(t2.id, { role: "admin" });
    const g = await makeGroup(admin1);

    const cross = await request(app)
      .get(`/api/groups/${g.id}`)
      .set("Authorization", auth(admin2));
    expect(cross.status).toBe(404);
  });

  it("generates a group guarantee form PDF", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const g = await makeGroup(admin);
    await addMember(admin, g.id, client.id, "chairperson");

    const res = await request(app)
      .get(`/api/groups/${g.id}/guarantee-form`)
      .set("Authorization", auth(admin))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });
});
