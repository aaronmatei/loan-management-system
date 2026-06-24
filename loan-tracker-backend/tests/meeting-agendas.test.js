// Per-meeting agendas (migration 107) + minutes. Members suggest agenda items
// (appended); a member edits only their own; the admin harmonizes (edits/deletes
// any). Minutes upload is the secretary's job.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
const customerToken = (pcId, tenantId) =>
  "Bearer " + jwt.sign({ platform_customer_id: pcId, user_type: "customer", current_tenant_id: tenantId, current_client_id: null }, process.env.JWT_SECRET, { expiresIn: "1h" });
const pcId = async (phone) => (await query("SELECT id FROM platform_customers WHERE phone_number = $1", [phone])).rows[0].id;
afterAll(closePool);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  const mk = async (fn, phone, idn) => {
    const m = (await request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin)).send({ first_name: fn, last_name: "K", phone_number: phone, id_number: idn })).body.data;
    await request(app).post(`/api/welfares/${w.id}/members/${m.id}/invite`).set("Authorization", auth(admin));
    return m;
  };
  const a = await mk("Asha", "0795710101", "AG1");
  const b = await mk("Brian", "0795710102", "AG2");
  const tokA = customerToken(await pcId("+254795710101"), t.id);
  const tokB = customerToken(await pcId("+254795710102"), t.id);
  const mtg = (await request(app).post(`/api/welfares/${w.id}/meetings`).set("Authorization", auth(admin)).send({ title: "AGM", meeting_date: "2026-07-01" })).body.data;
  return { t, admin, w, a, b, tokA, tokB, mtg };
}

describe("meeting agendas + minutes", () => {
  it("admin items are the approved agenda; member items are pending suggestions", async () => {
    const { admin, w, tokA, mtg } = await setup();
    const sug = (await request(app).post(`/api/welfare/member/meetings/${mtg.id}/agenda`).set("Authorization", tokA).send({ content: "Budget review" })).body.data;
    expect(sug.status).toBe("suggested");
    expect(sug.author_name).toMatch(/Asha/);
    const adm = (await request(app).post(`/api/welfares/${w.id}/meetings/${mtg.id}/agenda`).set("Authorization", auth(admin)).send({ content: "Chair remarks" })).body.data;
    expect(adm.status).toBe("approved");

    const detail = (await request(app).get(`/api/welfares/${w.id}/meetings/${mtg.id}`).set("Authorization", auth(admin))).body.data;
    expect(detail.agenda.filter((x) => x.status === "approved").map((x) => x.content)).toEqual(["Chair remarks"]);
    expect(detail.agenda.filter((x) => x.status === "suggested").map((x) => x.content)).toEqual(["Budget review"]);
    const mdet = (await request(app).get(`/api/welfare/member/meetings/${mtg.id}`).set("Authorization", tokA)).body.data;
    expect(mdet.agenda).toHaveLength(2);
    expect(mdet.minutes).toEqual([]);
  });

  it("admin approves a suggestion (→ agenda) or rejects it (removed); approved is locked to the member", async () => {
    const { admin, w, tokA, tokB, mtg } = await setup();
    const keep = (await request(app).post(`/api/welfare/member/meetings/${mtg.id}/agenda`).set("Authorization", tokA).send({ content: "Keep me" })).body.data;
    const drop = (await request(app).post(`/api/welfare/member/meetings/${mtg.id}/agenda`).set("Authorization", tokB).send({ content: "Reject me" })).body.data;

    expect((await request(app).put(`/api/welfares/${w.id}/meetings/${mtg.id}/agenda/${keep.id}`).set("Authorization", auth(admin)).send({ status: "approved" })).status).toBe(200);
    expect((await request(app).delete(`/api/welfares/${w.id}/meetings/${mtg.id}/agenda/${drop.id}`).set("Authorization", auth(admin))).status).toBe(200);

    const agenda = (await request(app).get(`/api/welfares/${w.id}/meetings/${mtg.id}`).set("Authorization", auth(admin))).body.data.agenda;
    expect(agenda.find((x) => x.id === keep.id).status).toBe("approved");
    expect(agenda.find((x) => x.id === drop.id)).toBeUndefined();
    // Once approved it's the official agenda — the member can no longer edit it.
    expect((await request(app).put(`/api/welfare/member/meetings/${mtg.id}/agenda/${keep.id}`).set("Authorization", tokA).send({ content: "sneaky" })).status).toBe(403);
  });

  it("a member edits ONLY their own item; the admin harmonizes any", async () => {
    const { admin, w, tokA, tokB, mtg } = await setup();
    const mine = (await request(app).post(`/api/welfare/member/meetings/${mtg.id}/agenda`).set("Authorization", tokA).send({ content: "Mine" })).body.data;
    const other = (await request(app).post(`/api/welfare/member/meetings/${mtg.id}/agenda`).set("Authorization", tokB).send({ content: "Theirs" })).body.data;

    expect((await request(app).put(`/api/welfare/member/meetings/${mtg.id}/agenda/${mine.id}`).set("Authorization", tokA).send({ content: "Mine edited" })).status).toBe(200);
    expect((await request(app).put(`/api/welfare/member/meetings/${mtg.id}/agenda/${other.id}`).set("Authorization", tokA).send({ content: "hijack" })).status).toBe(403);
    expect((await request(app).delete(`/api/welfare/member/meetings/${mtg.id}/agenda/${other.id}`).set("Authorization", tokA)).status).toBe(403);

    expect((await request(app).put(`/api/welfares/${w.id}/meetings/${mtg.id}/agenda/${other.id}`).set("Authorization", auth(admin)).send({ content: "Harmonized" })).status).toBe(200);
    expect((await request(app).delete(`/api/welfares/${w.id}/meetings/${mtg.id}/agenda/${mine.id}`).set("Authorization", auth(admin))).status).toBe(200);
  });

  it("only the secretary may upload minutes", async () => {
    const { admin, w, a, tokA, mtg } = await setup();
    // Ordinary member → blocked before any storage work.
    expect((await request(app).post(`/api/welfare/member/documents`).set("Authorization", tokA)
      .field("category", "minutes").field("meeting_id", String(mtg.id)).field("title", "Minutes")).status).toBe(403);
    // Make Asha the secretary → the gate passes (storage isn't configured in tests, so 503, NOT 403).
    await request(app).put(`/api/welfares/${w.id}/members/${a.id}/role`).set("Authorization", auth(admin)).send({ role: "secretary" });
    expect((await request(app).post(`/api/welfare/member/documents`).set("Authorization", tokA)
      .field("category", "minutes").field("meeting_id", String(mtg.id)).field("title", "Minutes")).status).not.toBe(403);
  });
});
