// Welfare decisions / voting (migration 098): governance motions the group
// votes on. Quorum = ceil(quorum_percent of active members) approvals to pass;
// a motion auto-passes the moment approvals reach the threshold. Proposer or an
// officer can close/cancel; voting on a resolved motion is refused.
import { describe, it, expect, afterAll } from "vitest";
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

async function freshSetup() {
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
  return { admin, w, mk };
}
const vote = (tok, id, v) => request(app).post(`/api/welfare/member/decisions/${id}/vote`).set("Authorization", tok).send({ vote: v });

describe("welfare decisions / voting", () => {
  it("a motion auto-passes when approvals reach the quorum threshold", async () => {
    const { admin, w, mk } = await freshSetup();
    const a = await mk("Asha", "0795600101", "DEC1");
    const b = await mk("Brian", "0795600102", "DEC2");
    await mk("Cara", "0795600103", "DEC3"); // 3 active members → 50% quorum needs ceil(1.5)=2 approvals

    const open = await request(app).post(`/api/welfares/${w.id}/decisions`).set("Authorization", auth(admin))
      .send({ title: "Raise monthly contribution", quorum_percent: 50 });
    expect(open.status).toBe(201);
    expect(open.body.data.required_approvals).toBe(2);
    const id = open.body.data.id;

    const v1 = await vote(a.tok, id, "approve");
    expect(v1.body.data.status).toBe("open"); // 1 approval, not yet
    expect(v1.body.data.my_vote).toBe("approve");
    const v2 = await vote(b.tok, id, "approve");
    expect(v2.body.data.status).toBe("passed"); // 2 approvals → quorum met
    expect(v2.body.data.tally.approve).toBe(2);

    // Voting after resolution is refused.
    expect((await vote(a.tok, id, "reject")).status).toBe(409);
  });

  it("a member proposes a motion, another updates their vote, and an officer closes it as rejected", async () => {
    const { admin, w, mk } = await freshSetup();
    const a = await mk("Asha", "0795600201", "DEC4");
    const b = await mk("Brian", "0795600202", "DEC5");
    await request(app).put(`/api/welfares/${w.id}/members/${a.id}/role`).set("Authorization", auth(admin)).send({ role: "chair" });

    // Member B proposes; quorum 100% (needs all 2) so it won't auto-pass on one vote.
    const open = await request(app).post("/api/welfare/member/decisions").set("Authorization", b.tok)
      .send({ title: "Buy a group laptop", quorum_percent: 100 });
    expect(open.status).toBe(201);
    const id = open.body.data.id;
    expect(open.body.data.required_approvals).toBe(2);

    await vote(b.tok, id, "approve");
    const change = await vote(b.tok, id, "reject"); // B changes their mind
    expect(change.body.data.tally.reject).toBe(1);
    expect(change.body.data.tally.approve).toBe(0);

    // Chair (officer) closes it; 0 approvals < 2 required → rejected.
    const closed = await request(app).post(`/api/welfare/member/decisions/${id}/close`).set("Authorization", a.tok);
    expect(closed.body.data.status).toBe("rejected");

    // A non-proposer non-officer can't close someone else's motion.
    const c = await mk("Cara", "0795600203", "DEC6");
    const open2 = await request(app).post("/api/welfare/member/decisions").set("Authorization", a.tok).send({ title: "X" });
    expect((await request(app).post(`/api/welfare/member/decisions/${open2.body.data.id}/close`).set("Authorization", c.tok)).status).toBe(403);
  });

  it("lists decisions for members with their own vote attached", async () => {
    const { admin, w, mk } = await freshSetup();
    const a = await mk("Asha", "0795600301", "DEC7");
    const open = await request(app).post(`/api/welfares/${w.id}/decisions`).set("Authorization", auth(admin)).send({ title: "Motion 1" });
    await vote(a.tok, open.body.data.id, "abstain");
    const list = await request(app).get("/api/welfare/member/decisions").set("Authorization", a.tok);
    expect(list.body.data.decisions).toHaveLength(1);
    expect(list.body.data.decisions[0].my_vote).toBe("abstain");
  });
});

describe("welfare officer elections (Phase 4)", () => {
  it("a passed election assigns the officer role and demotes the prior holder", async () => {
    const { admin, w, mk } = await freshSetup();
    const a = await mk("Asha", "0795600401", "ELC1");
    const b = await mk("Brian", "0795600402", "ELC2");
    // Asha is the sitting chair; the election should hand the role to Brian.
    await request(app).put(`/api/welfares/${w.id}/members/${a.id}/role`).set("Authorization", auth(admin)).send({ role: "chair" });

    const open = await request(app).post(`/api/welfares/${w.id}/decisions`).set("Authorization", auth(admin))
      .send({ type: "election", target_member_id: b.id, target_role: "chair", quorum_percent: 50 });
    expect(open.status).toBe(201);
    expect(open.body.data.type).toBe("election");
    expect(open.body.data.title).toMatch(/Elect Brian K as chair/);
    const id = open.body.data.id;

    // 2 members, 50% quorum → 1 approval passes it.
    const voted = await vote(a.tok, id, "approve");
    expect(voted.body.data.status).toBe("passed");

    const roles = (await query("SELECT id, role FROM members WHERE welfare_id=$1", [w.id])).rows;
    expect(roles.find((r) => r.id === b.id).role).toBe("chair");   // elected
    expect(roles.find((r) => r.id === a.id).role).toBe("member");  // demoted
  });

  it("an ordinary member cannot start an officer election (downgraded to a motion)", async () => {
    const { w, mk } = await freshSetup();
    const a = await mk("Asha", "0795600501", "ELC3");
    const b = await mk("Brian", "0795600502", "ELC4");
    const open = await request(app).post("/api/welfare/member/decisions").set("Authorization", a.tok)
      .send({ type: "election", target_member_id: b.id, target_role: "chair", title: "Sneaky election" });
    expect(open.status).toBe(201);
    expect(open.body.data.type).toBe("motion"); // not allowed → plain motion
  });
});
