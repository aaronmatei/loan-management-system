import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { nextClientCode } from "../utils/clientCode.js";
import logger from "../config/logger.js";
import ExcelJS from "exceljs";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// ============================================================
// CREDIT PROFILE HELPERS
// ============================================================
function calculateCreditScore(metrics) {
  let score = 100;

  // Deduct for defaulted loans
  score -= metrics.defaulted_loans_count * 30;

  // Deduct for current overdue
  if (metrics.current_overdue_count > 0) {
    score -= 15;
    score -= Math.min(metrics.current_overdue_count * 5, 25);
  }

  // Deduct for late payments
  const latePaymentRate =
    metrics.late_payments / Math.max(metrics.total_payments, 1);
  score -= latePaymentRate * 20;

  // Boost for completed loans
  score += Math.min(metrics.completed_loans_count * 3, 15);

  // Boost for high on-time rate
  if (metrics.on_time_rate >= 95) score += 10;
  else if (metrics.on_time_rate >= 80) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getRiskLevel(score, hasDefault, hasOverdue) {
  if (hasDefault)
    return { level: "very_high", label: "🔴 Blacklisted", color: "red" };
  if (hasOverdue)
    return { level: "high", label: "🟠 At Risk", color: "orange" };
  if (score >= 80)
    return { level: "low", label: "🟢 Excellent", color: "green" };
  if (score >= 60)
    return { level: "medium", label: "🟡 Good", color: "yellow" };
  return { level: "high", label: "🟠 Caution", color: "orange" };
}

function checkEligibility(metrics, creditScore) {
  const blockers = [];

  if (metrics.defaulted_loans_count > 0) {
    blockers.push("Has defaulted loans - must resolve first");
  }

  if (metrics.current_overdue_count > 0) {
    blockers.push(
      `Has ${metrics.current_overdue_count} overdue payment(s) - must clear first`,
    );
  }

  if (metrics.active_loans_count >= 3) {
    blockers.push("Maximum 3 active loans allowed");
  }

  // Recommended max based on history
  let maxRecommended = 0;
  if (creditScore >= 80) {
    maxRecommended = Math.max(metrics.total_borrowed * 1.5, 100000);
  } else if (creditScore >= 60) {
    maxRecommended = Math.max(metrics.total_borrowed * 1.0, 50000);
  } else {
    maxRecommended = 30000;
  }

  // Recommended rate based on credit score
  let recommendedRate = 15;
  if (creditScore >= 90) recommendedRate = 10;
  else if (creditScore >= 75) recommendedRate = 12;
  else if (creditScore >= 60) recommendedRate = 15;
  else recommendedRate = 20;

  return {
    can_borrow: blockers.length === 0,
    reason:
      blockers.length === 0
        ? `Score: ${creditScore}/100`
        : "Has issues that need resolution",
    max_recommended_amount: Math.round(maxRecommended),
    recommended_interest_rate: recommendedRate,
    blockers,
  };
}

// ============================================================
// GET ALL CLIENTS
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { search, status, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = "SELECT * FROM clients WHERE 1=1";
    const params = [];
    let paramCount = 0;

    // Filter by search
    if (search) {
      paramCount++;
      queryText += ` AND (
        first_name ILIKE $${paramCount} 
        OR last_name ILIKE $${paramCount} 
        OR phone_number ILIKE $${paramCount}
        OR email ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
    }

    // Filter by status
    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      params.push(status);
    }

    // Tenant scope (no-op for platform admins / pre-migration tokens)
    const ts = tenantClause(req, paramCount);
    if (ts.clause) {
      paramCount++;
      queryText += ts.clause;
    }

    // Add pagination
    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(...ts.params, limit, offset);

    const result = await query(queryText, params);

    // Get total count (same tenant scope)
    const cTs = tenantClause(req, 0);
    const countResult = await query(
      `SELECT COUNT(*) FROM clients WHERE 1=1${cTs.clause}`,
      cTs.params,
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get clients error:", error);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ============================================================
// GET CLIENT CREDIT PROFILE
// ============================================================
router.get("/:id/credit-profile", async (req, res) => {
  try {
    const { id } = req.params;

    const cpTs = tenantClause(req, 1);
    const clientResult = await query(
      `SELECT * FROM clients WHERE id = $1${cpTs.clause}`,
      [id, ...cpTs.params],
    );
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }
    const client = clientResult.rows[0];

    // All loans with paid totals + per-loan on-time/late schedule counts
    const loansResult = await query(
      `
      SELECT
        l.id,
        l.loan_code,
        l.principal_amount,
        l.total_amount_due,
        l.total_interest,
        l.status,
        l.refund_status,
        l.start_date,
        l.end_date,
        l.loan_duration_months,
        COALESCE(tx.total_paid, 0) AS total_paid,
        GREATEST(l.total_amount_due - COALESCE(tx.total_paid, 0), 0) AS balance_due,
        COALESCE(tx.payment_count, 0) AS payment_count,
        COALESCE(sc.on_time, 0) AS on_time_payments,
        COALESCE(sc.late, 0) AS late_payments
      FROM loans l
      LEFT JOIN (
        SELECT loan_id,
               SUM(amount_paid) AS total_paid,
               COUNT(*) AS payment_count
        FROM transactions
        WHERE payment_status = 'completed'
        GROUP BY loan_id
      ) tx ON tx.loan_id = l.id
      LEFT JOIN (
        SELECT loan_id,
               COUNT(*) FILTER (
                 WHERE status = 'paid' AND actual_payment_date IS NOT NULL
                   AND actual_payment_date <= due_date
               ) AS on_time,
               COUNT(*) FILTER (
                 WHERE status = 'paid' AND actual_payment_date IS NOT NULL
                   AND actual_payment_date > due_date
               ) AS late
        FROM payment_schedules
        GROUP BY loan_id
      ) sc ON sc.loan_id = l.id
      WHERE l.client_id = $1
      ORDER BY l.start_date DESC, l.id DESC
      `,
      [id],
    );
    const loans = loansResult.rows;

    // Payment behaviour across every schedule for this client
    const behaviorResult = await query(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE ps.status = 'paid' AND ps.actual_payment_date IS NOT NULL
            AND ps.actual_payment_date <= ps.due_date
        ) AS on_time,
        COUNT(*) FILTER (
          WHERE ps.status = 'paid' AND ps.actual_payment_date IS NOT NULL
            AND ps.actual_payment_date > ps.due_date
        ) AS late,
        COUNT(*) FILTER (WHERE ps.status = 'overdue') AS missed,
        COALESCE(
          SUM(ps.amount_due - COALESCE(ps.amount_paid, 0))
            FILTER (WHERE ps.status = 'overdue'), 0
        ) AS overdue_amount
      FROM payment_schedules ps
      JOIN loans l ON ps.loan_id = l.id
      WHERE l.client_id = $1
      `,
      [id],
    );
    const behavior = behaviorResult.rows[0];

    // Interest portion of everything repaid (proportional split)
    const interestResult = await query(
      `
      SELECT COALESCE(SUM(
        t.amount_paid * (l.total_interest / NULLIF(l.total_amount_due, 0))
      ), 0) AS interest_paid
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      WHERE l.client_id = $1 AND t.payment_status = 'completed'
      `,
      [id],
    );

    // Recent payments (last 10)
    const recentResult = await query(
      `
      SELECT
        t.transaction_code,
        l.loan_code,
        t.amount_paid,
        t.payment_date,
        t.payment_method
      FROM transactions t
      JOIN loans l ON t.loan_id = l.id
      WHERE t.client_id = $1 AND t.payment_status = 'completed'
      ORDER BY t.payment_date DESC, t.id DESC
      LIMIT 10
      `,
      [id],
    );

    // --- Aggregate the summary --------------------------------------------
    const activeLoans = loans.filter((l) => l.status === "active");
    const completedLoans = loans.filter((l) => l.status === "completed");
    const defaultedLoans = loans.filter((l) => l.status === "defaulted");

    const totalBorrowed = loans.reduce(
      (s, l) => s + parseFloat(l.principal_amount || 0),
      0,
    );
    const totalRepaid = loans.reduce(
      (s, l) => s + parseFloat(l.total_paid || 0),
      0,
    );
    const currentOutstanding = activeLoans.reduce(
      (s, l) => s + parseFloat(l.balance_due || 0),
      0,
    );

    const onTime = parseInt(behavior.on_time, 10);
    const late = parseInt(behavior.late, 10);
    const missed = parseInt(behavior.missed, 10);
    const totalPayments = onTime + late;
    const onTimeRate =
      totalPayments > 0
        ? parseFloat(((onTime / totalPayments) * 100).toFixed(1))
        : 100;
    const overdueCount = missed;
    const overdueAmount = parseFloat(behavior.overdue_amount);

    const loanDates = loans
      .map((l) => l.start_date)
      .filter(Boolean)
      .sort();

    const summary = {
      total_loans_count: loans.length,
      active_loans_count: activeLoans.length,
      completed_loans_count: completedLoans.length,
      defaulted_loans_count: defaultedLoans.length,

      total_borrowed: totalBorrowed,
      total_repaid: totalRepaid,
      current_outstanding: currentOutstanding,
      total_interest_paid: parseFloat(interestResult.rows[0].interest_paid),

      total_payments: totalPayments,
      on_time_payments: onTime,
      late_payments: late,
      missed_payments: missed,
      on_time_rate: onTimeRate,

      current_overdue_count: overdueCount,
      current_overdue_amount: overdueAmount,

      first_loan_date: loanDates[0] || null,
      latest_loan_date: loanDates[loanDates.length - 1] || null,
    };

    const creditScore = calculateCreditScore(summary);
    const risk = getRiskLevel(
      creditScore,
      summary.defaulted_loans_count > 0,
      summary.current_overdue_count > 0,
    );
    const eligibility = checkEligibility(summary, creditScore);

    res.json({
      success: true,
      data: {
        client,
        summary,
        credit_score: creditScore,
        risk_level: risk.level,
        risk_label: risk.label,
        risk_color: risk.color,
        eligibility,
        loans,
        recent_payments: recentResult.rows,
      },
    });
  } catch (error) {
    logger.error("Get credit profile error:", error);
    res.status(500).json({ error: "Failed to fetch credit profile" });
  }
});

