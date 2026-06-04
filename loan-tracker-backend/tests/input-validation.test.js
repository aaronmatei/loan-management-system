// Verifies the validate() helper rejects malformed input on the
// highest-risk routes BEFORE the handler runs. Each test sends a
// request that would silently break the handler (NaN amount, wrong
// payment_method enum, missing email) and asserts we get a clean 400.
//
// Helps catch regressions on the validation chains in payments.js,
// auth.js, and portal/auth.js the next time someone touches them.

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { createTenant, createUser, tokenFor } from "./helpers/factory.js";

let admin;
beforeAll(async () => {
  const tenant = await createTenant();
  admin = await createUser(tenant.id, { role: "admin" });
});

const auth = (u) => `Bearer ${tokenFor(u)}`;

describe("Input validation — payments POST /", () => {
  it("rejects a non-numeric amount_paid with 400", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: 1,
        amount_paid: "twenty bucks",
        payment_date: "2026-06-04",
        payment_method: "Cash",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount_paid/);
  });

  it("rejects a negative amount_paid with 400", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: 1,
        amount_paid: -100,
        payment_date: "2026-06-04",
        payment_method: "Cash",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a payment_method not in the allowed enum", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: 1,
        amount_paid: 100,
        payment_date: "2026-06-04",
        payment_method: "BTC",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payment_method/);
  });

  it("rejects a non-ISO date with 400", async () => {
    const res = await request(app)
      .post("/api/payments")
      .set("Authorization", auth(admin))
      .send({
        loan_id: 1,
        amount_paid: 100,
        payment_date: "yesterday",
        payment_method: "Cash",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/payment_date/);
  });
});

describe("Input validation — staff /auth/login", () => {
  it("rejects a malformed email with 400", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "anything" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it("rejects a missing password with 400", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com" });
    expect(res.status).toBe(400);
  });
});

describe("Input validation — customer portal /auth/login", () => {
  it("rejects gibberish in phone_number with 400", async () => {
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ phone_number: "<script>alert(1)</script>", password: "anything" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone_number/);
  });

  it("rejects a phone_number that's too short", async () => {
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ phone_number: "07", password: "anything" });
    expect(res.status).toBe(400);
  });
});

describe("Input validation — POST /clients (name/ID/city rules)", () => {
  const send = (body) =>
    request(app)
      .post("/api/clients")
      .set("Authorization", auth(admin))
      .send(body);

  it("rejects a first_name with digits", async () => {
    const res = await send({
      first_name: "egerer666",
      last_name: "Smith",
      phone_number: "0712345678",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/first_name/);
  });

  it("rejects a last_name with special characters", async () => {
    const res = await send({
      first_name: "Mary",
      last_name: "@#$%",
      phone_number: "0712345678",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last_name/);
  });

  it("accepts hyphens and apostrophes in names (Mary-Anne O'Brien)", async () => {
    // Validation passes — handler may still 4xx for tenant/branch
    // reasons, but it must NOT be a name-format rejection.
    const res = await send({
      first_name: "Mary-Anne",
      last_name: "O'Brien",
      phone_number: "0712345678",
    });
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/first_name|last_name/);
    }
  });

  it("rejects an id_number that contains letters", async () => {
    const res = await send({
      first_name: "John",
      last_name: "Doe",
      phone_number: "0712345678",
      id_number: "trht3kj4b",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id_number/);
  });

  it("rejects an id_number that's too short (< 8 digits)", async () => {
    const res = await send({
      first_name: "John",
      last_name: "Doe",
      phone_number: "0712345678",
      id_number: "1234567",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id_number/);
  });

  it("rejects an id_number that's too long (> 10 digits)", async () => {
    const res = await send({
      first_name: "John",
      last_name: "Doe",
      phone_number: "0712345678",
      id_number: "12345678901",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id_number/);
  });

  it("rejects a city with digits", async () => {
    const res = await send({
      first_name: "John",
      last_name: "Doe",
      phone_number: "0712345678",
      city: "3243254fv3f",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/);
  });
});

describe("Input validation — PUT /clients/:id (Edit modal)", () => {
  // Edit endpoint mirrors Add — proves the validation lives on both
  // entry points so admins can't bypass the rules by saving via Edit.
  const sendEdit = (body) =>
    request(app)
      .put("/api/clients/1")
      .set("Authorization", auth(admin))
      .send(body);

  it("rejects a first_name with digits on update", async () => {
    const res = await sendEdit({ first_name: "Mary123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/first_name/);
  });

  it("rejects an id_number with letters on update", async () => {
    const res = await sendEdit({ id_number: "abc12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id_number/);
  });

  it("rejects a city with special characters on update", async () => {
    const res = await sendEdit({ city: "N@iroBi!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/city/);
  });
});
