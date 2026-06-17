// Welfare member numbers carry the welfare's initials: MBR-<PREFIX>-<NNNNN>
// (e.g. "Real OGs" -> MBR-ROG-00001), and the sequence climbs per welfare.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";
import { welfarePrefix } from "../src/utils/clientCode.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

describe("welfarePrefix", () => {
  it("acronyms the welfare name to 3 letters", () => {
    expect(welfarePrefix("Real OGs")).toBe("ROG");
    expect(welfarePrefix("Umoja")).toBe("UMO");
    expect(welfarePrefix("Umoja Welfare Group")).toBe("UWG");
    expect(welfarePrefix("real-ogs")).toBe("ROG"); // hyphen splits too
    expect(welfarePrefix("")).toBe("WEL"); // fallback
    expect(welfarePrefix("A")).toBe("AXX"); // padded
  });
});

describe("welfare member numbering", () => {
  async function welfare(name) {
    const t = await createTenant();
    await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
    const admin = await createUser(t.id, { role: "admin" });
    const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name })).body.data;
    return { t, admin, w };
  }
  const addMember = (admin, w, i) =>
    request(app).post(`/api/welfares/${w.id}/members`).set("Authorization", auth(admin))
      .send({ first_name: "M" + i, last_name: "Test", id_number: `IDC${w.id}${i}` });

  it("prefixes member numbers with the welfare initials and increments per welfare", async () => {
    const { admin, w } = await welfare("Real OGs");
    const a = (await addMember(admin, w, 1)).body.data;
    const b = (await addMember(admin, w, 2)).body.data;
    expect(a.member_no).toBe("MBR-ROG-00001");
    expect(b.member_no).toBe("MBR-ROG-00002");
  });

  it("continues the sequence past a legacy prefix-less member", async () => {
    const { admin, w } = await welfare("Jasiri Chama");
    // Simulate a pre-existing legacy member numbered the old way.
    await query(
      `INSERT INTO members (tenant_id, welfare_id, member_no, first_name, last_name)
       VALUES ($1,$2,'MBR-00007','Old','Member')`,
      [w.tenant_id, w.id],
    );
    const next = (await addMember(admin, w, 1)).body.data;
    expect(next.member_no).toBe("MBR-JCH-00008"); // climbs from 7, with the new prefix
  });
});
