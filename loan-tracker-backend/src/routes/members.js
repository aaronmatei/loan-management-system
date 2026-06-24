// Welfare members + their contributions pool + lending. Mounted at
// /api/welfares/:welfareId/members — members belong to a welfare (the entity
// elsewhere called a group), each welfare having its OWN members, pool and
// member loans. The pool is entirely separate from the lending capital_pool.
//
// member_pool_transactions is the welfare pool's running ledger (balance_after =
// that welfare's pool balance). A member's savings balance is the net of their
// contribution/withdrawal/dividend rows. Member loans (loan_disbursed /
// loan_repayment) draw the pool down and restore it.
import express from "express";
import { query, withTransaction } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { notifyWithdrawal } from "../services/welfareSmsService.js";
import { inviteMemberToPortal } from "../services/memberInviteService.js";
import { nextMemberNo } from "../utils/clientCode.js";
import {
  round2, SAVINGS_TYPES, poolBalance, memberSavings,
  postPool, issueMemberLoan, recordWithdrawal,
} from "../services/welfarePoolService.js";
import { recordMemberLoanPayment } from "../services/memberLoanService.js";
import { gateLoanWrites } from "../services/welfareLoanFlag.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Pool/savings read helpers live in welfarePoolService (shared with the member
// portal) so the running balance is only ever computed one way.

// Resolve + tenant-check the welfare for every request; stash on req.welfare.
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(
      `SELECT * FROM groups WHERE id = $1${tc.clause}`,
      [req.params.welfareId, ...tc.params],
    );
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function loadMember(welfareId, id) {
  const r = await query(`SELECT * FROM members WHERE id = $1 AND welfare_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}

// Admin-only onboarding status for a member's portal login. Reports only what
// can be known for certain — whether an account exists, whether a temp password
// was issued, and whether they've ever signed in. It deliberately does NOT
// assert a password FORMAT: the hash can't be inspected, and accounts have been
// seeded/set with different conventions (phone-based, ID-based, manual), so
// guessing the format misleads. When in doubt, staff should RESET the password.
async function memberPasswordStatus(memberId) {
  const r = await query(
    `SELECT pc.must_change_password,
            (pc.password_hash IS NOT NULL) AS has_password,
            (pc.last_login IS NOT NULL)    AS has_logged_in
       FROM customer_tenant_links ctl
       JOIN platform_customers pc ON pc.id = ctl.platform_customer_id
      WHERE ctl.member_id = $1
      LIMIT 1`,
    [memberId],
  );
  const a = r.rows[0];
  if (!a || !a.has_password) {
    return { status: "none", label: "Not on the portal yet — send an invite to create their login." };
  }
  if (a.has_logged_in) {
    return { status: "active", label: "Active — the member manages their own password." };
  }
  if (a.must_change_password) {
    return { status: "temp", label: "A temporary password was sent to them by SMS; they set their own at first login." };
  }
  return {
    status: "set",
    label: "Has a login but hasn't signed in yet. If they don't know their password, reset it for them rather than guessing.",
  };
}

// GET /pool — this welfare's pool summary.
router.get("/pool", async (req, res) => {
  try {
    const balance = await poolBalance(req.welfare.id);
    const totals = await query(
      `SELECT
          COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS total_contributions,
          COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS total_withdrawals,
          COALESCE(SUM(amount) FILTER (WHERE type='loan_disbursed'),0) AS total_loaned
         FROM member_pool_transactions WHERE welfare_id = $1`,
      [req.welfare.id],
    );
    const mc = await query(
      `SELECT COUNT(*)::int AS n FROM members WHERE welfare_id = $1 AND status='active'`,
      [req.welfare.id],
    );
    res.json({
      success: true,
      data: {
        balance,
        total_contributions: Number(totals.rows[0].total_contributions),
        total_withdrawals: Number(totals.rows[0].total_withdrawals),
        total_loaned: Number(totals.rows[0].total_loaned),
        member_count: mc.rows[0].n,
      },
    });
  } catch (e) {
    logger.error("welfare pool error:", e);
    res.status(500).json({ error: "Failed to load pool" });
  }
});

// GET / — members of this welfare with savings balances.
router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const params = [req.welfare.id];
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
        WHERE m.welfare_id = $1${searchClause}
        ORDER BY LOWER(m.first_name) ASC, LOWER(m.last_name) ASC`,
      params,
    );
    res.json({
      success: true,
      data: r.rows.map((m) => ({ ...m, savings_balance: Number(m.savings_balance) })),
    });
  } catch (e) {
    logger.error("welfare members list error:", e);
    res.status(500).json({ error: "Failed to load members" });
  }
});

