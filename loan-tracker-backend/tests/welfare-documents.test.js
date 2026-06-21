// Welfare documents (migration 097): shared files uploaded by staff or any
// member, viewable by members or restricted to officers. Cloudinary is mocked
// so the real upload → insert → list → delete path runs without a live account.
import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("../src/config/cloudinary.js", () => ({
  isCloudinaryConfigured: () => true,
  uploadBuffer: async () => ({ secure_url: "https://cdn.example/welfare-doc.pdf" }),
  default: {},
}));

import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

const customerToken = (pcId, tenantId) =>
  "Bearer " + jwt.sign({ platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null }, process.env.JWT_SECRET, { expiresIn: "1h" });
const pcIdByPhone = (phone) => query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone]).then((r) => r.rows[0].id);
const PDF = Buffer.from("%PDF-1.4 test");

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const tenantId = (await query("SELECT tenant_id FROM groups WHERE id=$1", [w.id])).rows[0].tenant_id;
  const mk = async (fn, phone, id) => {
    const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: fn, last_name: "K", phone_number: phone, id_number: id })).body.data;
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    return { ...m, tok: customerToken(await pcIdByPhone(`+254${phone.slice(1)}`), tenantId) };
  };
  return { t, admin, w, mk };
}

describe("welfare documents", () => {
  it("admin uploads, lists, and deletes a document", async () => {
    const { admin, w } = await setup();
    const up = await request(app).post(`/api/welfares/${w.id}/documents`).set("Authorization", auth(admin))
      .field("title", "March Minutes").field("category", "minutes")
      .attach("file", PDF, { filename: "march.pdf", contentType: "application/pdf" });
    expect(up.status).toBe(201);
    expect(up.body.data.file_url).toMatch(/^https:/);
    expect(up.body.data.category).toBe("minutes");

    const list = await request(app).get(`/api/welfares/${w.id}/documents`).set("Authorization", auth(admin));
    expect(list.body.data).toHaveLength(1);

    expect((await request(app).delete(`/api/welfares/${w.id}/documents/${up.body.data.id}`).set("Authorization", auth(admin))).status).toBe(200);
    expect((await request(app).get(`/api/welfares/${w.id}/documents`).set("Authorization", auth(admin))).body.data).toHaveLength(0);
  });

  it("members upload and see member-visible docs; officer-only docs are hidden from ordinary members", async () => {
    const { admin, w, mk } = await setup();
    const officer = await mk("Asha", "0795500101", "DOC1");
    const plain = await mk("Brian", "0795500102", "DOC2");
    await request(app).put(`/api/welfares/${w.id}/members/${officer.id}/role`).set("Authorization", auth(admin)).send({ role: "secretary" });

    // Ordinary member uploads a shared doc.
    const memberDoc = await request(app).post("/api/welfare/member/documents").set("Authorization", plain.tok)
      .field("title", "My receipt").attach("file", PDF, { filename: "r.pdf", contentType: "application/pdf" });
    expect(memberDoc.status).toBe(201);
    expect(memberDoc.body.data.visibility).toBe("members");

    // Officer posts an officer-only doc.
    const officerDoc = await request(app).post("/api/welfare/member/documents").set("Authorization", officer.tok)
      .field("title", "Board notes").field("visibility", "officers").attach("file", PDF, { filename: "b.pdf", contentType: "application/pdf" });
    expect(officerDoc.body.data.visibility).toBe("officers");

    // Plain member sees only the shared doc; officer sees both.
    const plainList = await request(app).get("/api/welfare/member/documents").set("Authorization", plain.tok);
    expect(plainList.body.data.documents).toHaveLength(1);
    expect(plainList.body.data.is_officer).toBe(false);
    const officerList = await request(app).get("/api/welfare/member/documents").set("Authorization", officer.tok);
    expect(officerList.body.data.documents).toHaveLength(2);

    // A non-uploader ordinary member can't delete someone else's doc; the officer can.
    expect((await request(app).delete(`/api/welfare/member/documents/${officerDoc.body.data.id}`).set("Authorization", plain.tok)).status).toBe(403);
    expect((await request(app).delete(`/api/welfare/member/documents/${memberDoc.body.data.id}`).set("Authorization", officer.tok)).status).toBe(200);
  });

  it("a member trying to post officer-only is downgraded to members visibility", async () => {
    const { w, mk } = await setup();
    const plain = await mk("Cara", "0795500201", "DOC3");
    const d = await request(app).post("/api/welfare/member/documents").set("Authorization", plain.tok)
      .field("title", "Sneaky").field("visibility", "officers").attach("file", PDF, { filename: "s.pdf", contentType: "application/pdf" });
    expect(d.body.data.visibility).toBe("members");
  });
});
