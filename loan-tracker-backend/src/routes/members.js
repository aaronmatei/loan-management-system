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

// ---------------- MEMBER LOANS (funded by the pool) ----------------

async function loadMemberLoan(memberId, loanId) {
  const r = await query(
    `SELECT * FROM member_loans WHERE id = $1 AND member_id = $2`,
    [loanId, memberId],
  );
  return r.rows[0] || null;
}

// GET /api/members/:id/loans — a member's loans from the pool.
router.get("/:id/loans", async (req, res) => {
  try {
    const member = await loadMember(req, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const r = await query(
      `SELECT *, GREATEST(total_amount_due - amount_paid, 0) AS balance
         FROM member_loans WHERE member_id = $1 ORDER BY created_at DESC`,
      [member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loans list error:", e);
    res.status(500).json({ error: "Failed to load member loans" });
  }
});

// POST /api/members/:id/loans — issue a loan to the member out of the pool.
router.post(
  "/:id/loans",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const member = await loadMember(req, req.params.id);
      if (!member) return res.status(404).json({ error: "Member not found" });
      if (member.status !== "active") {
        return res.status(400).json({ error: "Member is not active" });
      }
      const principal = parseFloat(req.body?.principal);
      if (!(principal > 0)) return res.status(400).json({ error: "Principal must be positive" });
      const months = parseInt(req.body?.duration_months, 10) || 1;
      if (months < 1) return res.status(400).json({ error: "Duration must be at least 1 month" });
      const rate = req.body?.interest_rate != null && req.body.interest_rate !== ""
        ? parseFloat(req.body.interest_rate)
        : 0;
      if (rate < 0) return res.status(400).json({ error: "Interest rate can't be negative" });

      // The pool must hold enough cash to lend.
      const pool = await poolBalance(member.tenant_id);
      if (principal > pool) {
        return res.status(400).json({
          error: `Pool only holds KES ${pool.toLocaleString()} — can't lend KES ${principal.toLocaleString()}`,
        });
      }

      // Flat interest over the term (annual rate pro-rated by months).
      const interest = round2(principal * (rate / 100) * (months / 12));
      const totalDue = round2(principal + interest);
      const countRes = await query(
        `SELECT COUNT(*)::int AS n FROM member_loans WHERE tenant_id = $1`,
        [member.tenant_id],
      );
      const loanCode = `MBL-${String(countRes.rows[0].n + 1).padStart(5, "0")}`;
      const due = new Date();
      due.setMonth(due.getMonth() + months);
      const dueISO = due.toISOString().split("T")[0];

      const loanRes = await query(
        `INSERT INTO member_loans
           (tenant_id, member_id, loan_code, principal, interest_rate, duration_months,
            total_interest, total_amount_due, status, disbursed_at, due_date, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW(),$9::date,$10,$11)
         RETURNING *`,
        [
          member.tenant_id, member.id, loanCode, principal, rate, months,
          interest, totalDue, dueISO, req.body?.notes || null, req.user.id,
        ],
      );
      const loan = loanRes.rows[0];

      // Cash leaves the pool.
      const poolTxn = await postPool({
        tenantId: member.tenant_id,
        memberId: member.id,
        type: "loan_disbursed",
        amount: principal,
        direction: -1,
        description: `Loan ${loanCode} to ${member.first_name} ${member.last_name}`,
        userId: req.user.id,
      });
      await query(`UPDATE member_pool_transactions SET member_loan_id = $1 WHERE id = $2`, [
        loan.id,
        poolTxn.id,
      ]);

      await logAudit({
        user: req.user,
        action: "member_loan_disbursed",
        entityType: "member_loan",
        entityId: loan.id,
        entityCode: loanCode,
        description: `Member loan ${loanCode}: KES ${principal} to ${member.first_name} ${member.last_name} from the pool`,
        req,
      });
      res.status(201).json({ success: true, data: loan, pool_balance: Number(poolTxn.balance_after) });
    } catch (e) {
      logger.error("member loan issue error:", e);
      res.status(500).json({ error: "Failed to issue member loan" });
    }
  },
);

// POST /api/members/:id/loans/:loanId/payments — repay into the pool.
router.post(
  "/:id/loans/:loanId/payments",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const member = await loadMember(req, req.params.id);
      if (!member) return res.status(404).json({ error: "Member not found" });
      const loan = await loadMemberLoan(member.id, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Member loan not found" });
      if (loan.status === "completed") {
        return res.status(400).json({ error: "Loan already fully paid" });
      }

      const outstanding = round2(parseFloat(loan.total_amount_due) - parseFloat(loan.amount_paid));
      const amt = req.body?.amount != null && req.body.amount !== ""
        ? parseFloat(req.body.amount)
        : outstanding;
      if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
      if (amt > outstanding) {
        return res.status(400).json({ error: `Loan only owes KES ${outstanding.toLocaleString()}` });
      }

      const newPaid = round2(parseFloat(loan.amount_paid) + amt);
      const completed = newPaid >= parseFloat(loan.total_amount_due);
      await query(
        `UPDATE member_loans
            SET amount_paid = $2, status = $3, updated_at = NOW()
          WHERE id = $1`,
        [loan.id, newPaid, completed ? "completed" : loan.status === "defaulted" ? "active" : loan.status],
      );

      // Cash returns to the pool (principal + interest both grow it).
      const poolTxn = await postPool({
        tenantId: member.tenant_id,
        memberId: member.id,
        type: "loan_repayment",
        amount: amt,
        direction: 1,
        description: `Repayment on ${loan.loan_code}`,
        userId: req.user.id,
      });
      await query(`UPDATE member_pool_transactions SET member_loan_id = $1 WHERE id = $2`, [
        loan.id,
        poolTxn.id,
      ]);

      await logAudit({
        user: req.user,
        action: "member_loan_repayment",
        entityType: "member_loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Repayment KES ${amt} on ${loan.loan_code}${completed ? " (cleared)" : ""}`,
        req,
      });
      res.json({
        success: true,
        completed,
        pool_balance: Number(poolTxn.balance_after),
        outstanding: round2(parseFloat(loan.total_amount_due) - newPaid),
      });
    } catch (e) {
      logger.error("member loan payment error:", e);
      res.status(500).json({ error: "Failed to record repayment" });
    }
  },
);

// POST /api/members/:id/loans/:loanId/default — mark a member loan defaulted.
router.post(
  "/:id/loans/:loanId/default",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const member = await loadMember(req, req.params.id);
      if (!member) return res.status(404).json({ error: "Member not found" });
      const loan = await loadMemberLoan(member.id, req.params.loanId);
      if (!loan) return res.status(404).json({ error: "Member loan not found" });
      if (loan.status !== "active") {
        return res.status(400).json({ error: `Can't default a ${loan.status} loan` });
      }
      await query(`UPDATE member_loans SET status='defaulted', updated_at=NOW() WHERE id=$1`, [loan.id]);
      await logAudit({
        user: req.user,
        action: "member_loan_defaulted",
        entityType: "member_loan",
        entityId: loan.id,
        entityCode: loan.loan_code,
        description: `Member loan ${loan.loan_code} marked defaulted`,
        req,
      });
      res.json({ success: true });
    } catch (e) {
      logger.error("member loan default error:", e);
      res.status(500).json({ error: "Failed to default loan" });
    }
  },
);

export default router;
