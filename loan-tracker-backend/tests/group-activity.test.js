// Group lifecycle (Phase 5c): meetings + attendance and lending cycles/rounds.
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

describe("group meetings + attendance", () => {
  it("creates a meeting, records attendance, and rolls up a summary", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const a = await createClient(t.id);
    const b = await createClient(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, a.id);
    await enrol(admin, g.id, b.id);

    // Officer can schedule a meeting.
    const m = await request(app)
      .post(`/api/groups/${g.id}/meetings`)
      .set("Authorization", auth(officer))
      .send({ meeting_date: "2026-06-01", location: "Hall", agenda: "Weekly" });
    expect(m.status).toBe(201);
    const meetingId = m.body.data.id;
    expect(m.body.data.status).toBe("scheduled");

    // Roster comes back with no attendance yet.
    const detail = await request(app)
      .get(`/api/groups/${g.id}/meetings/${meetingId}`)
      .set("Authorization", auth(admin));
    expect(detail.body.data.roster).toHaveLength(2);
    expect(detail.body.data.roster[0].attendance_status).toBeNull();

    // Record attendance — a present, b absent.
    const rec = await request(app)
      .post(`/api/groups/${g.id}/meetings/${meetingId}/attendance`)
      .set("Authorization", auth(officer))
      .send({
        records: [
          { client_id: a.id, status: "present" },
          { client_id: b.id, status: "absent" },
        ],
      });
    expect(rec.status).toBe(200);

    // Meeting now held, present_count = 1.
    const list = await request(app)
      .get(`/api/groups/${g.id}/meetings`)
      .set("Authorization", auth(admin));
    expect(list.body.data[0].status).toBe("held");
    expect(Number(list.body.data[0].present_count)).toBe(1);

    // Summary: 1 held meeting; a attended 100%, b 0%.
    const sum = await request(app)
      .get(`/api/groups/${g.id}/attendance-summary`)
      .set("Authorization", auth(admin));
    expect(sum.body.data.held_meetings).toBe(1);
    const byMember = Object.fromEntries(sum.body.data.members.map((mm) => [mm.client_id, mm]));
    expect(byMember[a.id].attended).toBe(1);
    expect(byMember[a.id].rate).toBe(100);
    expect(byMember[b.id].attended).toBe(0);
    expect(byMember[b.id].rate).toBe(0);
  });

  it("updates attendance idempotently (upsert, no duplicate rows)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const a = await createClient(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, a.id);
    const m = await request(app)
      .post(`/api/groups/${g.id}/meetings`)
      .set("Authorization", auth(admin))
      .send({ meeting_date: "2026-06-08" });
    const meetingId = m.body.data.id;

    await request(app)
      .post(`/api/groups/${g.id}/meetings/${meetingId}/attendance`)
      .set("Authorization", auth(admin))
      .send({ records: [{ client_id: a.id, status: "absent" }] });
    await request(app)
      .post(`/api/groups/${g.id}/meetings/${meetingId}/attendance`)
      .set("Authorization", auth(admin))
      .send({ records: [{ client_id: a.id, status: "present" }] });

    const rows = (
      await query("SELECT * FROM group_meeting_attendance WHERE meeting_id = $1", [meetingId])
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("present");
  });

  it("blocks a loan_officer from deleting a meeting (admin/manager only)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const g = await makeGroup(admin);
    const m = await request(app)
      .post(`/api/groups/${g.id}/meetings`)
      .set("Authorization", auth(admin))
      .send({ meeting_date: "2026-06-15" });
    const del = await request(app)
      .delete(`/api/groups/${g.id}/meetings/${m.body.data.id}`)
      .set("Authorization", auth(officer));
    expect(del.status).toBe(403);
  });
});

describe("group lending cycles", () => {
  it("creates sequential cycles and links a member loan to one", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    await enrol(admin, g.id, client.id);

    const c1 = await request(app)
      .post(`/api/groups/${g.id}/cycles`)
      .set("Authorization", auth(admin))
      .send({ name: "Q1", start_date: "2026-01-01" });
    expect(c1.status).toBe(201);
    expect(c1.body.data.cycle_number).toBe(1);
    expect(c1.body.data.status).toBe("open");

    const c2 = await request(app)
      .post(`/api/groups/${g.id}/cycles`)
      .set("Authorization", auth(admin))
      .send({ name: "Q2" });
    expect(c2.body.data.cycle_number).toBe(2);

    // Create a member loan in cycle 1.
    const loan = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        group_id: g.id,
        cycle_id: c1.body.data.id,
        principal_amount: 40000,
        loan_duration_months: 6,
      });
    expect(loan.status).toBe(201);
    expect(loan.body.data.cycle_id).toBe(c1.body.data.id);

    // Disburse it so it counts toward the cycle's disbursed total.
    await request(app)
      .post(`/api/loans/${loan.body.data.id}/approve`)
      .set("Authorization", auth(admin))
      .send({});
    await request(app)
      .post(`/api/loans/${loan.body.data.id}/disburse`)
      .set("Authorization", auth(admin))
      .send({ disbursement_method: "cash" });

    // Cycle rollup reflects the loan.
    const cycles = await request(app)
      .get(`/api/groups/${g.id}/cycles`)
      .set("Authorization", auth(admin));
    const cy1 = cycles.body.data.find((c) => c.id === c1.body.data.id);
    expect(cy1.loan_count).toBe(1);
    expect(cy1.total_disbursed).toBe(40000);
  });

  it("rejects a cycle that belongs to a different group", async () => {
    const t = await createTenant();
    await seedPool(t.id);
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const pkg = await groupPackage(t.id);
    const g = await makeGroup(admin);
    const other = await makeGroup(admin);
    await enrol(admin, g.id, client.id);
    const otherCycle = await request(app)
      .post(`/api/groups/${other.id}/cycles`)
      .set("Authorization", auth(admin))
      .send({});

    const res = await request(app)
      .post("/api/loans")
      .set("Authorization", auth(admin))
      .send({
        client_id: client.id,
        package_id: pkg.id,
        group_id: g.id,
        cycle_id: otherCycle.body.data.id,
        principal_amount: 40000,
        loan_duration_months: 6,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle not found/i);
  });

  it("closes a cycle and blocks loan_officer from creating one", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const officer = await createUser(t.id, { role: "loan_officer" });
    const g = await makeGroup(admin);

    const blocked = await request(app)
      .post(`/api/groups/${g.id}/cycles`)
      .set("Authorization", auth(officer))
      .send({});
    expect(blocked.status).toBe(403);

    const c = await request(app)
      .post(`/api/groups/${g.id}/cycles`)
      .set("Authorization", auth(admin))
      .send({});
    const closed = await request(app)
      .put(`/api/groups/${g.id}/cycles/${c.body.data.id}`)
      .set("Authorization", auth(admin))
      .send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("closed");
  });
});
