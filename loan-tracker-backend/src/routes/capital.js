import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { notifyCapitalLow } from "../services/notificationService.js";
import logger from "../config/logger.js";

const router = express.Router();

router.use(verifyToken);

// Capital is per-tenant. Always scope by the acting user's tenant
// (platform admins operate on their own tenant's pool here).
const poolFor = (tid) => ({
  text: "SELECT * FROM capital_pool WHERE tenant_id = $1",
  values: [tid],
});

function buildStatus(pool, activeLoans) {
  const initial = parseFloat(pool.initial_capital);
  const disbursed = parseFloat(pool.total_disbursed);
  const collected = parseFloat(pool.total_collected);
  const interest = parseFloat(pool.total_interest_earned);

  // total_disbursed records the principal lent (what borrowers owe), and
  // total_interest_earned holds both repayment-interest and any processing
  // fees retained at disbursement. Available cash = initial − principal out
  // + principal back + fees/interest earned (kept in the pool).
  const outstandingPrincipal = disbursed - collected;
  const availablePool = initial - disbursed + collected + interest;
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
    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    const pf = poolFor(tid);
    const poolResult = await query(pf.text, pf.values);
    if (poolResult.rows.length === 0) {
      return res.status(404).json({ error: "Capital pool not initialized" });
    }

    const activeResult = await query(
      `SELECT COUNT(*) AS count FROM loans WHERE status = 'active' AND tenant_id = $1`,
      [tid],
    );
    const activeLoans = parseInt(activeResult.rows[0].count, 10);

    // total_interest_earned on capital_pool is the gross income kept
    // (loan interest + processing fees + penalty income). Split out the
    // two interest-style components — same formulas Reports uses, so
    // figures agree across pages.
    //
    // loan_interest_earned uses per-loan (cash applied to amount_due)
    // × interest ratio, computed from payment_schedules via per-row
    // LEAST(amount_paid, amount_due). The OLD formula computed the
    // cash base from transactions as (amount_paid − penalty −
    // overpayment), which on reducing-balance loans wrongly included
    // principal knockdown (cash that overshot the row to wipe future
    // installments). Knockdown is 100% principal — ratioing it
    // produced phantom interest income.
    const breakdown = await query(
      `SELECT
         COALESCE(SUM(
           COALESCE(per_loan.cash_to_amount_due, 0)
             * (l.total_interest / NULLIF(l.total_amount_due, 0))
         ), 0)::float                                              AS loan_interest_earned,
         (SELECT COALESCE(SUM(COALESCE(t.penalty_portion, 0)), 0)::float
            FROM transactions t
           WHERE t.tenant_id = $1
             AND t.payment_status = 'completed')                   AS fines_collected
       FROM loans l
       LEFT JOIN (
         SELECT loan_id, SUM(LEAST(amount_paid, amount_due)) AS cash_to_amount_due
         FROM payment_schedules
         GROUP BY loan_id
       ) per_loan ON per_loan.loan_id = l.id
       WHERE l.tenant_id = $1
         AND l.status IN ('active', 'completed', 'defaulted')`,
      [tid],
    );

    const status = buildStatus(poolResult.rows[0], activeLoans);
    const interestCollectedGross = parseFloat(
      breakdown.rows[0].loan_interest_earned,
    );
    const finesCollectedGross = parseFloat(
      breakdown.rows[0].fines_collected,
    );

    // Lifetime processing fees retained at disbursement. Booked into
    // capital_pool.total_interest_earned at loan-disbursal time (see
    // routes/loans.js), so SUM(processing_fee) over disbursed loans
    // is the authoritative figure. Only loans that actually went out
    // the door (active / completed / defaulted) count — pending /
    // rejected applications never produced a fee.
    const feesRow = await query(
      `SELECT COALESCE(SUM(processing_fee), 0)::float AS processing_fees
         FROM loans
        WHERE tenant_id = $1
          AND status IN ('active', 'completed', 'defaulted')`,
      [tid],
    );
    const processingFeesTotal =
      parseFloat(feesRow.rows[0].processing_fees) || 0;

    // Lifetime profitability + waiver decomposition.
    //
    // Each waiver splits across three buckets — penalty (already
    // tracked as allocation.penalty_total) plus the
    // principal/interest blend (allocation.amount_total). New
    // waivers store the prorated interest_total / principal_total
    // numbers explicitly (see waiverService.applyWaiver step 3b);
    // older rows fall back to a proportional split using each
    // loan's total_interest ÷ total_amount_due ratio so historical
    // data still nets correctly. Netting these out of the gross
    // breakdown gives "Interest from Loans (net)" / "Total Fines
    // (net)" — what we actually kept after forgiving.
    const profitRow = await query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM expenses WHERE tenant_id = $1), 0)::float
                                                                AS total_expenses,
         COALESCE((SELECT total_waived FROM capital_pool WHERE tenant_id = $1), 0)::float
                                                                AS total_waived,
         COALESCE(SUM(COALESCE((w.allocation->>'penalty_total')::float, 0)), 0)::float
                                                                AS fines_waived,
         COALESCE(SUM(
           COALESCE(
             (w.allocation->>'interest_total')::float,
             COALESCE((w.allocation->>'amount_total')::float, 0)
               * (l.total_interest / NULLIF(l.total_amount_due, 0))
           )
         ), 0)::float                                           AS interest_waived,
         COALESCE(SUM(
           COALESCE(
             (w.allocation->>'principal_total')::float,
             COALESCE((w.allocation->>'amount_total')::float, 0)
               * (l.principal_amount / NULLIF(l.total_amount_due, 0))
           )
         ), 0)::float                                           AS principal_waived
       FROM loan_waivers w
       JOIN loans l ON l.id = w.loan_id
      WHERE l.tenant_id = $1 AND w.status = 'approved'`,
      [tid],
    );
    const totalExpenses = parseFloat(profitRow.rows[0].total_expenses) || 0;
    const totalWaived = parseFloat(profitRow.rows[0].total_waived) || 0;
    const finesWaived = parseFloat(profitRow.rows[0].fines_waived) || 0;
    const interestWaived = parseFloat(profitRow.rows[0].interest_waived) || 0;
    const principalWaived = parseFloat(profitRow.rows[0].principal_waived) || 0;
    const finesNet = Math.max(0, finesCollectedGross - finesWaived);
    const interestNet = Math.max(0, interestCollectedGross - interestWaived);

    // Dashboard tiles read GROSS cash figures now — same cash-flow
    // lens that drives net_profit_lifetime (which subtracts
    // principal_written_off, not the admin-declared waiver total).
    // Subtracting waivers here too double-counted the loss: a
    // 3,000 interest waiver dropped cash interest by ~1,636 (less
    // cash came in), and then we ALSO subtracted the 3,000 waiver
    // from the tile, leaving the headline 1,636 below the actual
    // cash earned. interestNet / finesNet are kept on the response
    // for any surface that explicitly wants the "after admin
    // waiver" lens, but the primary fields point at gross.
    status.loan_interest_earned = interestCollectedGross;
    status.loan_interest_earned_gross = interestCollectedGross;
    status.loan_interest_earned_net_admin = interestNet;
    status.interest_waived = interestWaived;
    status.fines_collected = finesCollectedGross;
    status.fines_collected_gross = finesCollectedGross;
    status.fines_collected_net_admin = finesNet;
    status.fines_waived = finesWaived;
    status.principal_waived = principalWaived;
    status.processing_fees = processingFeesTotal;
    status.total_expenses = totalExpenses;
    status.total_waived = totalWaived;

    // Contract-ratio principal write-off — drives BOTH the
    // "Loaned Out" tile (subtract from outstanding_principal) AND
    // net_profit_lifetime (the only real cash loss not already
    // implicit in lower cash receipts). Treasury lens: a waiver
    // against amount_due forgives principal in lockstep with
    // interest no matter how the admin labelled it, because the
    // borrower will not be paying that principal back either way.
    const principalWriteOff = await query(
      `SELECT COALESCE(SUM(
         COALESCE((w.allocation->>'amount_total')::float, 0)
           * (l.principal_amount / NULLIF(l.total_amount_due, 0))
       ), 0)::float AS principal_written_off
       FROM loan_waivers w
       JOIN loans l ON l.id = w.loan_id
      WHERE l.tenant_id = $1 AND w.status = 'approved'`,
      [tid],
    );
    // round2 + sub-cent threshold kills the IEEE-754 residuals
    // that show up when several amount_total × principal/total
    // ratios sum (e.g. 5000/11000 = 0.4545… across 3 waivers
    // leaves outstanding_principal at 0.004 instead of 0).
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const zeroish = (n) => (Math.abs(n) < 0.01 ? 0 : n);
    const principalWrittenOff = round2(
      principalWriteOff.rows[0].principal_written_off,
    );
    status.principal_written_off = principalWrittenOff;

    // net_profit_lifetime uses the cash-flow lens, not the
    // forgone-income lens, so it matches the pool's actual cash
    // position (available_pool − initial_capital). Two facts make
    // the cash-flow formula the right one:
    //
    //   1) interest_earned already counts cash only — when a
    //      borrower pays less because of a waiver, the interest
    //      cash that didn't come in is already missing from
    //      interest_earned. Subtracting the waiver's income share
    //      *again* would double-count the loss.
    //   2) The only real economic loss that isn't already
    //      captured by lower cash income is the principal that
    //      won't come back — the principal share of the waiver
    //      (by contract ratio).
    //
    // Worked example: 5k principal / 6k interest, 2k interest
    // waiver, borrower paid 9k cash + 522.50 penalty + 250 fee:
    //   interest_earned     = 4,909 (cash interest) + 522.50 + 250 = 5,681.59
    //   principalWrittenOff = 2,000 × 5/11 = 909.09
    //   net_profit          = 5,681.59 − 909.09 = 4,772.50
    //   = exactly the pool's cash growth (available_pool − 100k).
    // The old formula subtracted total_waived = 2,665 and got
    // 3,016.59 — under-stating profit by 1,755.91, the income
    // portion of waivers that the lender never actually had on the
    // books to lose (it was already missing from interest_earned).
    status.net_profit_lifetime =
      status.total_interest_earned - totalExpenses - principalWrittenOff;
    status.net_profit_lifetime = zeroish(round2(status.net_profit_lifetime));

    status.outstanding_principal = Math.max(
      0,
      zeroish(round2(status.outstanding_principal - principalWrittenOff)),
    );
    status.utilization_rate =
      parseFloat(status.initial_capital) > 0
        ? parseFloat(
            (
              (status.outstanding_principal / status.initial_capital) *
              100
            ).toFixed(2),
          )
        : 0;

    res.json({ success: true, data: status });
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

    const tid = req.user?.tenant_id;
    if (!tid) {
      return res
        .status(400)
        .json({ error: "No tenant context — re-login required" });
    }
    const pf = poolFor(tid);
    const poolResult = await query(pf.text, pf.values);
    if (poolResult.rows.length === 0) {
      return res.status(404).json({ error: "Capital pool not initialized" });
    }
    const pool = poolResult.rows[0];

    const initial = parseFloat(pool.initial_capital);
    const disbursed = parseFloat(pool.total_disbursed);
    const collected = parseFloat(pool.total_collected);
    const interest = parseFloat(pool.total_interest_earned);
    const availablePool = initial - disbursed + collected + interest;

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
      `INSERT INTO capital_transactions (tenant_id, transaction_type, amount, description)
       VALUES ($1, $2, $3, $4)`,
      [
        tid,
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

    const updated = await query(pf.text, pf.values);
    const activeResult = await query(
      `SELECT COUNT(*) AS count FROM loans WHERE status = 'active' AND tenant_id = $1`,
      [tid],
    );

    try {
      const u = updated.rows[0];
      if (u) {
        const avail =
          parseFloat(u.initial_capital) -
          parseFloat(u.total_disbursed) +
          parseFloat(u.total_collected);
        await notifyCapitalLow(tid, avail, u.initial_capital);
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
      WHERE ct.tenant_id = $1
      ORDER BY ct.created_at DESC, ct.id DESC
      LIMIT 50
    `,
      [req.user?.tenant_id],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error("Get capital transactions error:", error);
    res.status(500).json({ error: "Failed to fetch capital transactions" });
  }
});

export default router;
