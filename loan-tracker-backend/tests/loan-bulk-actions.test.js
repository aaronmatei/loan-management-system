// Mass actions on the Applications page: review / approve / reject. Each
// is status-gated so a mixed selection processes the eligible loans and
// skips the rest with a reason.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("loan bulk actions", () => {
  it("moves pending loans to under_review and skips the rest", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    const pending = await createLoan(t.id, c.id, { status: "pending" });
    const active = await createLoan(t.id, c.id, { status: "active" });

    const res = await request(app)
      .post("/api/loans/bulk/review")
      .set("Authorization", auth(admin))
      .send({ loan_ids: [pending.id, active.id] });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1); // only the pending one
    expect(res.body.skipped).toBe(1);

    const status = (
      await query("SELECT status FROM loans WHERE id = $1", [pending.id])
    ).rows[0].status;
    expect(status).toBe("under_review");
  });

  it("approves pending + under_review loans (and skips defaulted-client loans)", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });

    // Client A — clean, can be approved.
    const a = await createClient(t.id);
    const okPending = await createLoan(t.id, a.id, { status: "pending" });
    const okReview = await createLoan(t.id, a.id, { status: "under_review" });

    // Client B — has a defaulted loan, must be skipped.
    const b = await createClient(t.id);
    await createLoan(t.id, b.id, { status: "defaulted" });
    const blocked = await createLoan(t.id, b.id, { status: "pending" });

    const res = await request(app)
      .post("/api/loans/bulk/approve")
      .set("Authorization", auth(admin))
      .send({ loan_ids: [okPending.id, okReview.id, blocked.id] });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(2);
    expect(res.body.skipped).toBeGreaterThanOrEqual(1);

    expect((await query("SELECT status FROM loans WHERE id = $1", [okPending.id])).rows[0].status).toBe("approved");
    expect((await query("SELECT status FROM loans WHERE id = $1", [okReview.id])).rows[0].status).toBe("approved");
    expect((await query("SELECT status FROM loans WHERE id = $1", [blocked.id])).rows[0].status).toBe("pending");
  });

  it("rejects pending + under_review loans with a reason", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    const p = await createLoan(t.id, c.id, { status: "pending" });
    const ur = await createLoan(t.id, c.id, { status: "under_review" });
    const done = await createLoan(t.id, c.id, { status: "completed" });

    const ok = await request(app)
      .post("/api/loans/bulk/reject")
      .set("Authorization", auth(admin))
      .send({ loan_ids: [p.id, ur.id, done.id], reason: "Insufficient docs" });
    expect(ok.status).toBe(200);
    expect(ok.body.processed).toBe(2);
    expect(ok.body.skipped).toBe(1);

    expect((await query("SELECT status, rejection_reason FROM loans WHERE id = $1", [p.id])).rows[0].rejection_reason).toBe("Insufficient docs");
    expect((await query("SELECT status FROM loans WHERE id = $1", [done.id])).rows[0].status).toBe("completed");
  });

  it("requires a reason for bulk reject", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const c = await createClient(t.id);
    const p = await createLoan(t.id, c.id, { status: "pending" });
    const res = await request(app)
      .post("/api/loans/bulk/reject")
      .set("Authorization", auth(admin))
      .send({ loan_ids: [p.id] });
    expect(res.status).toBe(400);
  });

  it("won't touch another tenant's loans", async () => {
    const t1 = await createTenant();
    const t2 = await createTenant();
    const admin1 = await createUser(t1.id, { role: "admin" });
    const c2 = await createClient(t2.id);
    const otherLoan = await createLoan(t2.id, c2.id, { status: "pending" });

    const res = await request(app)
      .post("/api/loans/bulk/review")
      .set("Authorization", auth(admin1))
      .send({ loan_ids: [otherLoan.id] });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0); // tenant-scoped UPDATE matched nothing
    expect((await query("SELECT status FROM loans WHERE id = $1", [otherLoan.id])).rows[0].status).toBe("pending");
  });
});
