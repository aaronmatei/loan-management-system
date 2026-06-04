// Portal self-registration with OTP temporarily disabled: a customer can
// register and set a password with no OTP, and ends up phone_verified.
// TODO(OTP): update these once OTP is re-enabled.
import { describe, it, expect } from "vitest";
import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app.js";
import { query } from "../src/config/database.js";

describe("Portal self-registration (OTP disabled)", () => {
  it("registers + sets password with no OTP and marks phone_verified", async () => {
    const phone = "0734001122";

    const reg = await request(app)
      .post("/api/portal/auth/register")
      .send({
        phone_number: phone,
        // 8-digit literal — route validation now enforces ^\d{8,10}$.
        // Unique within this suite (other tests use other digit
        // strings) so cross-test platform_customer matching can't
        // pick this row up.
        id_number: "73400112",
        first_name: "Self",
        last_name: "Signup",
        email: "self.signup@example.com",
      });
    expect(reg.status).toBe(200);
    expect(reg.body.requires_otp).toBe(false);
    expect(reg.body.customer_id).toBeTruthy();

    // Email captured at registration is persisted on the platform account.
    const emailRow = await query(
      "SELECT email FROM platform_customers WHERE id = $1",
      [reg.body.customer_id],
    );
    expect(emailRow.rows[0].email).toBe("self.signup@example.com");

    // No `otp` in the body — should still succeed.
    const fin = await request(app)
      .post("/api/portal/auth/verify-otp")
      .send({ customer_id: reg.body.customer_id, password: "PortalPass1234!" });
    expect(fin.status).toBe(200);
    expect(typeof fin.body.token).toBe("string");

    const pc = await query(
      "SELECT phone_verified, password_hash FROM platform_customers WHERE id = $1",
      [reg.body.customer_id],
    );
    expect(pc.rows[0].phone_verified).toBe(true);
    expect(
      await bcryptjs.compare("PortalPass1234!", pc.rows[0].password_hash),
    ).toBe(true);
  });

  it("can then log in with the new credentials", async () => {
    const res = await request(app)
      .post("/api/portal/auth/login")
      .send({ phone_number: "0734001122", password: "PortalPass1234!" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });
});