// POST / — enrol a member in this welfare.
router.post("/", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const w = req.welfare;
    const { first_name, last_name, phone_number, id_number, email, monthly_contribution, notes, contribution_exempt, exempt_reason } = req.body || {};
    if (!first_name || !last_name) {
      return res.status(400).json({ error: "First and last name are required" });
    }
    // Exempt = sick/hardship: skipped from contribution dues + penalties while
    // exempt, but remains a full active member (migration 108).
    const exempt = !!contribution_exempt;
    const memberNo = await nextMemberNo(query, w);
    const r = await query(
      `INSERT INTO members
         (tenant_id, welfare_id, member_no, first_name, last_name, phone_number, id_number, email, monthly_contribution, notes, created_by, contribution_exempt, exempt_reason, exempt_since)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        w.tenant_id, w.id, memberNo, String(first_name).trim(), String(last_name).trim(),
        phone_number || null, id_number || null, email || null,
        monthly_contribution != null && monthly_contribution !== "" ? parseFloat(monthly_contribution) : null,
        notes || null, req.user.id,
        exempt, exempt ? (exempt_reason || null) : null, exempt ? new Date() : null,
      ],
    );
    await logAudit({
      user: req.user, action: "member_created", entityType: "member",
      entityId: r.rows[0].id, entityCode: memberNo,
      description: `Member ${first_name} ${last_name} enrolled in welfare "${w.name}"`, req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare member create error:", e);
    res.status(500).json({ error: "Failed to create member" });
  }
});

// GET /:id — member + savings + ledger.
router.get("/:id", async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const ledger = await query(
      `SELECT * FROM member_pool_transactions WHERE member_id = $1 ORDER BY id DESC LIMIT 200`,
      [member.id],
    );
    const linked = await query(
      "SELECT 1 FROM customer_tenant_links WHERE member_id = $1 AND status = 'active' LIMIT 1",
      [member.id],
    );
    res.json({
      success: true,
      data: {
        member,
        savings_balance: await memberSavings(member.id),
        transactions: ledger.rows,
        portal_linked: linked.rows.length > 0,
        // Admin-only hint on what credential the member should use — describes
        // the FORMAT/status, never the literal password. Lets staff tell a
        // lender-origin member (whose default is ID-based, not phone-based) the
        // right thing without exposing anyone's password.
        portal_password: await memberPasswordStatus(member.id),
      },
    });
  } catch (e) {
    logger.error("welfare member get error:", e);
    res.status(500).json({ error: "Failed to load member" });
  }
});

// GET /:id/activity — the member's contribution status, fines, and attendance.
router.get("/:id/activity", async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const mid = member.id;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    // Contribution/event cycles (in the selected year) this member is scheduled for.
    const contributions = (await query(
      `SELECT c.name AS cycle_name, c.due_date, c.pool_key, p.name AS plan_name, p.frequency,
              s.amount_due, s.amount_paid, s.status, s.paid_at,
              (s.status='paid' AND s.paid_at IS NOT NULL AND s.paid_at::date <= (s.due_date + (COALESCE(c.grace_days,0) * INTERVAL '1 day'))::date) AS on_time
         FROM contribution_schedules s
         JOIN contribution_cycles c ON c.id = s.cycle_id
         LEFT JOIN contribution_plans p ON p.id = c.plan_id
        WHERE s.member_id = $1 AND EXTRACT(YEAR FROM c.due_date) = $2
        ORDER BY c.due_date DESC`,
      [mid, year],
    )).rows;
    const cs = (await query(
      `SELECT COALESCE(SUM(s.amount_due),0) expected, COALESCE(SUM(s.amount_paid),0) paid,
              COUNT(*) FILTER (WHERE s.status='paid')::int paid_count, COUNT(*)::int total
         FROM contribution_schedules s JOIN contribution_cycles c ON c.id=s.cycle_id
        WHERE s.member_id=$1 AND EXTRACT(YEAR FROM c.due_date)=$2`, [mid, year])).rows[0];

    // Fines (for that year's contributions/meetings), with what they were for.
    const fines = (await query(
      `SELECT pa.id, pa.trigger, pa.amount, pa.paid_amount, pa.status, pa.assessed_at,
              COALESCE(cyc.name, mtg.title) AS source_label,
              CASE WHEN pa.source_type='meeting' THEN 'meeting' WHEN pa.source_type='contribution_schedule' THEN 'contribution' ELSE pa.source_type END AS source_kind
         FROM penalty_assessments pa
         LEFT JOIN contribution_schedules cs2 ON pa.source_type='contribution_schedule' AND cs2.id=pa.source_id
         LEFT JOIN contribution_cycles cyc ON cyc.id=cs2.cycle_id
         LEFT JOIN group_meetings mtg ON pa.source_type='meeting' AND mtg.id=pa.source_id
        WHERE pa.member_id=$1 AND EXTRACT(YEAR FROM COALESCE(cyc.due_date, mtg.meeting_date, pa.assessed_at))=$2
        ORDER BY pa.assessed_at DESC`, [mid, year])).rows;
    const finesOutstanding = fines.reduce((a, f) => a + (f.status === "outstanding" ? Number(f.amount) - Number(f.paid_amount) : 0), 0);

    // Attendance is a lifetime membership stat — ALL held meetings & events
    // (not year-scoped), so a member's full participation record shows. An
    // "event" meeting is one that handed out a benefit-pool payout.
    const meetings = (await query(
      `SELECT gm.id, gm.title, gm.meeting_date, gm.status AS meeting_status, a.status,
              EXISTS(SELECT 1 FROM benefit_pool_ledger l WHERE l.meeting_id=gm.id AND l.type='payout') AS is_event
         FROM group_meetings gm
         LEFT JOIN member_attendance a ON a.meeting_id=gm.id AND a.member_id=$1
        WHERE gm.group_id=$2 AND gm.status='held' ORDER BY gm.meeting_date DESC`, [mid, req.welfare.id])).rows;
    const recorded = meetings.filter((m) => m.status).length;
    const attended = meetings.filter((m) => m.status === "present" || m.status === "late").length;

    res.json({ success: true, data: {
      year,
      contributions,
      contribution_summary: { expected: Number(cs.expected), paid: Number(cs.paid), paid_count: cs.paid_count, total: cs.total },
      fines, fines_outstanding: finesOutstanding,
      attendance: { meetings, recorded, attended, rate: recorded ? Math.round((attended / recorded) * 100) : null },
    } });
  } catch (e) {
    logger.error("member activity error:", e);
    res.status(500).json({ error: "Failed to load member activity" });
  }
});

// POST /:id/invite — give this member a self-service portal login. Provisions
// (or reuses) a platform_customers account by phone, links it to this welfare,
// and texts them a login link. Re-invites are idempotent (resend the SMS).
router.post("/:id/invite", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (member.status !== "active") {
      return res.status(400).json({ error: "Only active members can be invited" });
    }
    const result = await inviteMemberToPortal({
      welfare: req.welfare,
      member,
      sentBy: req.user?.id || null,
    });
    await logAudit({
      user: req.user,
      action: "member_portal_invited",
      entityType: "member",
      entityId: member.id,
      entityCode: member.member_no,
      description: `Invited ${member.first_name} ${member.last_name} to the member portal`,
      req,
    });
    res.json({
      success: true,
      data: { portal_linked: true, already_linked: result.alreadyLinked, new_account: result.isNew },
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("welfare member invite error:", e);
    res.status(500).json({ error: "Failed to invite member" });
  }
});

// PUT /:id — update.
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const { first_name, last_name, phone_number, id_number, email, monthly_contribution, status, notes, contribution_exempt, exempt_reason } = req.body || {};
    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    // Resolve the exemption (sick/hardship). When omitted, keep the current
    // value. Stamp exempt_since the first time it flips on; clear reason+since
    // when it flips off (migration 108).
    const exempt = contribution_exempt === undefined ? member.contribution_exempt : !!contribution_exempt;
    const exemptSince = exempt ? (member.exempt_since || new Date()) : null;
    const exemptReason = exempt ? (exempt_reason ?? member.exempt_reason ?? null) : null;
    const r = await query(
      `UPDATE members SET
          first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name),
          phone_number = $4, id_number = $5, email = $6,
          monthly_contribution = $7, status = COALESCE($8, status), notes = $9,
          contribution_exempt = $10, exempt_reason = $11, exempt_since = $12, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        member.id,
        first_name ? String(first_name).trim() : null,
        last_name ? String(last_name).trim() : null,
        phone_number ?? member.phone_number, id_number ?? member.id_number, email ?? member.email,
        monthly_contribution != null && monthly_contribution !== "" ? parseFloat(monthly_contribution) : member.monthly_contribution,
        status || null, notes ?? member.notes,
        exempt, exemptReason, exemptSince,
      ],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare member update error:", e);
    res.status(500).json({ error: "Failed to update member" });
  }
});

