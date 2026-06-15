// Welfare dashboard + reports. Mounted at /api/welfares/:welfareId. Read-only
// aggregation across the pool, contributions, penalties, loans, dividends,
// attendance and SMS — the group's at-a-glance health, plus a per-member
// statement table (which the export in Part 9 builds on).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);
const num = (v) => Number(v || 0);
const SAVINGS_TYPES = "('contribution','withdrawal','adjustment')";

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (reports) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /reports/summary — the welfare dashboard.
router.get("/reports/summary", async (req, res) => {
  try {
    const wid = req.welfare.id;
    const tid = req.welfare.tenant_id;

    const pool = (await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1`, [wid])).rows[0];
    const poolBalance = pool ? num(pool.balance_after) : 0;

    const ledger = (await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS contributions,
         COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS withdrawals,
         COALESCE(SUM(amount) FILTER (WHERE type='dividend'),0)     AS dividends,
         COALESCE(SUM(direction*amount) FILTER (WHERE type IN ${SAVINGS_TYPES}),0) AS savings
       FROM member_pool_transactions WHERE welfare_id=$1`,
      [wid],
    )).rows[0];

    const members = (await query(
      `SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
              COUNT(*) FILTER (WHERE status='inactive')::int AS inactive
         FROM members WHERE welfare_id=$1`,
      [wid],
    )).rows[0];

    const memberFilter = `member_id IN (SELECT id FROM members WHERE welfare_id=$1)`;
    const penalties = (await query(
      `SELECT COALESCE(SUM(amount),0) AS assessed,
              COALESCE(SUM(amount-paid_amount) FILTER (WHERE status='outstanding'),0) AS outstanding,
              COALESCE(SUM(paid_amount),0) AS collected
         FROM penalty_assessments WHERE ${memberFilter}`,
      [wid],
    )).rows[0];

    const loans = (await query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('active','defaulted'))::int AS open_count,
              COALESCE(SUM(principal),0) AS disbursed,
              COALESCE(SUM(amount_paid),0) AS repaid,
              COALESCE(SUM(total_amount_due-amount_paid) FILTER (WHERE status IN ('active','defaulted')),0) AS outstanding
         FROM member_loans WHERE ${memberFilter}`,
      [wid],
    )).rows[0];

    const dividends = (await query(`SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*)::int AS runs FROM dividend_distributions WHERE welfare_id=$1`, [wid])).rows[0];

    // Latest open cycle's contribution compliance.
    const cycle = (await query(
      `SELECT c.id, c.name, c.due_date,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id)::int AS total,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='paid')::int AS paid,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='partial')::int AS partial,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status IN ('pending','overdue'))::int AS unpaid
         FROM contribution_cycles c
        WHERE c.welfare_id=$1 AND c.status='open'
        ORDER BY c.id DESC LIMIT 1`,
      [wid],
    )).rows[0] || null;
    const compliance = cycle && cycle.total > 0
      ? { cycle: cycle.name, due_date: cycle.due_date, total: cycle.total, paid: cycle.paid, partial: cycle.partial, unpaid: cycle.unpaid, paid_pct: Math.round((cycle.paid / cycle.total) * 100) }
      : null;

    // Last meeting's attendance.
    const meeting = (await query(
      `SELECT gm.id, gm.meeting_date,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=gm.id AND a.status IN ('present','late'))::int AS attended,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=gm.id)::int AS recorded
         FROM group_meetings gm WHERE gm.group_id=$1 ORDER BY gm.meeting_date DESC, gm.id DESC LIMIT 1`,
      [wid],
    )).rows[0] || null;
    const attendance = meeting && meeting.recorded > 0
      ? { meeting_date: meeting.meeting_date, attended: meeting.attended, recorded: meeting.recorded, rate_pct: Math.round((meeting.attended / meeting.recorded) * 100) }
      : null;

    const sms = (await query(`SELECT COUNT(*)::int AS n FROM sms_logs WHERE tenant_id=$1 AND message_type LIKE 'welfare_%'`, [tid])).rows[0];

    res.json({
      success: true,
      data: {
        welfare: { id: wid, name: req.welfare.name },
        pool: {
          balance: poolBalance,
          total_contributions: num(ledger.contributions),
          total_withdrawals: num(ledger.withdrawals),
          total_dividends: num(ledger.dividends),
          members_savings: num(ledger.savings),
          surplus: Math.round((poolBalance - num(ledger.savings)) * 100) / 100,
        },
        members: { active: members.active, inactive: members.inactive },
        penalties: { assessed: num(penalties.assessed), outstanding: num(penalties.outstanding), collected: num(penalties.collected) },
        loans: { open: loans.open_count, disbursed: num(loans.disbursed), repaid: num(loans.repaid), outstanding: num(loans.outstanding) },
        dividends: { total: num(dividends.total), runs: dividends.runs },
        compliance,
        attendance,
        sms_sent: sms.n,
      },
    });
  } catch (e) {
    logger.error("welfare summary error:", e);
    res.status(500).json({ error: "Failed to build summary" });
  }
});

// GET /reports/members — per-member statement rows. ?include=all adds inactive.
router.get("/reports/members", async (req, res) => {
  try {
    const wid = req.welfare.id;
    const includeInactive = req.query.include === "all";
    const rows = (await query(
      `SELECT m.id, m.member_no, m.first_name, m.last_name, m.phone_number, m.status,
              COALESCE((SELECT SUM(direction*amount) FROM member_pool_transactions p WHERE p.member_id=m.id AND p.type IN ${SAVINGS_TYPES}),0) AS savings,
              COALESCE((SELECT SUM(amount) FROM member_pool_transactions p WHERE p.member_id=m.id AND p.type='contribution'),0) AS contributions,
              COALESCE((SELECT SUM(amount) FROM member_pool_transactions p WHERE p.member_id=m.id AND p.type='dividend'),0) AS dividends,
              COALESCE((SELECT SUM(total_amount_due-amount_paid) FROM member_loans l WHERE l.member_id=m.id AND l.status IN ('active','defaulted')),0) AS loan_outstanding,
              COALESCE((SELECT SUM(amount-paid_amount) FROM penalty_assessments pa WHERE pa.member_id=m.id AND pa.status='outstanding'),0) AS penalty_outstanding,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.member_id=m.id AND a.status IN ('present','late'))::int AS meetings_attended,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.member_id=m.id)::int AS meetings_recorded
         FROM members m
        WHERE m.welfare_id=$1 ${includeInactive ? "" : "AND m.status='active'"}
        ORDER BY m.member_no`,
      [wid],
    )).rows.map((m) => ({
      member_id: m.id, member_no: m.member_no, name: `${m.first_name} ${m.last_name}`,
      phone: m.phone_number, status: m.status,
      savings: num(m.savings), contributions: num(m.contributions), dividends: num(m.dividends),
      loan_outstanding: num(m.loan_outstanding), penalty_outstanding: num(m.penalty_outstanding),
      meetings_attended: m.meetings_attended, meetings_recorded: m.meetings_recorded,
      attendance_pct: m.meetings_recorded > 0 ? Math.round((m.meetings_attended / m.meetings_recorded) * 100) : null,
    }));
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("welfare member report error:", e);
    res.status(500).json({ error: "Failed to build member report" });
  }
});

export default router;
