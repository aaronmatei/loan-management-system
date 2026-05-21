// End-to-end integration test for the customer-portal apply flow, hitting
// the real Express app + loan_tracker_test DB via Supertest. Walks the exact
// sequence the UI performs:
//   register → OTP verify → login → browse lenders → link a lender →
//   select-tenant → submit application → see it in My Applications →
//   confirm unlink is blocked while it's pending.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);

const CUSTOMER = {
  phone_number: "0712345678",
  id_number: "33445566",
  first_name: "Jane",
  last_name: "Borrower",
  date_of_birth: "1995-05-20",
  gender: "female",
};
const PASSWORD = "PortalPass1234!";

let tenant;

beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  // Make the seeded tenant a real, borrowable lender that shows in the
  // directory and accepts self-signup.
  await query(
    `UPDATE tenants
        SET customer_portal_enabled = true,
            allow_self_signup       = true,
            default_interest_rate   = 36,
            min_loan_amount         = 1000,
            max_loan_amount         = 500000,
            default_loan_duration   = 6
      WHERE id = $1`,
    [tenant.id],
  );
});

afterAll(closePool);

describe("customer portal — full apply flow", () => {
  it("registers, links a lender, applies, and the application appears", async () => {
    // 1. Register (tenant-less)
    const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
    expect(reg.status).toBe(200);
    expect(reg.body.requires_otp).toBe(true);
    const customerId = reg.body.customer_id;
    expect(customerId).toBeTruthy();

    // 2. SMS is disabled in test, so read the OTP straight off the row.
    const otpRow = await query(
      "SELECT otp_code FROM platform_customers WHERE id = $1",
      [customerId],
    );
    const otp = otpRow.rows[0].otp_code;
    expect(otp).toMatch(/^\d{6}$/);

    // 3. Verify OTP + set the password
    const verify = await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: customerId, otp, password: PASSWORD });
    expect(verify.status).toBe(200);
    expect(typeof verify.body.token).toBe("string");

    // 4. Login — no lenders linked yet → land on dashboard ("add_lender")
    const login = await api()
      .post("/api/portal/auth/login")
      .send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.action).toBe("add_lender");
    const token = login.body.token;
    const auth = { Authorization: `Bearer ${token}` };

    // 5. Lender directory lists the seeded lender, not yet linked
    const dir = await api().get("/api/portal/customer/lenders").set(auth);
    expect(dir.status).toBe(200);
    const entry = dir.body.data.find((l) => l.tenant_id === tenant.id);
    expect(entry).toBeTruthy();
    expect(entry.is_linked).toBe(false);
    expect(entry.can_self_signup).toBe(true);
    expect(parseFloat(entry.max_amount)).toBe(500000);

    // 6. Lender detail before linking
    const detail1 = await api()
      .get(`/api/portal/customer/lenders/${tenant.id}`)
      .set(auth);
    expect(detail1.status).toBe(200);
    expect(detail1.body.data.is_linked).toBe(false);

    // 7. Link the lender (creates the client + active link)
    const link = await api().post("/api/portal/auth/add-tenant").send({
      target_tenant_id: tenant.id,
      customer_id: customerId,
      password: PASSWORD,
    });
    expect(link.status).toBe(200);

    // 7b. Directory now marks the lender linked, with a link date
    const dir2 = await api().get("/api/portal/customer/lenders").set(auth);
    const linkedEntry = dir2.body.data.find((l) => l.tenant_id === tenant.id);
    expect(linkedEntry.is_linked).toBe(true);
    expect(linkedEntry.linked_at).toBeTruthy();

    // 8. The Apply form sources lenders from calculator-policies
    const pols = await api()
      .get("/api/portal/customer/calculator-policies")
      .set(auth);
    const pol = pols.body.data.find((p) => p.tenant_id === tenant.id);
    expect(pol).toBeTruthy();
    expect(parseFloat(pol.max_amount)).toBe(500000);

    // 9. Selecting the lender mints a tenant-scoped token
    const sel = await api()
      .post("/api/portal/auth/select-tenant")
      .set(auth)
      .send({ tenant_id: tenant.id });
    expect(sel.status).toBe(200);
    const scoped = { Authorization: `Bearer ${sel.body.token}` };

    // 10. Submit the application
    const apply = await api()
      .post("/api/portal/customer/applications")
      .set(scoped)
      .send({
        principal_amount: 50000,
        loan_duration_months: 6,
        purpose: "Business expansion",
      });
    expect(apply.status).toBe(201);
    const loanCode = apply.body.data.loan_code;
    expect(loanCode).toBeTruthy();

    // 11. It appears in My Applications (cross-lender), pending
    const apps = await api()
      .get("/api/portal/customer/all-applications")
      .set(auth);
    expect(apps.status).toBe(200);
    const found = apps.body.data.find((a) => a.loan_code === loanCode);
    expect(found).toBeTruthy();
    expect(found.tenant_name).toBe(tenant.business_name);
    expect(found.status).toBe("pending");

    // 11b. Dashboard analytics aggregate is available once linked
    const analytics = await api()
      .get("/api/portal/customer/analytics")
      .set(auth);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.has_lenders).toBe(true);
    // New borrower, no payments yet → neutral/unrated baseline
    expect(analytics.body.data.rated).toBe(false);
    expect(analytics.body.data.credit_score).toBeNull();
    expect(analytics.body.data.monthly_repayments).toHaveLength(6);

    // 12. Lender detail now reflects the link + the pending application
    const detail2 = await api()
      .get(`/api/portal/customer/lenders/${tenant.id}`)
      .set(auth);
    expect(detail2.body.data.is_linked).toBe(true);
    expect(detail2.body.data.pending_applications).toBeGreaterThanOrEqual(1);

    // 13. Unlinking is blocked while the application is pending
    const unlink = await api()
      .delete(`/api/portal/customer/lenders/${tenant.id}/link`)
      .set(auth);
    expect(unlink.status).toBe(400);
    expect(unlink.body.error).toMatch(/pending application/i);
  });

  it("rejects an application amount above the lender's max", async () => {
    // Register + verify + login quickly
    const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
    const customerId = reg.body.customer_id;
    const { rows } = await query(
      "SELECT otp_code FROM platform_customers WHERE id = $1",
      [customerId],
    );
    await api()
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: customerId, otp: rows[0].otp_code, password: PASSWORD });
    const login = await api()
      .post("/api/portal/auth/login")
      .send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
    const token = login.body.token;

    await api().post("/api/portal/auth/add-tenant").send({
      target_tenant_id: tenant.id,
      customer_id: customerId,
      password: PASSWORD,
    });
    const sel = await api()
      .post("/api/portal/auth/select-tenant")
      .set({ Authorization: `Bearer ${token}` })
      .send({ tenant_id: tenant.id });

    // 2,000,000 exceeds the global LOAN_POLICY ceiling (1,000,000)
    const apply = await api()
      .post("/api/portal/customer/applications")
      .set({ Authorization: `Bearer ${sel.body.token}` })
      .send({
        principal_amount: 2000000,
        loan_duration_months: 6,
        purpose: "Business expansion",
      });
    expect(apply.status).toBe(400);
  });
});
