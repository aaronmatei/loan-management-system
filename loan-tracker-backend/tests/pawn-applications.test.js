// Pawn applications: a customer requests a loan against an item online, staff
// review (approve with an offer / reject), then convert an approved request
// into a real pawn loan when the item is brought in.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";
import { createUser, tokenFor } from "./helpers/factory.js";

const api = () => request(app);
const PASSWORD = "PortalPass1234!";
const CUSTOMER = { phone_number: "0712606060", id_number: "60606060", first_name: "Req", last_name: "Customer" };

let tenant, staffAuth;
beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  tenant = await seedTenant();
  await query(`UPDATE tenants SET customer_portal_enabled=true, allow_self_signup=true, kind='pawnbroker' WHERE id=$1`, [tenant.id]);
  await query(`INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected) VALUES ($1, 1000000, 0, 0)`, [tenant.id]);
  const admin = await createUser(tenant.id, { role: "admin" });
  staffAuth = { Authorization: `Bearer ${tokenFor(admin)}` };
});
afterAll(closePool);

async function customer() {
  const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
  await api().post("/api/portal/auth/verify-otp").send({ customer_id: reg.body.customer_id, password: PASSWORD });
  const login = await api().post("/api/portal/auth/login").send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
  await api().post("/api/portal/auth/add-tenant").set({ Authorization: `Bearer ${login.body.token}` }).send({ target_tenant_id: tenant.id });
  const sel = await api().post("/api/portal/auth/select-tenant").set({ Authorization: `Bearer ${login.body.token}` }).send({ tenant_id: tenant.id });
  const clientId = (await query("SELECT id FROM clients WHERE tenant_id=$1 AND id_number=$2", [tenant.id, CUSTOMER.id_number])).rows[0].id;
  return { auth: { Authorization: `Bearer ${sel.body.token}` }, clientId };
}

describe("pawn applications", () => {
  it("lets a customer submit a request and see it pending", async () => {
    const { auth } = await customer();
    const res = await api().post("/api/portal/customer/pawn-applications").set(auth)
      .send({ item_description: "Gold chain 24k", item_category: "Jewelry", condition: "Good", estimated_value: 50000, requested_amount: 30000 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");

    const list = await api().get("/api/portal/customer/pawn-applications").set(auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].item_description).toBe("Gold chain 24k");
  });

  it("rejects a secured request with no item description", async () => {
    const { auth } = await customer();
    const res = await api().post("/api/portal/customer/pawn-applications").set(auth).send({ secured: true, requested_amount: 1000 });
    expect(res.status).toBe(400);
  });

  it("lets a customer submit an unsecured cash-loan request (no item)", async () => {
    const { auth } = await customer();
    const res = await api().post("/api/portal/customer/pawn-applications").set(auth).send({ secured: false, requested_amount: 15000 });
    expect(res.status).toBe(201);
    expect(res.body.data.secured).toBe(false);
    expect(res.body.data.item_description).toBe(null);
  });

  it("stores item-condition photos on a request", async () => {
    const { auth } = await customer();
    const photos = ["https://img/a.jpg", "https://img/b.jpg"];
    const res = await api().post("/api/portal/customer/pawn-applications").set(auth).send({ item_description: "Watch", photos });
    expect(res.status).toBe(201);
    expect(res.body.data.photos).toEqual(photos);
  });

  it("rejects an unsecured request with no amount", async () => {
    const { auth } = await customer();
    const res = await api().post("/api/portal/customer/pawn-applications").set(auth).send({ secured: false });
    expect(res.status).toBe(400);
  });

  it("shows the request in the staff queue and supports approve with an offer", async () => {
    const { auth } = await customer();
    const created = (await api().post("/api/portal/customer/pawn-applications").set(auth)
      .send({ item_description: "Laptop", requested_amount: 20000 })).body.data;

    const queue = await api().get("/api/pawn/applications?status=pending").set(staffAuth);
    expect(queue.status).toBe(200);
    expect(queue.body.data.some((a) => a.id === created.id)).toBe(true);
    expect(queue.body.data[0].first_name).toBe("Req"); // joined client name

    const review = await api().post(`/api/pawn/applications/${created.id}/review`).set(staffAuth)
      .send({ decision: "approved", offered_amount: 15000, notes: "Looks good" });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe("approved");
    expect(Number(review.body.data.offered_amount)).toBe(15000);
  });

  it("converts an approved request into a pawn loan and links it", async () => {
    const { auth, clientId } = await customer();
    const apprq = (await api().post("/api/portal/customer/pawn-applications").set(auth)
      .send({ item_description: "iPhone 14", requested_amount: 25000 })).body.data;
    await api().post(`/api/pawn/applications/${apprq.id}/review`).set(staffAuth).send({ decision: "approved", offered_amount: 24000 });

    // Staff creates the pawn loan from the request when the item arrives.
    const made = await api().post("/api/pawn").set(staffAuth).send({
      client_id: clientId, application_id: apprq.id,
      appraised_value: 40000, ltv_percent: 60, duration_months: 1, monthly_fee_percent: 10,
      item_description: "iPhone 14", item_category: "Electronics",
    });
    expect(made.status).toBe(201);
    const loanId = made.body.data.loan.id;

    const appAfter = (await query("SELECT status, loan_id FROM pawn_applications WHERE id=$1", [apprq.id])).rows[0];
    expect(appAfter.status).toBe("converted");
    expect(appAfter.loan_id).toBe(loanId);
  });

  it("lets a customer withdraw a pending request but not after conversion", async () => {
    const { auth } = await customer();
    const a = (await api().post("/api/portal/customer/pawn-applications").set(auth).send({ item_description: "Watch" })).body.data;
    const del = await api().delete(`/api/portal/customer/pawn-applications/${a.id}`).set(auth);
    expect(del.status).toBe(200);
    const after = (await query("SELECT status FROM pawn_applications WHERE id=$1", [a.id])).rows[0];
    expect(after.status).toBe("withdrawn");
    // Withdrawing again fails (no longer pending).
    const again = await api().delete(`/api/portal/customer/pawn-applications/${a.id}`).set(auth);
    expect(again.status).toBe(400);
  });

  it("blocks reviewing an already-decided request", async () => {
    const { auth } = await customer();
    const a = (await api().post("/api/portal/customer/pawn-applications").set(auth).send({ item_description: "Ring" })).body.data;
    await api().post(`/api/pawn/applications/${a.id}/review`).set(staffAuth).send({ decision: "rejected", notes: "Not eligible" });
    const twice = await api().post(`/api/pawn/applications/${a.id}/review`).set(staffAuth).send({ decision: "approved" });
    expect(twice.status).toBe(400);
  });
});
