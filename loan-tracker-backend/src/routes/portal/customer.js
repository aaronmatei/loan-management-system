import express from "express";
import bcryptjs from "bcryptjs";
import { query } from "../../config/database.js";
import { verifyCustomer } from "../../middleware/customerAuth.js";
import { validatePassword } from "../../utils/validators.js";
import logger from "../../config/logger.js";

const router = express.Router();
router.use(verifyCustomer);

// Customer's linked tenants + platform-wide rollup
router.get("/tenants", async (req, res) => {
  try {
    const r = await query(
      `SELECT
         ctl.tenant_id, ctl.client_id, ctl.linked_at,
         t.business_name, t.subdomain, t.brand_color,
         c.client_code,
         (SELECT COUNT(*) FROM loans
            WHERE client_id = ctl.client_id AND status = 'active') AS active_loans,
         (SELECT COUNT(*) FROM loans
            WHERE client_id = ctl.client_id AND status = 'completed') AS completed_loans,
         (SELECT COALESCE(SUM(
              l.total_amount_due
              - COALESCE((SELECT SUM(tx.amount_paid) FROM transactions tx
                           WHERE tx.loan_id = l.id
                             AND tx.payment_status = 'completed'), 0)), 0)
            FROM loans l
            WHERE l.client_id = ctl.client_id AND l.status = 'active'
         ) AS total_balance
       FROM customer_tenant_links ctl
       JOIN tenants t ON ctl.tenant_id = t.id
       JOIN clients c ON ctl.client_id = c.id
       WHERE ctl.platform_customer_id = $1
         AND ctl.status = 'active' AND t.status = 'active'
       ORDER BY active_loans DESC`,
      [req.platformCustomerId],
    );
    const totalActive = r.rows.reduce(
      (s, t) => s + parseInt(t.active_loans, 10),
      0,
    );
    const totalBalance = r.rows.reduce(
      (s, t) => s + parseFloat(t.total_balance),
      0,
    );
    res.json({
      success: true,
      data: {
        tenants: r.rows,
        platform_stats: {
          total_tenants: r.rows.length,
          total_active_loans: totalActive,
          total_balance: totalBalance,
        },
      },
    });
  } catch (error) {
    logger.error("Get tenants error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Dashboard for the currently selected tenant
router.get("/dashboard", async (req, res) => {
  try {
    if (!req.currentTenantId) {
      return res.status(400).json({ error: "No tenant selected" });
    }
    const cid = req.currentClientId;
    const tid = req.currentTenantId;

    const loans = await query(
      `SELECT l.*, COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.client_id = $1 AND l.tenant_id = $2 AND l.status = 'active'
       GROUP BY l.id ORDER BY l.created_at DESC`,
      [cid, tid],
    );
    const nextPayment = await query(
      `SELECT ps.*, l.loan_code
       FROM payment_schedules ps
       JOIN loans l ON ps.loan_id = l.id
       WHERE l.client_id = $1 AND l.tenant_id = $2
         AND ps.status IN ('pending','overdue')
       ORDER BY ps.due_date ASC LIMIT 1`,
      [cid, tid],
    );
    const stats = await query(
      `SELECT
         COUNT(*) AS total_loans,
         COUNT(*) FILTER (WHERE status='active') AS active_loans,
         COUNT(*) FILTER (WHERE status='completed') AS completed_loans,
         COALESCE(SUM(total_amount_due) FILTER (WHERE status='active'),0) AS active_total_due
       FROM loans WHERE client_id = $1 AND tenant_id = $2`,
      [cid, tid],
    );
    const client = await query("SELECT * FROM clients WHERE id = $1", [cid]);
    const tenant = await query(
      "SELECT business_name, subdomain, brand_color FROM tenants WHERE id = $1",
      [tid],
    );
    const applications = await query(
      `SELECT id, loan_code, principal_amount, status, application_date
       FROM loans
       WHERE client_id = $1 AND tenant_id = $2
         AND status IN ('pending','under_review','approved','rejected')
       ORDER BY application_date DESC LIMIT 5`,
      [cid, tid],
    );

    await query(
      `INSERT INTO customer_activities (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'viewed_dashboard')`,
      [req.platformCustomerId, tid, cid],
    );

    res.json({
      success: true,
      data: {
        customer: req.customer,
        tenant: tenant.rows[0],
        client: client.rows[0],
        active_loans: loans.rows,
        next_payment: nextPayment.rows[0] || null,
        stats: stats.rows[0],
        pending_applications: applications.rows,
      },
    });
  } catch (error) {
    logger.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/loans", async (req, res) => {
  try {
    const params = [req.currentClientId, req.currentTenantId];
    let statusClause = "";
    if (req.query.status) {
      params.push(req.query.status);
      statusClause = ` AND l.status = $${params.length}`;
    }
    const r = await query(
      `SELECT l.*, COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.client_id = $1 AND l.tenant_id = $2${statusClause}
       GROUP BY l.id ORDER BY l.created_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (error) {
    logger.error("Customer loans error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/loans/:id", async (req, res) => {
  try {
    const loan = await query(
      `SELECT l.*,
              c.first_name AS client_first_name,
              c.last_name  AS client_last_name,
              c.phone_number AS client_phone,
              COALESCE(SUM(t.amount_paid),0) AS total_paid
       FROM loans l
       JOIN clients c ON l.client_id = c.id
       LEFT JOIN transactions t
         ON l.id = t.loan_id AND t.payment_status = 'completed'
       WHERE l.id = $1 AND l.client_id = $2 AND l.tenant_id = $3
       GROUP BY l.id, c.id`,
      [req.params.id, req.currentClientId, req.currentTenantId],
    );
    if (loan.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }
    const schedule = await query(
      "SELECT * FROM payment_schedules WHERE loan_id = $1 ORDER BY payment_number",
      [req.params.id],
    );
    const txns = await query(
      `SELECT * FROM transactions
       WHERE loan_id = $1 AND payment_status = 'completed'
       ORDER BY payment_date DESC`,
      [req.params.id],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type, details)
       VALUES ($1,$2,$3,'viewed_loan',$4)`,
      [
        req.platformCustomerId,
        req.currentTenantId,
        req.currentClientId,
        JSON.stringify({ loan_id: req.params.id }),
      ],
    );
    res.json({
      success: true,
      data: {
        loan: loan.rows[0],
        schedule: schedule.rows,
        transactions: txns.rows,
      },
    });
  } catch (error) {
    logger.error("Customer loan detail error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Profile: global (platform_customers, safe fields — never
// password_hash/otp) + the client record at the currently-selected
// tenant. Shape: { customer, client }.
router.get("/profile", async (req, res) => {
  try {
    const c = req.customer;
    const customer = {
      id: c.id,
      phone_number: c.phone_number,
      email: c.email,
      id_number: c.id_number,
      first_name: c.first_name,
      last_name: c.last_name,
      date_of_birth: c.date_of_birth,
      gender: c.gender,
      profile_photo_url: c.profile_photo_url,
      phone_verified: c.phone_verified,
      email_verified: c.email_verified,
      created_at: c.created_at,
    };
    let client = null;
    if (req.currentClientId) {
      const cr = await query(
        `SELECT cl.*, t.business_name AS tenant_name
         FROM clients cl
         JOIN tenants t ON cl.tenant_id = t.id
         WHERE cl.id = $1 AND cl.tenant_id = $2`,
        [req.currentClientId, req.currentTenantId],
      );
      client = cr.rows[0] || null;
    }
    res.json({ success: true, data: { customer, client } });
  } catch (error) {
    logger.error("Get profile error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const {
      email,
      date_of_birth,
      gender,
      address,
      city,
      county,
      business_type,
      business_name,
    } = req.body;

    // Global (platform_customers)
    await query(
      `UPDATE platform_customers SET
         email = COALESCE($1,email),
         date_of_birth = COALESCE($2,date_of_birth),
         gender = COALESCE($3,gender),
         updated_at = NOW()
       WHERE id = $4`,
      [
        email || null,
        date_of_birth || null,
        gender || null,
        req.platformCustomerId,
      ],
    );

    // Tenant-specific (clients) — scoped to the current tenant.
    if (req.currentClientId) {
      await query(
        `UPDATE clients SET
           email = COALESCE($1,email),
           address = COALESCE($2,address),
           city = COALESCE($3,city),
           county = COALESCE($4,county),
           business_type = COALESCE($5,business_type),
           business_name = COALESCE($6,business_name),
           updated_at = NOW()
         WHERE id = $7 AND tenant_id = $8`,
        [
          email || null,
          address || null,
          city || null,
          county || null,
          business_type || null,
          business_name || null,
          req.currentClientId,
          req.currentTenantId,
        ],
      );
    }

    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'profile_updated')`,
      [req.platformCustomerId, req.currentTenantId, req.currentClientId],
    );

    res.json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    logger.error("Profile update error:", error);
    res.status(500).json({ error: "Failed" });
  }
});

// Change password (logged-in customer). Enforces the SAME
// validatePassword policy as portal reset-password / staff users
// (>=12 chars, uppercase, digit, special) — deliberately stricter
// than the spec's 6-char rule, which the backend would reject anyway.
router.post("/change-password", async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Both passwords required" });
    }
    if (!validatePassword(new_password)) {
      return res.status(400).json({
        error:
          "Password must be at least 12 characters with an uppercase letter, a number, and a special character",
      });
    }

    const r = await query(
      "SELECT password_hash FROM platform_customers WHERE id = $1",
      [req.platformCustomerId],
    );
    const ok = await bcryptjs.compare(
      current_password,
      r.rows[0]?.password_hash || "",
    );
    if (!ok) {
      return res
        .status(401)
        .json({ error: "Current password is incorrect" });
    }

    const hash = await bcryptjs.hash(new_password, 10);
    await query(
      "UPDATE platform_customers SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [hash, req.platformCustomerId],
    );
    await query(
      `INSERT INTO customer_activities
         (platform_customer_id, tenant_id, client_id, activity_type)
       VALUES ($1,$2,$3,'password_changed')`,
      [req.platformCustomerId, req.currentTenantId, req.currentClientId],
    );

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    logger.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

export default router;
