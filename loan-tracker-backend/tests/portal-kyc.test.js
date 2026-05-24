// KYC identity-document endpoints + the dormant-gate guarantee.
//
// Cloudinary is NOT configured in the test env, so we verify the safe
// fallback: the upload gate stays OFF (needs_kyc=false) and uploads are
// rejected with 503 until storage is provisioned — so the portal is never
// bricked before Cloudinary env vars are set.
import request from "supertest";
import app from "../src/app.js";
import { truncate, seedTenant, query, closePool } from "./helpers/db.js";

const api = () => request(app);

const CUSTOMER = {
  phone_number: "0712345678",
  id_number: "55667788",
  first_name: "Ken",
  last_name: "Yatta",
};
const PASSWORD = "PortalPass1234!";

beforeEach(async () => {
  await truncate("tenants", "platform_customers");
  await seedTenant();
});

afterAll(closePool);

// Register → verify → login; returns a customer auth header + the login body.
async function loginCustomer() {
  const reg = await api().post("/api/portal/auth/register").send(CUSTOMER);
  const customerId = reg.body.customer_id;
  await api()
    .post("/api/portal/auth/verify-otp")
    .send({ customer_id: customerId, password: PASSWORD });
  const login = await api()
    .post("/api/portal/auth/login")
    .send({ phone_number: CUSTOMER.phone_number, password: PASSWORD });
  return { auth: { Authorization: `Bearer ${login.body.token}` }, login };
}

describe("customer portal — KYC documents", () => {
  it("reports no documents and storage disabled for a fresh customer", async () => {
    const { auth } = await loginCustomer();
    const res = await api().get("/api/portal/customer/kyc").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.kyc_complete).toBe(false);
    expect(res.body.data.cloudinary_enabled).toBe(false);
    expect(res.body.data.profile_photo_url).toBeFalsy();
    expect(res.body.data.id_front_url).toBeFalsy();
    expect(res.body.data.id_back_url).toBeFalsy();
  });

  it("keeps the upload gate dormant when storage is not configured", async () => {
    const { login } = await loginCustomer();
    // The gate is driven by needs_kyc; it must be false while Cloudinary is
    // unconfigured so customers are not locked out.
    expect(login.body.customer.needs_kyc).toBe(false);
  });

  it("rejects an upload with 503 when storage is not configured", async () => {
    const { auth } = await loginCustomer();
    const res = await api()
      .post("/api/portal/customer/kyc")
      .set(auth)
      .attach("profile_photo", Buffer.from("fake-image-bytes"), {
        filename: "dp.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(503);
  });

  it("computes kyc_complete once all three documents are on the record", async () => {
    const { auth } = await loginCustomer();
    // Simulate documents already stored (e.g. uploaded when storage was live).
    await query(
      `UPDATE platform_customers
          SET profile_photo_url = 'https://cdn/x/dp.jpg',
              id_front_url      = 'https://cdn/x/front.jpg',
              id_back_url       = 'https://cdn/x/back.jpg'
        WHERE phone_number = $1`,
      ["+254712345678"],
    );
    const res = await api().get("/api/portal/customer/kyc").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.kyc_complete).toBe(true);
    expect(res.body.data.id_front_url).toBe("https://cdn/x/front.jpg");
  });
});
