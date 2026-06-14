// Member contributions pool (Part 1). A members' fund that's separate from the
// lending capital_pool: members are their own roster who contribute to / draw
// from a shared pool. Mounted at /api/members.
//
// member_pool_transactions is the pool's running ledger (balance_after = pool
// balance). A member's own savings balance is the net of their
// contribution/withdrawal/dividend/adjustment rows. Lending from the pool
// (loan_disbursed / loan_repayment) arrives in Part 2.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Ledger row types that count toward a member's own savings equity (loans don't).
const SAVINGS_TYPES = "('contribution','withdrawal','dividend','adjustment')";

async function loadMember(req, id) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(`SELECT * FROM members WHERE id = $1${tc.clause}`, [
    id,
    ...tc.params,
  ]);
  return r.rows[0] || null;
}

async function poolBalance(tenantId) {
  const r = await query(
    `SELECT balance_after FROM member_pool_transactions
      WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
    [tenantId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

async function memberSavings(memberId) {
  const r = await query(
    `SELECT COALESCE(SUM(direction * amount), 0) AS bal
       FROM member_pool_transactions
      WHERE member_id = $1 AND type IN ${SAVINGS_TYPES}`,
    [memberId],
  );
  return parseFloat(r.rows[0].bal);
}

// Append a pool ledger row, maintaining the running pool balance.
async function postPool({ tenantId, memberId, type, amount, direction, txnDate, description, userId }) {
  const prev = await poolBalance(tenantId);
  const balanceAfter = round2(prev + direction * amount);
  const r = await query(
    `INSERT INTO member_pool_transactions
       (tenant_id, member_id, type, amount, direction, balance_after, txn_date, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE),$8,$9)
     RETURNING *`,
    [tenantId, memberId || null, type, amount, direction, balanceAfter, txnDate || null, description || null, userId],
  );
  return r.rows[0];
}

// GET /api/members/pool — pool summary.
router.get("/pool", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "tenant_id");
    const tid = req.user.tenant_id;
    const balance = tid != null ? await poolBalance(tid) : 0;
    const totals = await query(
      `SELECT
          COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS total_contributions,
          COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS total_withdrawals
         FROM member_pool_transactions WHERE 1=1${tc.clause}`,
      [...tc.params],
    );
    const mc = await query(
      `SELECT COUNT(*)::int AS n FROM members WHERE status='active'${tc.clause}`,
      [...tc.params],
    );
    res.json({
      success: true,
      data: {
        balance,
        total_contributions: Number(totals.rows[0].total_contributions),
        total_withdrawals: Number(totals.rows[0].total_withdrawals),
        member_count: mc.rows[0].n,
      },
    });
  } catch (e) {
    logger.error("member pool error:", e);
    res.status(500).json({ error: "Failed to load member pool" });
  }
});

// GET /api/members — roster with each member's savings balance.
router.get("/", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "m.tenant_id");
    const search = (req.query.search || "").trim();
    const params = [...tc.params];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      searchClause = ` AND (m.first_name ILIKE $${params.length} OR m.last_name ILIKE $${params.length} OR m.member_no ILIKE $${params.length} OR m.phone_number ILIKE $${params.length})`;
    }
    const r = await query(
      `SELECT m.*,
          COALESCE((SELECT SUM(direction * amount) FROM member_pool_transactions p
                     WHERE p.member_id = m.id AND p.type IN ${SAVINGS_TYPES}), 0) AS savings_balance
        FROM members m
        WHERE 1=1${tc.clause}${searchClause}
        ORDER BY m.created_at DESC`,
      params,
    );
    res.json({
      success: true,
      data: r.rows.map((m) => ({ ...m, savings_balance: Number(m.savings_balance) })),
    });
  } catch (e) {
    logger.error("members list error:", e);
    res.status(500).json({ error: "Failed to load members" });
  }
});

// POST /api/members — enrol a member.
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const tid = req.user.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const { first_name, last_name, phone_number, id_number, email, monthly_contribution, notes } = req.body || {};
    if (!first_name || !last_name) {
      return res.status(400).json({ error: "First and last name are required" });
    }
    const countRes = await query(`SELECT COUNT(*)::int AS n FROM members WHERE tenant_id = $1`, [tid]);
    const memberNo = `MBR-${String(countRes.rows[0].n + 1).padStart(5, "0")}`;
    const r = await query(
      `INSERT INTO members
         (tenant_id, member_no, first_name, last_name, phone_number, id_number, email, monthly_contribution, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        tid, memberNo, String(first_name).trim(), String(last_name).trim(),
        phone_number || null, id_number || null, email || null,
        monthly_contribution != null && monthly_contribution !== "" ? parseFloat(monthly_contribution) : null,
        notes || null, req.user.id,
      ],
    );
    await logAudit({
      user: req.user,
      action: "member_created",
      entityType: "member",
      entityId: r.rows[0].id,
      entityCode: memberNo,
      description: `Member ${first_name} ${last_name} enrolled`,
      req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member create error:", e);
    res.status(500).json({ error: "Failed to create member" });
  }
});

