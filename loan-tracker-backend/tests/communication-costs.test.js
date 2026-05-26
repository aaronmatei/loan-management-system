// Platform admin's per-tenant SMS + email cost summary, plus the trigger
// that fills tenant_id on logs from the linked loan/client when omitted.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

afterAll(closePool);

describe("communication costs", () => {
  it("auto-fills tenant_id from loan_id / client_id via the BEFORE INSERT trigger", async () => {
    const t = await createTenant();
    const client = await createClient(t.id);
    const loan = await createLoan(t.id, client.id, { status: "active" });

    // Insert without tenant_id — trigger should fill from loan.
    const sms = await query(
      `INSERT INTO sms_logs (loan_id, client_id, phone_number, message, status)
       VALUES ($1, $2, '+254700111222', 'hi', 'sent') RETURNING tenant_id`,
      [loan.id, client.id],
    );
    expect(sms.rows[0].tenant_id).toBe(t.id);

    // Insert with only client_id — trigger falls back to client's tenant.
    const email = await query(
      `INSERT INTO email_logs (client_id, recipient_email, subject, status)
       VALUES ($1, 'x@example.com', 'hello', 'sent') RETURNING tenant_id`,
      [client.id],
    );
    expect(email.rows[0].tenant_id).toBe(t.id);
  });

  it("sums sent SMS + emails per tenant and charges 1 KES each", async () => {
    const t = await createTenant();
    const admin = await createUser(t.id, {
      role: "admin",
      is_platform_admin: true,
    });
    const client = await createClient(t.id);
    const loan = await createLoan(t.id, client.id, { status: "active" });

    // 3 sent SMS, 1 failed SMS, 2 sent emails today.
    await query(
      `INSERT INTO sms_logs (tenant_id, loan_id, client_id, phone_number, message, status)
       VALUES
         ($1,$2,$3,'+254700000001','a','sent'),
         ($1,$2,$3,'+254700000001','b','sent'),
         ($1,$2,$3,'+254700000001','c','sent'),
         ($1,$2,$3,'+254700000001','d','failed')`,
      [t.id, loan.id, client.id],
    );
    await query(
      `INSERT INTO email_logs (tenant_id, loan_id, client_id, recipient_email, subject, status)
       VALUES
         ($1,$2,$3,'x@example.com','s1','sent'),
         ($1,$2,$3,'x@example.com','s2','sent')`,
      [t.id, loan.id, client.id],
    );

    const today = new Date().toISOString().split("T")[0];
    const res = await request(app)
      .get(`/api/platform/billing/communication-costs?from=${today}&to=${today}`)
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    const row = res.body.data.tenants.find((x) => x.tenant_id === t.id);
    expect(row).toBeTruthy();
    expect(row.sms_count).toBe(3); // failed excluded
    expect(row.email_count).toBe(2);
    expect(row.total_kes).toBe(5); // 3 + 2 at 1 KES each
  });

  it("forbids a non-platform-admin", async () => {
    const t = await createTenant();
    const staff = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .get("/api/platform/billing/communication-costs")
      .set("Authorization", auth(staff));
    expect(res.status).toBe(403);
  });
});