// ============================================================
// GET SINGLE CLIENT
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const gTs = tenantClause(req, 1);
    const result = await query(
      `SELECT * FROM clients WHERE id = $1${gTs.clause}`,
      [id, ...gTs.params],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Get client error:", error);
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

// ============================================================
// CREATE CLIENT
// ============================================================
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone_number,
      email,
      id_number,
      business_name,
      business_type,
      address,
      city,
      county,
    } = req.body;

    // Validation
    if (!first_name || !last_name || !phone_number) {
      return res.status(400).json({
        error: "First name, last name, and phone number are required",
      });
    }

    // Writes always bind to the acting user's tenant (clients.tenant_id
    // is NOT NULL). Uniqueness is now per-tenant (migration made
    // (tenant_id, phone_number) etc. unique), so different lenders may
    // reuse the same phone/code.
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }

    const phoneCheck = await query(
      "SELECT id FROM clients WHERE phone_number = $1 AND tenant_id = $2",
      [phone_number, tid],
    );
    if (phoneCheck.rows.length > 0) {
      return res.status(409).json({
        error: "A client with this phone number already exists",
      });
    }

    if (email) {
      const emailCheck = await query(
        "SELECT id FROM clients WHERE email = $1 AND tenant_id = $2",
        [email, tid],
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this email already exists",
        });
      }
    }

    if (id_number) {
      const idCheck = await query(
        "SELECT id FROM clients WHERE id_number = $1 AND tenant_id = $2",
        [id_number, tid],
      );
      if (idCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this ID number already exists",
        });
      }
    }

    // Per-tenant client_code via shared helper. Produces
    // CLT-<PREFIX>-<YEAR>-<NNNNN> using MAX(suffix)+1 — safe even if
    // earlier rows were deleted (unlike the old COUNT(*)+1 path).
    const clientCode = await nextClientCode(query, tid);

    // Insert client (tenant-bound)
    const result = await query(
      `INSERT INTO clients (
        tenant_id, client_code, first_name, last_name, phone_number, email,
        id_number, business_name, business_type, address, city, county, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
      RETURNING *`,
      [
        tid,
        clientCode,
        first_name,
        last_name,
        phone_number,
        email || null,
        id_number || null,
        business_name || null,
        business_type || null,
        address || null,
        city || null,
        county || null,
      ],
    );

    await logAudit({
      user: req.user,
      action: "created",
      entityType: "client",
      entityId: result.rows[0].id,
      entityCode: clientCode,
      description: `Created client: ${first_name} ${last_name}`,
      newValues: { first_name, last_name, phone_number, email, county },
      req,
    });

    logger.info(`✓ Client created: ${clientCode} - ${first_name} ${last_name}`);

    res.status(201).json({
      success: true,
      message: "Client created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Create client error:", error);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// ============================================================
// UPDATE CLIENT
// ============================================================
router.put("/:id", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      phone_number,
      email,
      id_number,
      business_name,
      business_type,
      address,
      city,
      county,
      status,
    } = req.body;

    // Check client exists (tenant-scoped; platform admin sees all)
    const eTs = tenantClause(req, 1);
    const existing = await query(
      `SELECT * FROM clients WHERE id = $1${eTs.clause}`,
      [id, ...eTs.params],
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const currentClient = existing.rows[0];
    // Uniqueness/update are scoped to the client's own tenant.
    const ctid = currentClient.tenant_id;

    // Validation
    if (!first_name || !last_name || !phone_number) {
      return res.status(400).json({
        error: "First name, last name, and phone number are required",
      });
    }

    // Check uniqueness for phone_number (excluding current client)
    if (phone_number !== currentClient.phone_number) {
      const phoneCheck = await query(
        "SELECT id FROM clients WHERE phone_number = $1 AND id != $2 AND tenant_id = $3",
        [phone_number, id, ctid],
      );
      if (phoneCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this phone number already exists",
        });
      }
    }

    // Check email uniqueness if provided and changed
    if (email && email !== currentClient.email) {
      const emailCheck = await query(
        "SELECT id FROM clients WHERE email = $1 AND id != $2 AND tenant_id = $3",
        [email, id, ctid],
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this email already exists",
        });
      }
    }

    // Check id_number uniqueness if provided and changed
    if (id_number && id_number !== currentClient.id_number) {
      const idCheck = await query(
        "SELECT id FROM clients WHERE id_number = $1 AND id != $2 AND tenant_id = $3",
        [id_number, id, ctid],
      );
      if (idCheck.rows.length > 0) {
        return res.status(409).json({
          error: "A client with this ID number already exists",
        });
      }
    }

    // Cannot deactivate a client that still has active loans
    if (status && status !== "active" && currentClient.status === "active") {
      const activeLoanCheck = await query(
        `SELECT COUNT(*) as count FROM loans
         WHERE client_id = $1 AND status = 'active'`,
        [id],
      );

      if (parseInt(activeLoanCheck.rows[0].count, 10) > 0) {
        return res.status(400).json({
          error:
            "Cannot deactivate client with active loans. Close all loans first.",
        });
      }
    }

    const result = await query(
      `UPDATE clients SET
        first_name = $1,
        last_name = $2,
        phone_number = $3,
        email = $4,
        id_number = $5,
        business_name = $6,
        business_type = $7,
        address = $8,
        city = $9,
        county = $10,
        status = COALESCE($11, status),
        updated_at = NOW()
      WHERE id = $12 AND tenant_id = $13
      RETURNING *`,
      [
        first_name,
        last_name,
        phone_number,
        email || null,
        id_number || null,
        business_name || null,
        business_type || null,
        address || null,
        city || null,
        county || null,
        status || null,
        id,
        ctid,
      ],
    );

    await logAudit({
      user: req.user,
      action: "updated",
      entityType: "client",
      entityId: id,
      entityCode: currentClient.client_code,
      description: `Updated client: ${first_name} ${last_name}`,
      oldValues: currentClient,
      newValues: result.rows[0],
      req,
    });

    logger.info(`✓ Client updated: ${currentClient.client_code}`);

    res.json({
      success: true,
      message: "Client updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update client error:", error);
    res.status(500).json({ error: "Failed to update client" });
  }
});

