// Minimal row builders for tests. Columns match the REAL schema
// (verified in Part 0): tenants need tenant_code/contact_*; users use
// username (global-unique) + is_active; loans need interest_rate (monthly);
// transactions need client_id + payment_date.
import { query } from "../../src/config/database.js";
import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app.js";

// Welfare signups now create a PENDING tenant with no auto-login (platform-admin
// approval gate). For tests that need a working authenticated welfare, sign up,
// approve, then log in — returning a body shaped like the pre-approval signup
// response (token + user.tenant_id + welfare_group_id) so existing tests only
// change the one bootstrap line.
export async function welfareSignup(payload) {
  const signup = await request(app).post("/api/tenants/welfare-signup").send(payload);
  const tenantId = signup.body?.tenant?.id;
  if (tenantId) {
    await query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantId]);
  }
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: payload.contact_email, password: payload.admin_password });
  return {
    ...signup,
    body: {
      ...signup.body,
      token: login.body?.token,
      user: { ...(login.body?.user || {}), tenant_id: tenantId },
    },
  };
}

// Short unique token that fits codes into varchar(20). Per-file random
// salt + monotonic seq → unique within a file and across files.
const salt = Math.random().toString(36).slice(2, 6);
let seq = 0;
const uniq = () => `${salt}${(seq++).toString(36)}`;

export async function createTenant(overrides = {}) {
  const u = uniq();
  const o = {
    business_name: "Test Lender",
    subdomain: `t${u}`,
    status: "active",
    billing_enabled: true,
    billing_fee_percentage: 5.0,
    billing_base_fee: 0,
    ...overrides,
  };
  const res = await query(
    `INSERT INTO tenants
       (tenant_code, business_name, subdomain, contact_name, contact_email,
        status, billing_enabled, billing_fee_percentage, billing_base_fee, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
    [
      `TNT${u}`,
      o.business_name,
      o.subdomain,
      "Owner",
      `owner${u}@test.com`,
      o.status,
      o.billing_enabled,
      o.billing_fee_percentage,
      o.billing_base_fee,
    ],
  );
  const tenant = res.rows[0];
  // Mirror migration 036: every tenant has a default "Main" branch.
  await query(
    `INSERT INTO branches (tenant_id, name, is_default, active)
     VALUES ($1, 'Main', TRUE, TRUE)`,
    [tenant.id],
  );
  return tenant;
}

export async function createUser(tenantId, overrides = {}) {
  const u = uniq();
  const o = { role: "admin", is_platform_admin: false, ...overrides };
  const hash = await bcryptjs.hash("Test@2026!", 10);
  const res = await query(
    `INSERT INTO users
       (tenant_id, username, email, password_hash, role, is_platform_admin,
        first_name, last_name, is_active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'Test','User',true,NOW()) RETURNING *`,
    [
      tenantId,
      o.username || `user${u}`,
      o.email || `user${u}@test.com`,
      hash,
      o.role,
      o.is_platform_admin,
    ],
  );
  return res.rows[0];
}

export async function createClient(tenantId, overrides = {}) {
  const u = uniq();
  const o = { first_name: "Jane", last_name: "Doe", status: "active", ...overrides };
  const res = await query(
    `INSERT INTO clients
       (tenant_id, client_code, first_name, last_name, phone_number, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
    [
      tenantId,
      `CLT${u}`,
      o.first_name,
      o.last_name,
      o.phone_number || `+2547${u.slice(-8)}`,
      o.status,
    ],
  );
  return res.rows[0];
}

// Defaults make the math obvious: 50k principal, 6k interest, 56k due.
// interest_rate is the MONTHLY rate (schema convention) — only used by
// the loan row itself; loan-creation MATH is tested via the real route.
export async function createLoan(tenantId, clientId, overrides = {}) {
  const u = uniq();
  const o = {
    principal_amount: 50000,
    interest_rate: 1.0,
    total_interest: 6000,
    total_amount_due: 56000,
    loan_duration_months: 6,
    status: "active",
    ...overrides,
  };
  const res = await query(
    `INSERT INTO loans
       (tenant_id, client_id, loan_code, principal_amount, interest_rate,
        total_interest, total_amount_due, loan_duration_months, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
    [
      tenantId,
      clientId,
      `LN${u}`,
      o.principal_amount,
      o.interest_rate,
      o.total_interest,
      o.total_amount_due,
      o.loan_duration_months,
      o.status,
    ],
  );
  return res.rows[0];
}

// JWT shaped exactly like the login payload that src/middleware/auth.js
// verifies (no user_type — so verifyToken treats it as staff).
export function tokenFor(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      is_platform_admin: user.is_platform_admin,
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// Sum of completed payments on a loan → current balance helper.
export async function loanBalance(loanId) {
  const r = await query(
    `SELECT l.total_amount_due
            - COALESCE((SELECT SUM(amount_paid) FROM transactions
                        WHERE loan_id = l.id AND payment_status = 'completed'), 0)
            AS balance
       FROM loans l WHERE l.id = $1`,
    [loanId],
  );
  return parseFloat(r.rows[0].balance);
}
