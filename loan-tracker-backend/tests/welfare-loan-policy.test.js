// Welfare loan policy (migration 102): default loan terms, mirroring the lender's
// Loan Settings → Loan Policy. Round-trips via /settings + /settings/loan-policy.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { query, closePool } from "./helpers/db.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

const auth = (u) => `Bearer ${tokenFor(u)}`;
afterAll(closePool);

async function setup() {
  const t = await createTenant();
  await query("UPDATE tenants SET kind='welfare' WHERE id=$1", [t.id]);
  const admin = await createUser(t.id, { role: "admin" });
  const officer = await createUser(t.id, { role: "loan_officer" });
  const w = (await request(app).post("/api/groups").set("Authorization", auth(admin)).send({ name: "Umoja" })).body.data;
  return { admin, officer, w };
}

describe("welfare loan policy", () => {
  it("saves + reads default loan terms, coerces method, gates by role", async () => {
    const { admin, officer, w } = await setup();
    const base = `/api/welfares/${w.id}`;

    const saved = (await request(app).put(`${base}/settings/loan-policy`).set("Authorization", auth(admin))
      .send({ default_loan_interest_rate: 24, default_loan_interest_method: "reducing", default_loan_processing_fee_rate: 2, default_loan_late_fee: 100, default_loan_penalty_rate: 1.5 })).body.data;
    expect(Number(saved.default_loan_interest_rate)).toBe(24);
    expect(saved.default_loan_interest_method).toBe("reducing");
    expect(Number(saved.default_loan_processing_fee_rate)).toBe(2);

    // Visible on the settings read the admin UI uses.
    const got = (await request(app).get(`${base}/settings`).set("Authorization", auth(admin))).body.data;
    expect(Number(got.default_loan_late_fee)).toBe(100);
    expect(Number(got.default_loan_penalty_rate)).toBe(1.5);

    // Bad method falls back to flat; settings round-trip doesn't disturb the policy.
    const reset = (await request(app).put(`${base}/settings/loan-policy`).set("Authorization", auth(admin)).send({ default_loan_interest_method: "wat" })).body.data;
    expect(reset.default_loan_interest_method).toBe("flat");

    // Non-admin can't write the policy.
    expect((await request(app).put(`${base}/settings/loan-policy`).set("Authorization", auth(officer)).send({ default_loan_interest_rate: 5 })).status).toBe(403);
  });
});