// PUT /:id/role — set/clear a member's officer role. Officers are normally
// elected via the decisions/voting feature, but admin/manager can assign
// directly (bootstrap before any election, or a manual fix). Assigning an
// officer role demotes any current holder of that role in the same welfare to
// 'member', so the one-per-welfare rule holds without a constraint error.
const OFFICER_ROLES = ["chair", "treasurer", "secretary"];
const MEMBER_ROLES = ["member", ...OFFICER_ROLES];
router.put("/:id/role", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const role = String(req.body?.role || "").toLowerCase();
    if (!MEMBER_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${MEMBER_ROLES.join(", ")}` });

    const updated = await withTransaction(async (client) => {
      if (OFFICER_ROLES.includes(role)) {
        await client.query(
          `UPDATE members SET role = 'member', updated_at = NOW()
             WHERE welfare_id = $1 AND role = $2 AND status = 'active' AND id <> $3`,
          [req.welfare.id, role, member.id],
        );
      }
      const r = await client.query(`UPDATE members SET role = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [member.id, role]);
      return r.rows[0];
    });
    await logAudit({
      user: req.user, action: "member_role_changed", entityType: "member",
      entityId: member.id, entityCode: member.member_no,
      description: `Role of ${member.first_name} ${member.last_name} set to ${role}`, req,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    logger.error("welfare member role error:", e);
    res.status(500).json({ error: "Failed to update role" });
  }
});

