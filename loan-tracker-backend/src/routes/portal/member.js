// Welfare/chama MEMBER self-service portal. A platform_customer who is linked to
// a welfare tenant (customer_tenant_links.member_id) sees their own savings,
// contributions, chama loans, dividends, meetings and penalties here. Mounted at
// /api/portal/member, gated by verifyCustomer + resolveMember. Read-only in this
// phase; pay actions (Phase C) and requests (Phase D) build on the same resolver.
import express from "express";
import { query } from "../../config/database.js";
import { verifyCustomer } from "../../middleware/customerAuth.js";
import { poolBalance, memberSavings, round2 } from "../../services/welfarePoolService.js";
import { initiateWelfareSTK } from "../../services/welfareMpesaService.js";
import logger from "../../config/logger.js";

const router = express.Router();
router.use(verifyCustomer);

// Resolve the member behind the selected welfare tenant. 403 (not 500) when the
// current tenant is a lender — a borrower hitting member routes is simply not a
// member there.
router.use(async (req, res, next) => {
  try {
    if (!req.currentTenantId) {
      return res.status(400).json({ error: "Select your welfare first" });
    }
    const r = await query(
      `SELECT m.*, g.name AS welfare_name
         FROM customer_tenant_links ctl
         JOIN members m ON m.id = ctl.member_id
         JOIN groups g ON g.id = m.welfare_id
        WHERE ctl.platform_customer_id = $1
          AND ctl.tenant_id = $2
          AND ctl.status = 'active'`,
      [req.platformCustomerId, req.currentTenantId],
    );
    if (!r.rows.length) {
      return res.status(403).json({ error: "You are not a member of this welfare" });
    }
    req.member = r.rows[0];
    req.welfareId = r.rows[0].welfare_id;
    next();
  } catch (e) {
    logger.error("resolveMember error:", e);
    res.status(500).json({ error: "Failed to resolve membership" });
  }
});

// GET /overview — dashboard: who they are, savings, the chama pool, and quick
// counts (outstanding loan balance, outstanding penalties, next contribution).
router.get("/overview", async (req, res) => {
  try {
    const m = req.member;
    const [savings, pool, loans, penalties, nextDue, recent] = await Promise.all([
      memberSavings(m.id),
      poolBalance(req.welfareId),
      query(
        `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
                COALESCE(SUM(total_amount_due - amount_paid) FILTER (WHERE status = 'active'), 0) AS outstanding
           FROM member_loans WHERE member_id = $1`,
        [m.id],
      ),
      query(
        `SELECT COALESCE(SUM(amount - paid_amount), 0) AS outstanding
           FROM penalty_assessments WHERE member_id = $1 AND status = 'outstanding'`,
        [m.id],
      ),
      query(
        `SELECT cs.amount_due, cs.amount_paid, cs.due_date, cs.status, cc.name AS cycle_name
           FROM contribution_schedules cs
           JOIN contribution_cycles cc ON cc.id = cs.cycle_id
          WHERE cs.member_id = $1 AND cs.status IN ('pending','partial','overdue')
          ORDER BY cs.due_date ASC LIMIT 1`,
        [m.id],
      ),
      query(
        `SELECT type, amount, direction, balance_after, txn_date, description
           FROM member_pool_transactions WHERE member_id = $1 ORDER BY id DESC LIMIT 10`,
        [m.id],
      ),
    ]);
    res.json({
      success: true,
      data: {
        member: {
          id: m.id, member_no: m.member_no, first_name: m.first_name, last_name: m.last_name,
          phone_number: m.phone_number, status: m.status, monthly_contribution: m.monthly_contribution,
          joined_at: m.joined_at,
        },
        welfare: { id: req.welfareId, name: m.welfare_name, pool_balance: round2(pool) },
        savings_balance: round2(savings),
        loans: { active: loans.rows[0].active_count, outstanding: round2(loans.rows[0].outstanding) },
        penalties_outstanding: round2(penalties.rows[0].outstanding),
        next_contribution: nextDue.rows[0] || null,
        recent_transactions: recent.rows,
      },
    });
  } catch (e) {
    logger.error("member overview error:", e);
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// GET /ledger — the member's full savings/pool ledger.
router.get("/ledger", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, type, amount, direction, balance_after, txn_date, description, created_at
         FROM member_pool_transactions WHERE member_id = $1 ORDER BY id DESC LIMIT 300`,
      [req.member.id],
    );
    res.json({ success: true, data: { savings_balance: round2(await memberSavings(req.member.id)), transactions: r.rows } });
  } catch (e) {
    logger.error("member ledger error:", e);
    res.status(500).json({ error: "Failed to load ledger" });
  }
});

// GET /contributions — the member's contribution schedules across cycles.
router.get("/contributions", async (req, res) => {
  try {
    const r = await query(
      `SELECT cs.id, cs.amount_due, cs.amount_paid, cs.due_date, cs.status,
              cc.id AS cycle_id, cc.name AS cycle_name, cc.frequency, cc.period_start
         FROM contribution_schedules cs
         JOIN contribution_cycles cc ON cc.id = cs.cycle_id
        WHERE cs.member_id = $1
        ORDER BY cs.due_date DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member contributions error:", e);
    res.status(500).json({ error: "Failed to load contributions" });
  }
});

// GET /loans — the member's chama loans (with live balance).
router.get("/loans", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, loan_code, principal, interest_rate, duration_months, total_interest,
              total_amount_due, amount_paid, (total_amount_due - amount_paid) AS balance,
              status, disbursed_at, due_date
         FROM member_loans WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loans error:", e);
    res.status(500).json({ error: "Failed to load loans" });
  }
});

