// "My Loans" (/all-loans) shows ONLY disbursed loans (active/completed/
// defaulted). Pre-disbursement loans — including an 'approved' loan (an
// accepted counter-offer) — stay in "My Applications" (/all-applications)
// until the lender disburses.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);
const PASSWORD = "PortalPass1234!";
const CUSTOMER = {
  phone_number: "0712808080",
  id_number: "80808080",
  first_name: "Loan",
  last_name: "Stages",
};

let tenant;
beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  await query(
    `UPDATE tenants SET customer_portal_enabled = true, allow_self_signup = true WHERE id = $1`,
    [tenant.id],
  );
});
afterAll(closePool);

async function loginAndLink() {
  const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
  const customerId = reg.body.customer_id;
  await api()
    .post("/api/portal/auth/verify-otp")
    .send({ customer_id: customerId, password: PASSWORD });
  const login = await api()
    .post("/api/portal/auth/login")
    .send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
  await api()
    .post("/api/portal/auth/add-tenant")
    .send({ target_tenant_id: tenant.id, customer_id: customerId, password: PASSWORD });
  const auth = { Authorization: `Bearer ${login.body.token}` };
  const clientId = (
    await query(
      "SELECT id FROM clients WHERE tenant_id = $1 AND id_number = $2",
      [tenant.id, CUSTOMER.id_number],
    )
  ).rows[0].id;
  return { auth, clientId };
}

const seedLoan = (clientId, code, status) =>
  query(
    `INSERT INTO loans (tenant_id, client_id, loan_code, principal_amount, interest_rate,
       total_interest, total_amount_due, loan_duration_months, status, created_at)
     VALUES ($1,$2,$3,10000,3,1800,11800,6,$4,NOW())`,
    [tenant.id, clientId, code, status],
  );

describe("My Loans shows only disbursed loans", () => {
  it("excludes approved (accepted-offer) loans, includes active ones", async () => {
    const { auth, clientId } = await loginAndLink();
    await seedLoan(clientId, "LN-APPR-1", "approved"); // accepted offer, awaiting disbursement
    await seedLoan(clientId, "LN-ACTV-1", "active"); // disbursed
    await seedLoan(clientId, "LN-DONE-1", "completed");
    await seedLoan(clientId, "LN-PEND-1", "pending");

    const loans = await api().get("/api/portal/customer/all-loans").set(auth);
    expect(loans.status).toBe(200);
    const codes = loans.body.data.loans.map((l) => l.loan_code);
    expect(codes).toContain("LN-ACTV-1");
    expect(codes).toContain("LN-DONE-1");
    expect(codes).not.toContain("LN-APPR-1"); // approved is NOT disbursed
    expect(codes).not.toContain("LN-PEND-1");
    expect(loans.body.data.summary.total_loans).toBe(2); // active + completed

    // The approved loan still appears in My Applications.
    const apps = await api()
      .get("/api/portal/customer/all-applications")
      .set(auth);
    const appCodes = apps.body.data.map((l) => l.loan_code);
    expect(appCodes).toContain("LN-APPR-1");
    expect(appCodes).toContain("LN-PEND-1");
    expect(appCodes).not.toContain("LN-ACTV-1");
  });
});