// GET /:id/ledger
router.get("/:id/ledger", async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const r = await query(
      `SELECT * FROM member_pool_transactions WHERE member_id = $1 ORDER BY id DESC LIMIT 500`,
      [member.id],
    );
    res.json({ success: true, data: { savings_balance: await memberSavings(member.id), transactions: r.rows } });
  } catch (e) {
    logger.error("welfare member ledger error:", e);
    res.status(500).json({ error: "Failed to load ledger" });
  }
});

// POST /:id/contributions
router.post("/:id/contributions", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const amt = parseFloat(req.body?.amount);
    if (!(amt > 0)) return res.status(400).json({ error: "Amount must be positive" });
    const row = await postPool({
      welfare: req.welfare, memberId: member.id, type: "contribution",
      amount: amt, direction: 1, txnDate: req.body?.txn_date, description: req.body?.notes, userId: req.user.id,
    });
    await logAudit({
      user: req.user, action: "member_contribution", entityType: "member",
      entityId: member.id, entityCode: member.member_no,
      description: `Contribution KES ${amt} from ${member.first_name} ${member.last_name}`, req,
    });
    res.status(201).json({ success: true, data: row, pool_balance: Number(row.balance_after), savings_balance: await memberSavings(member.id) });
  } catch (e) {
    logger.error("member contribution error:", e);
    res.status(500).json({ error: "Failed to record contribution" });
  }
});