// GET /loans/:loanId — one chama loan + its repayment ledger.
router.get("/loans/:loanId", async (req, res) => {
  try {
    const loan = (
      await query(
        `SELECT id, loan_code, principal, interest_rate, duration_months, total_interest,
                total_amount_due, amount_paid, (total_amount_due - amount_paid) AS balance,
                status, disbursed_at, due_date, notes
           FROM member_loans WHERE id = $1 AND member_id = $2`,
        [req.params.loanId, req.member.id],
      )
    ).rows[0];
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const payments = await query(
      `SELECT amount, txn_date, description FROM member_pool_transactions
        WHERE member_loan_id = $1 AND type = 'loan_repayment' ORDER BY id DESC`,
      [loan.id],
    );
    res.json({ success: true, data: { loan, payments: payments.rows } });
  } catch (e) {
    logger.error("member loan detail error:", e);
    res.status(500).json({ error: "Failed to load loan" });
  }
});

// GET /penalties — the member's penalties.
router.get("/penalties", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, trigger, amount, paid_amount, (amount - paid_amount) AS balance,
              status, description, assessed_at
         FROM penalty_assessments WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member penalties error:", e);
    res.status(500).json({ error: "Failed to load penalties" });
  }
});

// GET /meetings — the welfare's meetings + this member's attendance.
router.get("/meetings", async (req, res) => {
  try {
    const r = await query(
      `SELECT gm.id, gm.meeting_date, gm.location, gm.agenda, gm.status,
              ma.status AS my_attendance
         FROM group_meetings gm
         LEFT JOIN member_attendance ma ON ma.meeting_id = gm.id AND ma.member_id = $1
        WHERE gm.group_id = $2
        ORDER BY gm.meeting_date DESC`,
      [req.member.id, req.welfareId],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member meetings error:", e);
    res.status(500).json({ error: "Failed to load meetings" });
  }
});

// GET /dividends — share-outs the member received.
router.get("/dividends", async (req, res) => {
  try {
    const r = await query(
      `SELECT mpt.amount, mpt.txn_date, dd.basis, dd.total_amount AS distribution_total, dd.notes
         FROM member_pool_transactions mpt
         JOIN dividend_distributions dd ON dd.id = mpt.dividend_distribution_id
        WHERE mpt.member_id = $1 AND mpt.type = 'dividend'
        ORDER BY mpt.id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member dividends error:", e);
    res.status(500).json({ error: "Failed to load dividends" });
  }
});

// ── Pay actions (M-Pesa STK) ──────────────────────────────────────────────
// Each validates the target belongs to THIS member, then reuses the shared
// welfare STK initiator (initiatedByUserId=null — the member, not staff). The
// Daraja callback applies the payment via allocateWelfarePayment, unchanged.
const welfareOf = (req) => ({ id: req.welfareId, tenant_id: req.member.tenant_id });

// POST /mpesa/contribution { schedule_id, phone? }
router.post("/mpesa/contribution", async (req, res) => {
  try {
    const s = (
      await query(
        `SELECT s.* FROM contribution_schedules s
         WHERE s.id = $1 AND s.member_id = $2`,
        [req.body?.schedule_id, req.member.id],
      )
    ).rows[0];
    if (!s) return res.status(404).json({ error: "Contribution not found" });
    const amount = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
    const r = await initiateWelfareSTK({
      welfare: welfareOf(req), member: req.member, amount,
      targetType: "contribution_schedule", targetId: s.id,
      purpose: "welfare_contribution", desc: "Contribution", phone: req.body?.phone,
    });
    res.json({ success: true, message: r.message, checkout_request_id: r.checkoutRequestId });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member pay contribution error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// POST /mpesa/loan-repayment { loan_id, amount?, phone? }
router.post("/mpesa/loan-repayment", async (req, res) => {
  try {
    const l = (
      await query(`SELECT * FROM member_loans WHERE id = $1 AND member_id = $2`, [
        req.body?.loan_id, req.member.id,
      ])
    ).rows[0];
    if (!l) return res.status(404).json({ error: "Loan not found" });
    const outstanding = round2(parseFloat(l.total_amount_due) - parseFloat(l.amount_paid));
    const amount =
      req.body?.amount != null && req.body.amount !== ""
        ? Math.min(parseFloat(req.body.amount), outstanding)
        : outstanding;
    const r = await initiateWelfareSTK({
      welfare: welfareOf(req), member: req.member, amount,
      targetType: "member_loan", targetId: l.id,
      purpose: "welfare_loan_repayment", desc: "Loan Repay", phone: req.body?.phone,
    });
    res.json({ success: true, message: r.message, checkout_request_id: r.checkoutRequestId });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member pay loan error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// POST /mpesa/penalty { assessment_id, phone? }
router.post("/mpesa/penalty", async (req, res) => {
  try {
    const a = (
      await query(`SELECT * FROM penalty_assessments WHERE id = $1 AND member_id = $2`, [
        req.body?.assessment_id, req.member.id,
      ])
    ).rows[0];
    if (!a) return res.status(404).json({ error: "Penalty not found" });
    if (a.status !== "outstanding") return res.status(400).json({ error: `Penalty is ${a.status}` });
    const amount = round2(parseFloat(a.amount) - parseFloat(a.paid_amount));
    const r = await initiateWelfareSTK({
      welfare: welfareOf(req), member: req.member, amount,
      targetType: "penalty_assessment", targetId: a.id,
      purpose: "welfare_penalty", desc: "Penalty", phone: req.body?.phone,
    });
    res.json({ success: true, message: r.message, checkout_request_id: r.checkoutRequestId });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member pay penalty error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// ── Requests (loan from the pool / savings withdrawal) ────────────────────
// Members ASK; a welfare admin approves. No pool effect until approval.

// POST /loan-requests { principal, duration_months, interest_rate?, purpose }
router.post("/loan-requests", async (req, res) => {
  try {
    if (req.member.status !== "active") return res.status(400).json({ error: "Your membership is not active" });
    const principal = parseFloat(req.body?.principal);
    if (!(principal > 0)) return res.status(400).json({ error: "Enter an amount greater than 0" });
    const months = parseInt(req.body?.duration_months, 10) || 1;
    const rate =
      req.body?.interest_rate != null && req.body.interest_rate !== ""
        ? parseFloat(req.body.interest_rate)
        : null;
    const r = await query(
      `INSERT INTO member_loan_requests
         (tenant_id, welfare_id, member_id, principal, duration_months, interest_rate, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [req.member.tenant_id, req.welfareId, req.member.id, principal, months, rate, req.body?.purpose || null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan-request error:", e);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// GET /loan-requests — this member's loan requests.
router.get("/loan-requests", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, principal, duration_months, interest_rate, purpose, status,
              decision_notes, created_at, decided_at
         FROM member_loan_requests WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loan-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// POST /withdrawal-requests { amount, reason }
router.post("/withdrawal-requests", async (req, res) => {
  try {
    if (req.member.status !== "active") return res.status(400).json({ error: "Your membership is not active" });
    const amount = parseFloat(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: "Enter an amount greater than 0" });
    const savings = await memberSavings(req.member.id);
    if (amount > savings) {
      return res.status(400).json({ error: `You only have ${round2(savings).toLocaleString()} in savings` });
    }
    const r = await query(
      `INSERT INTO member_withdrawal_requests
         (tenant_id, welfare_id, member_id, amount, reason, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [req.member.tenant_id, req.welfareId, req.member.id, round2(amount), req.body?.reason || null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member withdrawal-request error:", e);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// GET /withdrawal-requests — this member's withdrawal requests.
router.get("/withdrawal-requests", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, amount, reason, status, decision_notes, created_at, decided_at
         FROM member_withdrawal_requests WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member withdrawal-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// GET /mpesa/transactions — this member's payment attempts (for status polling).
router.get("/mpesa/transactions", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, purpose, target_type, target_id, amount, status, allocated,
              mpesa_receipt_number, created_at
         FROM mpesa_transactions
        WHERE member_id = $1 ORDER BY id DESC LIMIT 50`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member mpesa list error:", e);
    res.status(500).json({ error: "Failed to load transactions" });
  }
});

export default router;
