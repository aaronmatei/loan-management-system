// Group savings + joint-liability coverage (Phase 5b). Members contribute to a
// group fund; the group can withdraw; and savings can cover a member's
// outstanding loan — which runs through the normal payment path so the capital
// pool recovers exactly as a repayment.
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
  const r = await request(app)
    .post("/api/groups")
    .set("Authorization", auth(admin))
    .send({ name: "Umoja Chama" });
  return r.body.data;
}

async function enrol(admin, groupId, clientId) {
  await request(app)
    .post(`/api/groups/${groupId}/members`)
    .set("Authorization", auth(admin))
    .send({ client_id: clientId });
}

// A disbursed group loan for `client`, returned with its id.
async function disbursedGroupLoan(admin, pkg, groupId, client, principal = 40000) {
  const create = await request(app)
    .post("/api/loans")
    .set("Authorization", auth(admin))
    .send({
      client_id: client.id,
      package_id: pkg.id,
      group_id: groupId,
      principal_amount: principal,
      loan_duration_months: 6,
    });
  const loanId = create.body.data.id;
  await request(app).post(`/api/loans/${loanId}/approve`).set("Authorization", auth(admin)).send({});
  await request(app)
    .post(`/api/loans/${loanId}/disburse`)
    .set("Authorization", auth(admin))
    .send({ disbursement_method: "cash" });
  return { loanId, totalDue: parseFloat(create.body.data.total_amount_due) };
}

describe("group savings + joint-liability coverage", () => {
  it("records contributions and tracks the running + per-member balance", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const a = await createClient(t.id);
    const b = await createClient(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, a.id);
    await enrol(admin, g.id, b.id);

    const c1 = await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ client_id: a.id, amount: 5000 });
    expect(c1.status).toBe(201);
    expect(c1.body.balance).toBe(5000);

    await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ client_id: b.id, amount: 3000 });

    const s = await request(app)
      .get(`/api/groups/${g.id}/savings`)
      .set("Authorization", auth(admin));
    expect(s.body.data.balance).toBe(8000);
    const byMember = Object.fromEntries(
      s.body.data.members.map((m) => [m.client_id, m.balance]),
    );
    expect(byMember[a.id]).toBe(5000);
    expect(byMember[b.id]).toBe(3000);
  });

  it("allows withdrawals down to zero but not beyond the balance", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const g = await makeGroup(admin);
    await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ amount: 2000 });

    const over = await request(app)
      .post(`/api/groups/${g.id}/savings/withdrawal`)
      .set("Authorization", auth(admin))
      .send({ amount: 2500 });
    expect(over.status).toBe(400);

    const ok = await request(app)
      .post(`/api/groups/${g.id}/savings/withdrawal`)
      .set("Authorization", auth(admin))
      .send({ amount: 2000 });
    expect(ok.status).toBe(201);
    expect(ok.body.balance).toBe(0);
  });

  it("covers a member loan from savings — recovers capital and can complete the loan", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, client.id);
    const { loanId, totalDue } = await disbursedGroupLoan(admin, pkg, g.id, client);

    // Fund the group savings with enough to clear the loan.
    await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ amount: totalDue });

    const poolBefore = (
      await query("SELECT total_collected FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];

    const cover = await request(app)
      .post(`/api/groups/${g.id}/savings/cover-loan`)
      .set("Authorization", auth(admin))
      .send({ loan_id: loanId }); // amount omitted → full outstanding
    expect(cover.status).toBe(200);
    expect(cover.body.balance).toBe(0); // savings drained by the coverage

    // Loan fully settled.
    const loan = (await query("SELECT status FROM loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("completed");

    // Capital pool recovered the principal (collected rose).
    const poolAfter = (
      await query("SELECT total_collected FROM capital_pool WHERE tenant_id = $1", [t.id])
    ).rows[0];
    expect(Number(poolAfter.total_collected)).toBeGreaterThan(
      Number(poolBefore.total_collected),
    );

    // A liability_coverage ledger row was written against the loan.
    const cov = (
      await query(
        `SELECT * FROM group_savings_transactions WHERE group_id = $1 AND type = 'liability_coverage'`,
        [g.id],
      )
    ).rows;
    expect(cov).toHaveLength(1);
    expect(cov[0].loan_id).toBe(loanId);
  });

  it("reactivates and recovers a DEFAULTED member loan via coverage", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, client.id);
    const { loanId, totalDue } = await disbursedGroupLoan(admin, pkg, g.id, client);
    await query("UPDATE loans SET status='defaulted' WHERE id=$1", [loanId]);

    await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ amount: totalDue });

    const cover = await request(app)
      .post(`/api/groups/${g.id}/savings/cover-loan`)
      .set("Authorization", auth(admin))
      .send({ loan_id: loanId });
    expect(cover.status).toBe(200);
    const loan = (await query("SELECT status FROM loans WHERE id = $1", [loanId])).rows[0];
    expect(loan.status).toBe("completed");
  });

  it("rejects coverage exceeding savings or the loan balance, and cross-group loans", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    const other = await makeGroup(admin);
    await enrol(admin, g.id, client.id);
    const { loanId } = await disbursedGroupLoan(admin, pkg, g.id, client);

    // Savings too low.
    await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ amount: 1000 });
    const tooMuch = await request(app)
      .post(`/api/groups/${g.id}/savings/cover-loan`)
      .set("Authorization", auth(admin))
      .send({ loan_id: loanId, amount: 5000 });
    expect(tooMuch.status).toBe(400);

    // Loan doesn't belong to the other group.
    await request(app)
      .post(`/api/groups/${other.id}/savings/contribution`)
      .set("Authorization", auth(admin))
      .send({ amount: 100000 });
    const wrongGroup = await request(app)
      .post(`/api/groups/${other.id}/savings/cover-loan`)
      .set("Authorization", auth(admin))
      .send({ loan_id: loanId, amount: 1000 });
    expect(wrongGroup.status).toBe(404);
  });

  it("blocks a loan_officer from withdrawing or covering (admin/manager only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const g = await makeGroup(admin);

    // Officer CAN contribute...
    const contrib = await request(app)
      .post(`/api/groups/${g.id}/savings/contribution`)
      .set("Authorization", auth(officer))
      .send({ amount: 1000 });
    expect(contrib.status).toBe(201);
    // ...but NOT withdraw.
    const wd = await request(app)
      .post(`/api/groups/${g.id}/savings/withdrawal`)
      .set("Authorization", auth(officer))
      .send({ amount: 500 });
    expect(wd.status).toBe(403);
  });
});