// POST /:id/withdrawals
router.post("/:id/withdrawals", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const amt = parseFloat(req.body?.amount);
    const { poolTxn, savingsAfter } = await recordWithdrawal({
      welfare: req.welfare, member, amount: amt,
      txnDate: req.body?.txn_date, description: req.body?.notes, userId: req.user.id,
    });
    await logAudit({
      user: req.user, action: "member_withdrawal", entityType: "member",
      entityId: member.id, entityCode: member.member_no,
      description: `Withdrawal KES ${amt} to ${member.first_name} ${member.last_name}`, req,
    });
    notifyWithdrawal({ welfare: req.welfare, member, amount: amt, savings: savingsAfter, sentBy: req.user.id });
    res.status(201).json({ success: true, data: poolTxn, pool_balance: Number(poolTxn.balance_after), savings_balance: savingsAfter });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member withdrawal error:", e);
    res.status(500).json({ error: "Failed to record withdrawal" });
  }
});

// POST /:id/exit — close a membership: settle-check, pay out net savings, deactivate.
// Outstanding loans and unpaid penalties must be cleared first (via their own
// endpoints) so the books stay clean.
router.post("/:id/exit", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (member.status === "inactive") return res.status(400).json({ error: "Member has already exited" });

    // Blockers: an outstanding loan or unpaid penalties.
    const loanOut = await query(
      `SELECT COALESCE(SUM(total_amount_due - amount_paid),0) AS bal
         FROM member_loans WHERE member_id = $1 AND status IN ('active','defaulted')`,
      [member.id],
    );
    if (parseFloat(loanOut.rows[0].bal) > 0) {
      return res.status(400).json({ error: `Member still owes KES ${parseFloat(loanOut.rows[0].bal).toLocaleString()} on a loan. Clear it before exit.` });
    }
    const penOut = await query(
      `SELECT COALESCE(SUM(amount - paid_amount),0) AS bal
         FROM penalty_assessments WHERE member_id = $1 AND status = 'outstanding'`,
      [member.id],
    );
    if (parseFloat(penOut.rows[0].bal) > 0) {
      return res.status(400).json({ error: `Member has KES ${parseFloat(penOut.rows[0].bal).toLocaleString()} in unpaid penalties. Settle or waive them before exit.` });
    }

    const savings = await memberSavings(member.id);
    let row = null;
    if (savings > 0) {
      const pool = await poolBalance(req.welfare.id);
      if (savings > pool) {
        return res.status(400).json({ error: `Pool only holds KES ${pool.toLocaleString()} — can't pay out KES ${savings.toLocaleString()}.` });
      }
      row = await postPool({
        welfare: req.welfare, memberId: member.id, type: "withdrawal",
        amount: savings, direction: -1, description: "Exit payout (full savings)", userId: req.user.id,
      });
    }
    const upd = await query(`UPDATE members SET status='inactive', updated_at=NOW() WHERE id=$1 RETURNING *`, [member.id]);
    await logAudit({
      user: req.user, action: "member_exit", entityType: "member",
      entityId: member.id, entityCode: member.member_no,
      description: `Member ${member.first_name} ${member.last_name} exited welfare "${req.welfare.name}"; paid out KES ${savings}`, req,
    });
    notifyWithdrawal({ welfare: req.welfare, member, amount: savings, exited: true, sentBy: req.user.id });
    res.json({ success: true, data: upd.rows[0], payout: round2(savings), pool_balance: row ? Number(row.balance_after) : await poolBalance(req.welfare.id) });
  } catch (e) {
    logger.error("member exit error:", e);
    res.status(500).json({ error: "Failed to process exit" });
  }
});

// ---------------- MEMBER LOANS (funded by the welfare pool) ----------------

