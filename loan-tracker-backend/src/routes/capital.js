import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { notifyCapitalLow } from "../services/notificationService.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// Always operate on the latest pool row
const POOL_QUERY = `SELECT * FROM capital_pool ORDER BY id DESC LIMIT 1`;

function buildStatus(pool, activeLoans) {
  const initial = parseFloat(pool.initial_capital);
  const disbursed = parseFloat(pool.total_disbursed);
  const collected = parseFloat(pool.total_collected);
  const interest = parseFloat(pool.total_interest_earned);

  const outstandingPrincipal = disbursed - collected;
  const availablePool = initial - disbursed + collected;
  const totalPoolValue = initial + interest;
  const utilizationRate =
    initial > 0 ? (outstandingPrincipal / initial) * 100 : 0;

  return {
    initial_capital: initial,
    total_disbursed: disbursed,
    total_collected: collected,
    total_interest_earned: interest,
    outstanding_principal: outstandingPrincipal,
    available_pool: availablePool,
    total_pool_value: totalPoolValue,
    utilization_rate: parseFloat(utilizationRate.toFixed(2)),
    active_loans_count: activeLoans,
    can_lend: availablePool > 0,
  };
}

// ============================================================
// GET CURRENT POOL STATUS
// ============================================================
router.get("/status", authorize("admin", "manager"), async (req, res) => {
  try {
    const poolResult = await query(POOL_QUERY);
    if (poolResult.rows.length === 0) {
      return res.status(404).json({ error: "Capital pool not initialized" });
    }

    const activeResult = await query(
      `SELECT COUNT(*) AS count FROM loans WHERE status = 'active'`,
    );
    const activeLoans = parseInt(activeResult.rows[0].count, 10);

    res.json({
      success: true,
      data: buildStatus(poolResult.rows[0], activeLoans),
    });
  } catch (error) {
    logger.error("Get capital status error:", error);
    res.status(500).json({ error: "Failed to fetch capital status" });
  }
});

// ============================================================
// ADJUST CAPITAL (add or withdraw) — admin only
// ============================================================
router.post("/adjust", authorize("admin"), async (req, res) => {
  try {
    const { type, amount, description } = req.body;

    if (!["add", "withdraw"].includes(type)) {
      return res
        .status(400)
        .json({ error: "type must be 'add' or 'withdraw'" });
    }

    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return res
        .status(400)
        .json({ error: "amount must be a positive number" });
    }

    const poolResult = await query(POOL_QUERY);
    if (poolResult.rows.length === 0) {
      return res.status(404).json({ error: "Capital pool not initialized" });
    }
    const pool = poolResult.rows[0];

    const initial = parseFloat(pool.initial_capital);
    const disbursed = parseFloat(pool.total_disbursed);
    const collected = parseFloat(pool.total_collected);
    const availablePool = initial - disbursed + collected;

    if (type === "withdraw" && value > availablePool) {
      return res.status(400).json({
        error: `Cannot withdraw more than the available pool. Available: KES ${availablePool.toLocaleString()}, Requested: KES ${value.toLocaleString()}`,
        available_pool: availablePool,
        requested: value,
      });
    }

    const delta = type === "add" ? value : -value;

    await query(
      `UPDATE capital_pool
         SET initial_capital = initial_capital + $1, updated_at = NOW()
       WHERE id = $2`,
      [delta, pool.id],
    );

    await query(
      `INSERT INTO capital_transactions (transaction_type, amount, description)
       VALUES ($1, $2, $3)`,
      [
        type === "add" ? "capital_added" : "capital_withdrawn",
        value,
        description || (type === "add" ? "Capital added" : "Capital withdrawn"),
      ],
    );

    await logAudit({
      user: req.user,
      action: "capital_adjusted",
      entityType: "capital_pool",
      entityId: pool.id,
      description: `${type === "add" ? "Added" : "Withdrew"} KES ${value.toLocaleString()}${
        description ? ` — ${description}` : ""
      }`,
      newValues: { type, amount: value, description: description || null },
      req,
    });

    logger.info(
      `✓ Capital ${type} of KES ${value} by ${req.user?.email}`,
    );

    const updated = await query(POOL_QUERY);
    const activeResult = await query(
      `SELECT COUNT(*) AS count FROM loans WHERE status = 'active'`,
    );

    try {
      const u = updated.rows[0];
      if (u) {
        const avail =
          parseFloat(u.initial_capital) -
          parseFloat(u.total_disbursed) +
          parseFloat(u.total_collected);
        await notifyCapitalLow(avail, u.initial_capital);
      }
    } catch (err) {
      logger.error("notifyCapitalLow (adjust) error:", err);
    }

    res.json({
      success: true,
      message: `Capital ${type === "add" ? "added" : "withdrawn"}: KES ${value.toLocaleString()}`,
      data: buildStatus(
        updated.rows[0],
        parseInt(activeResult.rows[0].count, 10),
      ),
    });
  } catch (error) {
    logger.error("Adjust capital error:", error);
    res.status(500).json({ error: "Failed to adjust capital" });
  }
});

// ============================================================
// CAPITAL TRANSACTIONS (audit log — last 50)
// ============================================================
router.get("/transactions", authorize("admin", "manager"), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        ct.id,
        ct.transaction_type,
        ct.amount,
        ct.loan_id,
        ct.transaction_id,
        ct.description,
        ct.created_at,
        l.loan_code
      FROM capital_transactions ct
      LEFT JOIN loans l ON ct.loan_id = l.id
      ORDER BY ct.created_at DESC, ct.id DESC
      LIMIT 50
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get capital transactions error:", error);
    res.status(500).json({ error: "Failed to fetch capital transactions" });
  }
});

export default router;
