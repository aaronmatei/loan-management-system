// Tenant-facing billing: generating an invoice notifies the tenant's admins
// in-app, and a tenant can list only its own invoices.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, createClient, createLoan, tokenFor } from "./helpers/factory.js";
import { generateInvoice } from "../src/services/billingService.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
let n = 0;
const txCode = () => `TX-BILL-${Date.now()}-${n++}`;

// A completed payment this month so the invoice has interest to bill.
async function seedPayment(tenantId, clientId, loanId) {
  await query(
    `INSERT INTO transactions
       (transaction_code, loan_id, client_id, amount_paid, payment_date,
        payment_method, payment_status, tenant_id)
     VALUES ($1,$2,$3, 56000, CURRENT_DATE, 'mpesa', 'completed', $4)`,
    [txCode(), loanId, clientId, tenantId],
  );
}

afterAll(closePool);

describe("tenant billing", () => {
  it("notifies the tenant's admins in-app when an invoice is generated", async () => {
    const t = await createTenant({ billing_enabled: true });
    const admin = await createUser(t.id, { role: "admin" });
    const client = await createClient(t.id);
    const loan = await createLoan(t.id, client.id, { status: "active" });
    await seedPayment(t.id, client.id, loan.id);

    const now = new Date();
    const invoice = await generateInvoice(
      t.id,
      now.getFullYear(),
      now.getMonth() + 1,
      admin.id,
    );
    expect(invoice.id).toBeTruthy();

    const notif = await query(
      `SELECT * FROM notifications WHERE user_id = $1 AND type = 'invoice_generated'`,
      [admin.id],
    );
    expect(notif.rows.length).toBeGreaterThanOrEqual(1);
    expect(notif.rows[0].link).toBe("/billing");
  });

  it("lists only the caller tenant's invoices", async () => {
    const t1 = await createTenant({ billing_enabled: true });
    const a1 = await createUser(t1.id, { role: "admin" });
    const c1 = await createClient(t1.id);
    const l1 = await createLoan(t1.id, c1.id, { status: "active" });
    await seedPayment(t1.id, c1.id, l1.id);
    const now = new Date();
    await generateInvoice(t1.id, now.getFullYear(), now.getMonth() + 1, a1.id);

    const t2 = await createTenant({ billing_enabled: true });
    const a2 = await createUser(t2.id, { role: "admin" });

    const r1 = await request(app)
      .get("/api/billing/invoices")
      .set("Authorization", auth(a1));
    expect(r1.status).toBe(200);
    expect(r1.body.data.length).toBeGreaterThanOrEqual(1);

    const r2 = await request(app)
      .get("/api/billing/invoices")
      .set("Authorization", auth(a2));
    expect(r2.status).toBe(200);
    expect(r2.body.data).toHaveLength(0);
  });

  it("exposes a billing summary", async () => {
    const t = await createTenant({ billing_enabled: true });
    const admin = await createUser(t.id, { role: "admin" });
    const res = await request(app)
      .get("/api/billing/summary")
      .set("Authorization", auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("outstanding");
  });
});
