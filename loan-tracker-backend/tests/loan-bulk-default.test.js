// Bulk "Mark Defaulted" (from the Overdue page): only the caller's own ACTIVE
// loans are defaulted; completed/other-tenant loans are skipped, and the
// defaulted loan's pending installments flip to overdue.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
} from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const statusOf = async (id) =>
  (await query("SELECT status FROM loans WHERE id = $1", [id])).rows[0].status;

afterAll(closePool);

describe("POST /api/loans/bulk/default", () => {
  it("defaults active loans, skips non-active, scopes to the tenant", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const active = await createLoan(t.id, client.id, { status: "active" });
    const completed = await createLoan(t.id, client.id, { status: "completed" });
    await query(
      `INSERT INTO payment_schedules (tenant_id, loan_id, payment_number, due_date, amount_due, status)
       VALUES ($1,$2,1, CURRENT_DATE - 10, 1000, 'pending')`,
      [t.id, active.id],
    );

    // A different tenant's loan must be untouched.
    const other = await createTenant();
    const oClient = await createClient(other.id);
    const oLoan = await createLoan(other.id, oClient.id, { status: "active" });

    const res = await request(app)
      .post("/api/loans/bulk/default")
      .set("Authorization", auth(admin))
      .send({ loan_ids: [active.id, completed.id, oLoan.id] });
    expect(res.status).toBe(200);
    expect(res.body.defaulted).toBe(1);
    expect(res.body.skipped).toBe(2);

    expect(await statusOf(active.id)).toBe("defaulted");
    expect(await statusOf(completed.id)).toBe("completed"); // skipped
    expect(await statusOf(oLoan.id)).toBe("active"); // other tenant untouched

    const sch = await query(
      "SELECT status FROM payment_schedules WHERE loan_id = $1",
      [active.id],
    );
    expect(sch.rows[0].status).toBe("overdue");
  });
});