// ============================================================
// DELETE CLIENT (Soft delete - mark as inactive)
// ============================================================
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const { id } = req.params;

    const dTs = tenantClause(req, 1);
    const result = await query(
      `UPDATE clients SET status = 'inactive', updated_at = NOW()
       WHERE id = $1${dTs.clause} RETURNING *`,
      [id, ...dTs.params],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    await logAudit({
      user: req.user,
      action: "deleted",
      entityType: "client",
      entityId: id,
      entityCode: result.rows[0].client_code,
      description: `Deactivated client ${result.rows[0].client_code} (${result.rows[0].first_name} ${result.rows[0].last_name})`,
      req,
    });

    logger.info(`✓ Client deactivated: ID ${id}`);

    res.json({
      success: true,
      message: "Client deactivated successfully",
    });
  } catch (error) {
    logger.error("Delete client error:", error);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

// ============================================================
// BULK: update status for many clients
// ============================================================
router.post(
  "/bulk/status",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { client_ids, status } = req.body;

      if (!Array.isArray(client_ids) || client_ids.length === 0) {
        return res.status(400).json({ error: "No clients selected" });
      }
      if (!["active", "inactive", "blacklisted"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Block deactivating/blacklisting clients that still have active
      // loans (same rule as the single-client PUT).
      if (status !== "active") {
        const activeLoans = await query(
          `SELECT DISTINCT client_id
           FROM loans
           WHERE client_id = ANY($1) AND status = 'active'`,
          [client_ids],
        );
        if (activeLoans.rows.length > 0) {
          const clientsWithLoans = activeLoans.rows.map((r) => r.client_id);
          return res.status(400).json({
            error: `${clientsWithLoans.length} of the selected clients have active loans and cannot be ${status}.`,
            clients_with_active_loans: clientsWithLoans,
          });
        }
      }

      // Tenant-scope the bulk update so a tenant can't flip another
      // tenant's clients by guessing ids.
      const bTs = tenantClause(req, 2);
      const result = await query(
        `UPDATE clients
         SET status = $1, updated_at = NOW()
         WHERE id = ANY($2)${bTs.clause}
         RETURNING id, client_code, first_name, last_name`,
        [status, client_ids, ...bTs.params],
      );

      await logAudit({
        user: req.user,
        action: "bulk_status_changed",
        entityType: "client",
        description: `Bulk updated ${result.rows.length} clients to status: ${status}`,
        newValues: { status, client_ids, count: result.rows.length },
        req,
      });

      logger.info(
        `✓ Bulk client status: ${result.rows.length} → ${status} by ${req.user.email}`,
      );

      res.json({
        success: true,
        message: `Updated ${result.rows.length} clients to ${status}`,
        updated_count: result.rows.length,
        updated_clients: result.rows,
      });
    } catch (error) {
      logger.error("Bulk status update error:", error);
      res.status(500).json({ error: "Failed to update clients" });
    }
  },
);

// ============================================================
// BULK: export selected clients to Excel
// ============================================================
router.post("/bulk/export", async (req, res) => {
  try {
    const { client_ids } = req.body;

    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: "No clients selected" });
    }

    // Correlated subqueries (not joins + GROUP BY) so a client's
    // principal isn't multiplied by their transaction count — same
    // approach as the clients export in reports.js.
    const result = await query(
      `SELECT
        c.*,
        (SELECT COUNT(*) FROM loans l WHERE l.client_id = c.id)
          AS total_loans,
        (SELECT COALESCE(SUM(l.principal_amount), 0)
           FROM loans l WHERE l.client_id = c.id) AS total_borrowed,
        (SELECT COALESCE(SUM(t.amount_paid), 0)
           FROM transactions t
           JOIN loans l ON t.loan_id = l.id
           WHERE l.client_id = c.id
             AND t.payment_status = 'completed') AS total_paid
      FROM clients c
      WHERE c.id = ANY($1)${tenantClause(req, 1, "c.tenant_id").clause}
      ORDER BY c.created_at DESC`,
      [client_ids, ...tenantClause(req, 1, "c.tenant_id").params],
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Selected Clients");

    sheet.columns = [
      { header: "Client Code", key: "client_code", width: 15 },
      { header: "First Name", key: "first_name", width: 15 },
      { header: "Last Name", key: "last_name", width: 15 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Email", key: "email", width: 25 },
      { header: "Business", key: "business_name", width: 20 },
      { header: "City", key: "city", width: 15 },
      { header: "County", key: "county", width: 15 },
      { header: "Total Loans", key: "total_loans", width: 12 },
      { header: "Total Borrowed", key: "total_borrowed", width: 15 },
      { header: "Total Paid", key: "total_paid", width: 15 },
      { header: "Status", key: "status", width: 12 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46E5" },
    };

    result.rows.forEach((row) =>
      sheet.addRow({
        ...row,
        total_borrowed: parseFloat(row.total_borrowed).toFixed(2),
        total_paid: parseFloat(row.total_paid).toFixed(2),
      }),
    );

    const filename = `selected_clients_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Bulk export error:", error);
    res.status(500).json({ error: "Failed to export" });
  }
});

export default router;