async function loadMemberLoan(memberId, loanId) {
  const r = await query(`SELECT * FROM member_loans WHERE id = $1 AND member_id = $2`, [loanId, memberId]);
  return r.rows[0] || null;
}

// GET /:id/loans
router.get("/:id/loans", async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
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

// POST /:id/loans — issue a loan from the welfare pool.
router.post("/:id/loans", authorize("admin", "manager", "loan_officer"), gateLoanWrites, async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (member.status !== "active") return res.status(400).json({ error: "Member is not active" });
    const principal = parseFloat(req.body?.principal);
    if (!(principal > 0)) return res.status(400).json({ error: "Principal must be positive" });
    const months = parseInt(req.body?.duration_months, 10) || 1;
    if (months < 1) return res.status(400).json({ error: "Duration must be at least 1 month" });
    const rate = req.body?.interest_rate != null && req.body.interest_rate !== "" ? parseFloat(req.body.interest_rate) : 0;
    if (rate < 0) return res.status(400).json({ error: "Interest rate can't be negative" });

    const { loan, poolTxn } = await issueMemberLoan({
      welfare: req.welfare, member, principal, rate, months,
      notes: req.body?.notes, userId: req.user.id,
    });
    const loanCode = loan.loan_code;

    await logAudit({
      user: req.user, action: "member_loan_disbursed", entityType: "member_loan",
      entityId: loan.id, entityCode: loanCode,
      description: `Member loan ${loanCode}: KES ${principal} to ${member.first_name} ${member.last_name} from welfare "${req.welfare.name}" pool`, req,
    });
    res.status(201).json({ success: true, data: loan, pool_balance: Number(poolTxn.balance_after) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member loan issue error:", e);
    res.status(500).json({ error: "Failed to issue member loan" });
  }
});

// POST /:id/loans/:loanId/payments — repay into the welfare pool.
router.post("/:id/loans/:loanId/payments", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const loan = await loadMemberLoan(member.id, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Member loan not found" });

    const amt = req.body?.amount != null && req.body.amount !== "" ? parseFloat(req.body.amount) : round2(parseFloat(loan.total_amount_due) - parseFloat(loan.amount_paid));
    // Single allocation path: penalty → interest → principal, posting to the
    // pool (principal restores it, interest + penalty are profit).
    const r = await recordMemberLoanPayment({ welfare: req.welfare, loan, amount: amt, paymentDate: req.body?.txn_date, method: "manual", userId: req.user.id });

    await logAudit({
      user: req.user, action: "member_loan_repayment", entityType: "member_loan",
      entityId: loan.id, entityCode: loan.loan_code,
      description: `Repayment KES ${amt} on ${loan.loan_code}${r.completed ? " (cleared)" : ""}`, req,
    });
    res.json({ success: true, completed: r.completed, pool_balance: r.pool_balance, outstanding: round2(parseFloat(r.loan.total_amount_due) - parseFloat(r.loan.amount_paid)), allocation: r.allocation });
  } catch (e) {
    logger.error("member loan payment error:", e);
    res.status(500).json({ error: "Failed to record repayment" });
  }
});

// POST /:id/loans/:loanId/default
router.post("/:id/loans/:loanId/default", authorize("admin", "manager"), async (req, res) => {
  try {
    const member = await loadMember(req.welfare.id, req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });
    const loan = await loadMemberLoan(member.id, req.params.loanId);
    if (!loan) return res.status(404).json({ error: "Member loan not found" });
    if (loan.status !== "active") return res.status(400).json({ error: `Can't default a ${loan.status} loan` });
    await query(`UPDATE member_loans SET status='defaulted', updated_at=NOW() WHERE id=$1`, [loan.id]);
    await logAudit({
      user: req.user, action: "member_loan_defaulted", entityType: "member_loan",
      entityId: loan.id, entityCode: loan.loan_code,
      description: `Member loan ${loan.loan_code} marked defaulted`, req,
    });
    res.json({ success: true });
  } catch (e) {
    logger.error("member loan default error:", e);
    res.status(500).json({ error: "Failed to default loan" });
  }
});

export default router;
