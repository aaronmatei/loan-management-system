// Group/business clients capture extra details (registration no, meeting
// frequency, member count) added in migration 064. A "group" is just a client
// with client_type='group'.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

let seq = 0;
async function adminOf() {
  const t = await createTenant();
  return createUser(t.id, { role: "admin" });
}
const phone = () => `07120000${String(10 + seq++).padStart(2, "0")}`;

describe("client group/business detail fields", () => {
  it("creates a group client with registration no, meeting frequency and member count", async () => {
    const admin = await adminOf();
    const res = await request(app).post("/api/clients").set("Authorization", auth(admin)).send({
      client_type: "group",
      first_name: "Jane",
      last_name: "Contact",
      phone_number: phone(),
      business_name: "Maendeleo Chama",
      business_type: "Farming",
      registration_no: "SG/12345",
      meeting_frequency: "monthly",
      member_count: 12,
    });
    expect(res.status).toBe(201);
    const c = res.body.data;
    expect(c.client_type).toBe("group");
    expect(c.business_name).toBe("Maendeleo Chama");
    expect(c.registration_no).toBe("SG/12345");
    expect(c.meeting_frequency).toBe("monthly");
    expect(c.member_count).toBe(12);
  });

  it("creates a business client with a registration no (no meeting fields)", async () => {
    const admin = await adminOf();
    const res = await request(app).post("/api/clients").set("Authorization", auth(admin)).send({
      client_type: "business",
      first_name: "Owner",
      last_name: "Person",
      phone_number: phone(),
      business_name: "John's Shop",
      registration_no: "PVT-2024-001",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.registration_no).toBe("PVT-2024-001");
    expect(res.body.data.member_count).toBe(null);
  });

  it("rejects an invalid meeting frequency", async () => {
    const admin = await adminOf();
    const res = await request(app).post("/api/clients").set("Authorization", auth(admin)).send({
      client_type: "group",
      first_name: "Jane",
      last_name: "Contact",
      phone_number: phone(),
      meeting_frequency: "fortnightly",
    });
    expect(res.status).toBe(400);
  });

  it("updates the group fields", async () => {
    const admin = await adminOf();
    const created = (await request(app).post("/api/clients").set("Authorization", auth(admin)).send({
      client_type: "group", first_name: "Jane", last_name: "Contact", phone_number: phone(),
      business_name: "Umoja", meeting_frequency: "weekly", member_count: 5,
    })).body.data;

    const upd = await request(app).put(`/api/clients/${created.id}`).set("Authorization", auth(admin)).send({
      first_name: "Jane", last_name: "Contact", phone_number: created.phone_number,
      client_type: "group", business_name: "Umoja", meeting_frequency: "monthly", member_count: 8, registration_no: "REG-9",
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.meeting_frequency).toBe("monthly");
    expect(upd.body.data.member_count).toBe(8);
    expect(upd.body.data.registration_no).toBe("REG-9");
  });

  it("leaves individual clients unaffected (no group fields)", async () => {
    const admin = await adminOf();
    const res = await request(app).post("/api/clients").set("Authorization", auth(admin)).send({
      client_type: "individual", first_name: "Solo", last_name: "Borrower", phone_number: phone(), gender: "male",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.registration_no).toBe(null);
    expect(res.body.data.meeting_frequency).toBe(null);
    expect(res.body.data.member_count).toBe(null);
  });
});
