// Tenant-facing automation: cadence settings + on-demand, tenant-scoped runs
// of the reminder / overdue jobs.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("tenant automation", () => {
  it("returns cadence settings + schedule", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .get("/api/automation/status")
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toHaveProperty("reminder_days_before");
    expect(res.body.data.schedule).toHaveProperty("reminders_cron");
  });

  it("updates the reminder cadence", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .put("/api/automation/settings")
      .set("Authorization", auth(admin))
      .send({ reminder_days_before: 5, overdue_reminder_frequency_days: 7 });
    expect(res.status).toBe(200);
    const row = (
      await query(
        "SELECT reminder_days_before, overdue_reminder_frequency_days FROM tenants WHERE id = $1",
        [t.id],
      )
    ).rows[0];
    expect(row.reminder_days_before).toBe(5);
    expect(row.overdue_reminder_frequency_days).toBe(7);
  });

  it("rejects an out-of-range cadence", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .put("/api/automation/settings")
      .set("Authorization", auth(admin))
      .send({ reminder_days_before: 99 });
    expect(res.status).toBe(400);
  });

  it("runs the reminders task scoped to the tenant", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .post("/api/automation/run")
      .set("Authorization", auth(admin))
      .send({ task: "reminders" });
    expect(res.status).toBe(200);
    expect(typeof res.body.result.reminders).toBe("number");
    expect(typeof res.body.result.overdues).toBe("number");
  });

  it("runs the overdue refresh task", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .post("/api/automation/run")
      .set("Authorization", auth(admin))
      .send({ task: "overdue" });
    expect(res.status).toBe(200);
    expect(typeof res.body.result.marked_overdue).toBe("number");
  });

  it("rejects an unknown task", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .post("/api/automation/run")
      .set("Authorization", auth(admin))
      .send({ task: "nope" });
    expect(res.status).toBe(400);
  });

  it("forbids non-admin/manager roles", async () => {
    const t = await createTenant();
    const officer = await createUser(t.id, { role: "loan_officer" });
    const res = await request(app)
      .get("/api/automation/status")
      .set("Authorization", auth(officer));
    expect(res.status).toBe(403);
  });
});
