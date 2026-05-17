import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// ============================================================
// GET ALL LOANS (with payment summary)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const { status, client_id, page = 1, limit = 10000 } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
        SELECT 
            l.*,
            c.first_name,
            c.last_name,
            c.phone_number,
            c.client_code,
            COALESCE(SUM(t.amount_paid), 0) as total_paid,
            GREATEST(l.total_amount_due - COALESCE(SUM(t.amount_paid), 0), 0) as balance_due
        FROM loans l
        JOIN clients c ON l.client_id = c.id
        LEFT JOIN transactions t ON l.id = t.loan_id AND t.payment_status = 'completed'
        WHERE 1=1
        `;
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND l.status = $${paramCount}`;
      params.push(status);
    }

    if (client_id) {
      paramCount++;
      queryText += ` AND l.client_id = $${paramCount}`;
      params.push(client_id);
    }

    queryText += ` 
      GROUP BY l.id, c.first_name, c.last_name, c.phone_number, c.client_code
      ORDER BY l.created_at DESC 
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    params.push(limit, offset);

    const result = await query(queryText, params);

    const countResult = await query("SELECT COUNT(*) FROM loans");
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error("Get loans error:", error);
    res.status(500).json({ error: "Failed to fetch loans" });
  }
});

// ============================================================
// GET SINGLE LOAN WITH PAYMENT SCHEDULE
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Get loan with client info
    const loanResult = await query(
      `SELECT 
        l.*,
        c.first_name,
        c.last_name,
        c.phone_number,
        c.email,
        c.client_code
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1`,
      [id],
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    // Get payment schedule
    const scheduleResult = await query(
      `SELECT * FROM payment_schedules 
       WHERE loan_id = $1 
       ORDER BY payment_number ASC`,
      [id],
    );

    res.json({
      success: true,
      data: {
        ...loanResult.rows[0],
        payment_schedule: scheduleResult.rows,
      },
    });
  } catch (error) {
    logger.error("Get loan error:", error);
    res.status(500).json({ error: "Failed to fetch loan" });
  }
});

// ============================================================
// CREATE LOAN (with automatic payment schedule)
// ============================================================
router.post("/", async (req, res) => {
  try {
    const {
      client_id,
      principal_amount,
      annual_interest_rate, // ✅ Now using annual rate
      loan_duration_months,
      start_date,
      purpose,
    } = req.body;

    // Validation
    if (
      !client_id ||
      !principal_amount ||
      !annual_interest_rate ||
      !loan_duration_months ||
      !start_date
    ) {
      return res.status(400).json({
        error:
          "Client, amount, interest rate, duration, and start date are required",
      });
    }

    const clientCheck = await query("SELECT id FROM clients WHERE id = $1", [
      client_id,
    ]);
    if (clientCheck.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    // ✅ Capital pool guard: cannot lend more than what's available
    const poolCheck = await query(`
      SELECT
        initial_capital,
        total_disbursed,
        total_collected,
        (initial_capital - total_disbursed + total_collected) AS available_pool
      FROM capital_pool
      ORDER BY id DESC LIMIT 1
    `);

    if (poolCheck.rows.length === 0) {
      return res.status(500).json({ error: "Capital pool not initialized" });
    }

    const available = parseFloat(poolCheck.rows[0].available_pool);
    const requestedAmount = parseFloat(principal_amount);

    if (requestedAmount > available) {
      return res.status(400).json({
        error: `Insufficient pool balance. Available: KES ${available.toLocaleString()}, Requested: KES ${requestedAmount.toLocaleString()}`,
        available_pool: available,
        requested: requestedAmount,
      });
    }

    // ✅ Calculate using ANNUAL interest rate
    const principal = parseFloat(principal_amount);
    const annualRate = parseFloat(annual_interest_rate);
    const monthlyRate = annualRate / 12; // Auto-calculate monthly rate
    const months = parseInt(loan_duration_months);

    // Interest calculation: Principal × (Annual Rate%) × (Years)
    const years = months / 12;
    const totalInterest = principal * (annualRate / 100) * years;
    const totalAmountDue = principal + totalInterest;
    const monthlyPayment = totalAmountDue / months;

    const startDateObj = new Date(start_date);
    const endDate = new Date(startDateObj);
    endDate.setMonth(endDate.getMonth() + months);

    const year = new Date().getFullYear();
    const countResult = await query("SELECT COUNT(*) FROM loans");
    const loanCount = parseInt(countResult.rows[0].count) + 1;
    const loanCode = `LN-${year}-${String(loanCount).padStart(4, "0")}`;

    // ✅ Store the monthly rate in interest_rate column
    const loanResult = await query(
      `INSERT INTO loans (
        loan_code, client_id, principal_amount, interest_rate,
        loan_duration_months, start_date, end_date,
        total_amount_due, total_interest, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
      RETURNING *`,
      [
        loanCode,
        client_id,
        principal,
        monthlyRate, // Store monthly rate
        months,
        start_date,
        endDate.toISOString().split("T")[0],
        totalAmountDue,
        totalInterest,
        req.user.id,
      ],
    );

    const loan = loanResult.rows[0];

    // Generate payment schedule
    const schedulePromises = [];
    for (let i = 1; i <= months; i++) {
      const dueDate = new Date(startDateObj);
      dueDate.setMonth(dueDate.getMonth() + i);

      schedulePromises.push(
        query(
          `INSERT INTO payment_schedules (
            loan_id, payment_number, due_date, amount_due, status
          ) VALUES ($1, $2, $3, $4, 'pending')`,
          [
            loan.id,
            i,
            dueDate.toISOString().split("T")[0],
            monthlyPayment.toFixed(2),
          ],
        ),
      );
    }

    await Promise.all(schedulePromises);

    // ✅ Update capital pool: principal is now lent out
    await query(
      `UPDATE capital_pool
         SET total_disbursed = total_disbursed + $1, updated_at = NOW()
       WHERE id = (SELECT id FROM capital_pool ORDER BY id DESC LIMIT 1)`,
      [requestedAmount],
    );

    await query(
      `INSERT INTO capital_transactions (transaction_type, amount, loan_id, description)
       VALUES ('loan_disbursed', $1, $2, $3)`,
      [requestedAmount, loan.id, `Loan ${loanCode} disbursed`],
    );

    logger.info(
      `✓ Loan created: ${loanCode}, KES ${principal}, ${annualRate}% per annum`,
    );

    res.status(201).json({
      success: true,
      message: "Loan created successfully",
      data: {
        ...loan,
        annual_interest_rate: annualRate,
        monthly_interest_rate: monthlyRate,
        monthly_payment: monthlyPayment,
      },
    });
  } catch (error) {
    logger.error("Create loan error:", error);
    res.status(500).json({ error: "Failed to create loan" });
  }
});
// ============================================================
// UPDATE LOAN STATUS
// ============================================================
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["active", "completed", "defaulted", "suspended"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const result = await query(
      `UPDATE loans SET status = $1, updated_at = NOW() 
       WHERE id = $2 RETURNING *`,
      [status, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Loan not found" });
    }

    res.json({
      success: true,
      message: "Loan status updated",
      data: result.rows[0],
    });
  } catch (error) {
    logger.error("Update loan error:", error);
    res.status(500).json({ error: "Failed to update loan" });
  }
});

export default router;