// GET /api/members/:id — member + savings balance + ledger.
router.get("/:id", async (req, res) => {
  try {
    const member = await loadMember(req, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const savings = await memberSavings(member.id);
    const ledger = await query(
      `SELECT * FROM member_pool_transactions
        WHERE member_id = $1 ORDER BY id DESC LIMIT 200`,
      [member.id],
    );
    res.json({ success: true, data: { member, savings_balance: savings, transactions: ledger.rows } });
  } catch (e) {
    logger.error("member get error:", e);
    res.status(500).json({ error: "Failed to load member" });
  }
});

// PUT /api/members/:id — update.
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const { first_name, last_name, phone_number, id_number, email, monthly_contribution, status, notes } = req.body || {};
    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const r = await query(
      `UPDATE members SET
          first_name = COALESCE($2, first_name),
          last_name = COALESCE($3, last_name),
          phone_number = $4, id_number = $5, email = $6,
          monthly_contribution = $7, status = COALESCE($8, status), notes = $9,
          updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        member.id,
        first_name ? String(first_name).trim() : null,
        last_name ? String(last_name).trim() : null,
        phone_number ?? member.phone_number,
        id_number ?? member.id_number,
        email ?? member.email,
        monthly_contribution != null && monthly_contribution !== "" ? parseFloat(monthly_contribution) : member.monthly_contribution,
        status || null,
        notes ?? member.notes,
      ],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member update error:", e);
    res.status(500).json({ error: "Failed to update member" });
  }
});

// GET /api/members/:id/ledger — the member's pool activity.
router.get("/:id/ledger", async (req, res) => {
  try {
    const member = await loadMember(req, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const r = await query(
      `SELECT * FROM member_pool_transactions WHERE member_id = $1 ORDER BY id DESC LIMIT 500`,
      [member.id],
    );
    res.json({ success: true, data: { savings_balance: await memberSavings(member.id), transactions: r.rows } });
  } catch (e) {
    logger.error("member ledger error:", e);
    res.status(500).json({ error: "Failed to load ledger" });
  }
});

// POST /api/members/:id/contributions — deposit into the pool.
router.post(
  "/:id/contributions",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const member = await loadMember(req, req.params.id);
      if (!member) return res.status(404).json({ error: "Member not found" });
      const amt = parseFloat(req.body?.amount);
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      const row = await postPool({
        tenantId: member.tenant_id,
        memberId: member.id,
        type: "contribution",
        amount: amt,
        direction: 1,
        txnDate: req.body?.txn_date,
        description: req.body?.notes,
        userId: req.user.id,
      });
      await logAudit({
        user: req.user,
        action: "member_contribution",
        entityType: "member",
        entityId: member.id,
        entityCode: member.member_no,
        description: `Contribution KES ${amt} from ${member.first_name} ${member.last_name}`,
        req,
      });
      res.status(201).json({
        success: true,
        data: row,
        pool_balance: Number(row.balance_after),
        savings_balance: await memberSavings(member.id),
      });
    } catch (e) {
      logger.error("member contribution error:", e);
      res.status(500).json({ error: "Failed to record contribution" });
    }
  },
);

// POST /api/members/:id/withdrawals — pay out a member's savings.
router.post(
  "/:id/withdrawals",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const member = await loadMember(req, req.params.id);
      if (!member) return res.status(404).json({ error: "Member not found" });
      const amt = parseFloat(req.body?.amount);
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      const savings = await memberSavings(member.id);
      if (amt > savings) {
        return res.status(400).json({
          error: `Member only has KES ${savings.toLocaleString()} in savings`,
        });
      }
      const pool = await poolBalance(member.tenant_id);
      if (amt > pool) {
        return res.status(400).json({ error: `Pool only holds KES ${pool.toLocaleString()}` });
      }
      const row = await postPool({
        tenantId: member.tenant_id,
        memberId: member.id,
        type: "withdrawal",
        amount: amt,
        direction: -1,
        txnDate: req.body?.txn_date,
        description: req.body?.notes,
        userId: req.user.id,
      });
      await logAudit({
        user: req.user,
        action: "member_withdrawal",
        entityType: "member",
        entityId: member.id,
        entityCode: member.member_no,
        description: `Withdrawal KES ${amt} to ${member.first_name} ${member.last_name}`,
        req,
      });
      res.status(201).json({
        success: true,
        data: row,
        pool_balance: Number(row.balance_after),
        savings_balance: await memberSavings(member.id),
      });
    } catch (e) {
      logger.error("member withdrawal error:", e);
      res.status(500).json({ error: "Failed to record withdrawal" });
    }
  },
);

export default router;
