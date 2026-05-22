// Counter-offer flow: a lender reduces the principal during review and sends
// it back; the client accepts (principal := offered, status approved) or
// rejects (status rejected). Drives the real staff + customer-portal routes.
import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query } from "../src/config/database.js";
import {
  createTenant,
  createUser,
  createClient,
  createLoan,
  tokenFor,
} from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;

let n = 0;
const uniqDigits = () => String(700000000 + n++) + Math.floor(Math.random() * 90 + 10);

// Build a verifyCustomer-valid platform customer + link, and a customer JWT
// scoped to (tenant, client) — matching what the portal login issues.
async function makeCustomer(tenantId, clientId) {
  const pc = await query(
    `INSERT INTO platform_customers
       (phone_number, id_number, first_name, last_name, is_active)
     VALUES ($1,$2,'Cust','Omer',true) RETURNING id`,
    [`0${uniqDigits()}`, `ID${uniqDigits()}`],
  );
  const pcId = pc.rows[0].id;
  await query(
    `INSERT INTO customer_tenant_links
       (platform_customer_id, tenant_id, client_id, status)
     VALUES ($1,$2,$3,'active')`,
    [pcId, tenantId, clientId],
  );
  const token = jwt.sign(
    {
      user_type: "customer",
      platform_customer_id: pcId,
      current_tenant_id: tenantId,
      current_client_id: clientId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
  return token;
}

describe("Counter-offer — staff POST /api/loans/:id/counter-offer", () => {
  it("reduces the principal and moves the loan to counter_offered", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "under_review",
      principal_amount: 50000,
    });

    const res = await request(app)
      .post(`/api/loans/${loan.id}/counter-offer`)
      .set("Authorization", auth(admin))
      .send({ offered_amount: 30000, note: "Qualifies for 30k" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("counter_offered");
    expect(parseFloat(res.body.data.offered_amount)).toBe(30000);
    expect(parseFloat(res.body.data.requested_amount)).toBe(50000);
    // Principal is unchanged until the client accepts.
    expect(parseFloat(res.body.data.principal_amount)).toBe(50000);
  });

  it("rejects an offer not lower than the requested amount (400)", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "under_review",
      principal_amount: 50000,
    });
    const res = await request(app)
      .post(`/api/loans/${loan.id}/counter-offer`)
      .set("Authorization", auth(admin))
      .send({ offered_amount: 50000 });
    expect(res.status).toBe(400);
  });

  it("rejects a non-positive offer (400)", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "under_review",
      principal_amount: 50000,
    });
    const res = await request(app)
      .post(`/api/loans/${loan.id}/counter-offer`)
      .set("Authorization", auth(admin))
      .send({ offered_amount: 0 });
    expect(res.status).toBe(400);
  });

  it("cannot counter-offer a loan that isn't pending/under_review (400)", async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id);
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "active",
      principal_amount: 50000,
    });
    const res = await request(app)
      .post(`/api/loans/${loan.id}/counter-offer`)
      .set("Authorization", auth(admin))
      .send({ offered_amount: 30000 });
    expect(res.status).toBe(400);
  });

  it("cannot counter-offer another tenant's loan (404)", async () => {
    const t1 = await createTenant();
    const t2 = await createTenant();
    const admin2 = await createUser(t2.id);
    const client1 = await createClient(t1.id);
    const loan1 = await createLoan(t1.id, client1.id, {
      status: "under_review",
      principal_amount: 50000,
    });
    const res = await request(app)
      .post(`/api/loans/${loan1.id}/counter-offer`)
      .set("Authorization", auth(admin2))
      .send({ offered_amount: 30000 });
    expect(res.status).toBe(404);
  });
});

describe("Counter-offer — customer POST /api/portal/customer/applications/:id/respond", () => {
  // Stand up an under_review loan, make a counter-offer, return ids + token.
  async function setupOffer() {
    const tenant = await createTenant();
    const admin = await createUser(tenant.id, { role: "admin" });
    const client = await createClient(tenant.id);
    const loan = await createLoan(tenant.id, client.id, {
      status: "under_review",
      principal_amount: 50000,
    });
    await request(app)
      .post(`/api/loans/${loan.id}/counter-offer`)
      .set("Authorization", auth(admin))
      .send({ offered_amount: 30000 });
    const token = await makeCustomer(tenant.id, client.id);
    return { loan, token };
  }

  it("accept → principal becomes the offered amount and status is approved", async () => {
    const { loan, token } = await setupOffer();
    const res = await request(app)
      .post(`/api/portal/customer/applications/${loan.id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ accept: true });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("approved");
    expect(parseFloat(res.body.data.principal_amount)).toBe(30000);
  });

  it("reject → status becomes rejected with a reason", async () => {
    const { loan, token } = await setupOffer();
    const res = await request(app)
      .post(`/api/portal/customer/applications/${loan.id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ accept: false, reason: "Too little" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("rejected");
  });

  it("requires `accept` to be a boolean (400)", async () => {
    const { loan, token } = await setupOffer();
    const res = await request(app)
      .post(`/api/portal/customer/applications/${loan.id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
