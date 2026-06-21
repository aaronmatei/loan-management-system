// Welfare dividends / share-out. Mounted at /api/welfares/:welfareId.
// Distributes the pool's retained surplus (pool balance above members' savings
// principal) to active members, pro-rata by savings or split equally. Each
// share is paid out as a 'dividend' member_pool_transactions row (cash leaves
// the pool). See migration 063.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { notifyDividend } from "../services/welfareSmsService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);
import { round2 } from "../utils/round2.js";
const SAVINGS_TYPES = "('contribution','withdrawal','adjustment')";

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (dividends) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function poolBalance(welfareId) {
  const r = await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`, [welfareId]);
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// Active members with their savings principal (excludes dividends).
async function activeMembersWithSavings(welfareId) {
  const r = await query(
    `SELECT m.id, m.first_name, m.last_name, m.member_no, m.phone_number,
            COALESCE((SELECT SUM(direction * amount) FROM member_pool_transactions p
                       WHERE p.member_id = m.id AND p.type IN ${SAVINGS_TYPES}), 0) AS savings
       FROM members m
      WHERE m.welfare_id = $1 AND m.status = 'active'
      ORDER BY m.id`,
    [welfareId],
  );
  return r.rows.map((m) => ({ ...m, savings: parseFloat(m.savings) }));
}

// Surplus = pool cash above the members' total savings principal. This is the
// retained income (penalties + loan interest) that can be shared out.
async function distributable(welfareId) {
  const pool = await poolBalance(welfareId);
  const members = await activeMembersWithSavings(welfareId);
  const totalSavings = round2(members.reduce((s, m) => s + m.savings, 0));
  return { pool: round2(pool), totalSavings, surplus: round2(pool - totalSavings), members };
}

// Compute each member's share of `amount` by basis; fix rounding on the largest.
function computeShares(members, amount, basis) {
  const eligible = basis === "equal" ? members : members.filter((m) => m.savings > 0);
  if (!eligible.length) return [];
  let shares;
  if (basis === "equal") {
    const each = round2(amount / eligible.length);
    shares = eligible.map((m) => ({ ...m, share: each }));
  } else {
    const totalSavings = eligible.reduce((s, m) => s + m.savings, 0);
    shares = eligible.map((m) => ({ ...m, share: round2((amount * m.savings) / totalSavings) }));
  }
  // Push the rounding residual onto the largest share so the sum equals amount.
  const diff = round2(amount - shares.reduce((s, m) => s + m.share, 0));
  if (diff !== 0 && shares.length) {
    const idx = shares.reduce((best, m, i, arr) => (m.share > arr[best].share ? i : best), 0);
    shares[idx] = { ...shares[idx], share: round2(shares[idx].share + diff) };
  }
  return shares.filter((m) => m.share > 0);
}

// GET /dividends — past share-outs.
router.get("/dividends", async (req, res) => {
  try {
    const r = await query(
      `SELECT d.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS created_by_name
         FROM dividend_distributions d
         LEFT JOIN users u ON u.id = d.created_by
        WHERE d.welfare_id = $1 ORDER BY d.id DESC`,
      [req.welfare.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("dividends list error:", e);
    res.status(500).json({ error: "Failed to load dividends" });
  }
});

// GET /dividends/distributable — surplus + a preview of shares.
router.get("/dividends/distributable", async (req, res) => {
  try {
    const d = await distributable(req.welfare.id);
    const basis = req.query.basis === "equal" ? "equal" : "savings";
    const amount = req.query.amount != null && req.query.amount !== "" ? Math.min(parseFloat(req.query.amount), d.surplus) : d.surplus;
    const preview = amount > 0 ? computeShares(d.members, round2(amount), basis) : [];
    res.json({
      success: true,
      data: {
        pool: d.pool, total_savings: d.totalSavings, surplus: d.surplus,
        active_members: d.members.length, basis, amount: round2(Math.max(amount, 0)),
        preview: preview.map((m) => ({ member_id: m.id, name: `${m.first_name} ${m.last_name}`, member_no: m.member_no, savings: m.savings, share: m.share })),
      },
    });
  } catch (e) {
    logger.error("distributable error:", e);
    res.status(500).json({ error: "Failed to compute distributable surplus" });
  }
});

// GET /dividends/:id — a share-out with its per-member breakdown.
router.get("/dividends/:id", async (req, res) => {
  try {
    const head = (await query(`SELECT * FROM dividend_distributions WHERE id = $1 AND welfare_id = $2`, [req.params.id, req.welfare.id])).rows[0];
    if (!head) return res.status(404).json({ error: "Distribution not found" });
    const rows = (
      await query(
        `SELECT p.amount, p.created_at, m.first_name, m.last_name, m.member_no
           FROM member_pool_transactions p
           LEFT JOIN members m ON m.id = p.member_id
          WHERE p.dividend_distribution_id = $1 ORDER BY p.amount DESC`,
        [head.id],
      )
    ).rows;
    res.json({ success: true, data: { ...head, shares: rows } });
  } catch (e) {
    logger.error("dividend detail error:", e);
    res.status(500).json({ error: "Failed to load distribution" });
  }
});

// POST /dividends { amount?, basis?, notes? } — execute a share-out.
router.post("/dividends", authorize("admin", "manager"), async (req, res) => {
  try {
    const basis = req.body?.basis === "equal" ? "equal" : "savings";
    const d = await distributable(req.welfare.id);
    if (d.surplus <= 0) {
      return res.status(400).json({ error: "No distributable surplus. Settle outstanding loans so the pool exceeds members' savings." });
    }
    const amount = req.body?.amount != null && req.body.amount !== "" ? round2(parseFloat(req.body.amount)) : d.surplus;
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be positive" });
    if (amount > d.surplus) return res.status(400).json({ error: `Only KES ${d.surplus.toLocaleString()} is distributable` });

    const shares = computeShares(d.members, amount, basis);
    if (!shares.length) return res.status(400).json({ error: "No eligible members to receive a share" });

    const head = (
      await query(
        `INSERT INTO dividend_distributions (tenant_id, welfare_id, total_amount, basis, member_count, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.welfare.tenant_id, req.welfare.id, amount, basis, shares.length, req.body?.notes || null, req.user.id],
      )
    ).rows[0];

    // Post each share as a dividend outflow, threading the running pool balance.
    let bal = d.pool;
    for (const m of shares) {
      bal = round2(bal - m.share);
      await query(
        `INSERT INTO member_pool_transactions
           (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, description, dividend_distribution_id, created_by)
         VALUES ($1,$2,$3,'dividend',$4,-1,$5,$6,$7,$8)`,
        [req.welfare.tenant_id, req.welfare.id, m.id, m.share, bal, `Dividend (share-out #${head.id})`, head.id, req.user.id],
      );
      notifyDividend({ welfare: req.welfare, member: m, amount: m.share, sentBy: req.user.id });
    }

    await logAudit({
      user: req.user, action: "dividend_distributed", entityType: "dividend_distribution",
      entityId: head.id, description: `Share-out #${head.id}: KES ${amount} to ${shares.length} members (${basis})`, req,
    });
    res.status(201).json({ success: true, data: { ...head, shares: shares.map((m) => ({ member_id: m.id, name: `${m.first_name} ${m.last_name}`, share: m.share })) }, pool_balance: bal });
  } catch (e) {
    logger.error("dividend distribute error:", e);
    res.status(500).json({ error: "Failed to distribute dividends" });
  }
});

export default router;
