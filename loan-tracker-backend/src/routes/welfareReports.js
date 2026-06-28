// Welfare dashboard + reports. Mounted at /api/welfares/:welfareId. Read-only
// aggregation across the pool, contributions, penalties, loans, dividends,
// attendance and SMS — the group's at-a-glance health, plus a per-member
// statement table (which the export in Part 9 builds on).
import express from "express";
import { query } from "../config/database.js";
import { verifyToken } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { buildWelfareStatementPdf, buildMemberStatementPdf } from "../utils/welfarePdf.js";
import { benefitPoolBalance } from "../services/welfareBenefitPoolService.js";
import { computeWelfareBooks } from "../services/welfareBooksService.js";
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

// GET /reports/books — the welfare's Books of Accounts (derived statements).
router.get("/reports/books", async (req, res) => {
  try {
    res.json({ success: true, data: await computeWelfareBooks(req.welfare.id, { year: req.query.year }) });
  } catch (e) {
    logger.error("welfare books error:", e);
    res.status(500).json({ error: "Failed to build books of accounts" });
  }
});

// Assemble the dashboard summary for a welfare (shared by JSON + PDF export).
export async function buildSummary(welfare) {
    const wid = welfare.id;
    const tid = welfare.tenant_id;

    const pool = (await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1`, [wid])).rows[0];
    const poolBalance = pool ? num(pool.balance_after) : 0;

    const ledger = (await query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='contribution'),0) AS contributions,
         COALESCE(SUM(amount) FILTER (WHERE type='withdrawal'),0)   AS withdrawals,
         COALESCE(SUM(amount) FILTER (WHERE type='dividend'),0)     AS dividends,
         COALESCE(SUM(amount) FILTER (WHERE type='expense'),0)      AS expenses,
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

    // Outstanding penalties split by the pool/source they belong to, so each
    // pool page can show its own penalties tile.
    const penByPool = (await query(
      `SELECT
         COALESCE(SUM(pa.amount-pa.paid_amount) FILTER (WHERE pa.status='outstanding' AND cc.pool_key='savings'),0)      AS savings,
         COALESCE(SUM(pa.amount-pa.paid_amount) FILTER (WHERE pa.status='outstanding' AND cc.pool_key='oneoff'),0)       AS emergencies,
         COALESCE(SUM(pa.amount-pa.paid_amount) FILTER (WHERE pa.status='outstanding' AND cc.pool_key LIKE 'plan-%'),0)  AS events,
         COALESCE(SUM(pa.amount-pa.paid_amount) FILTER (WHERE pa.status='outstanding' AND pa.trigger LIKE 'attendance%'),0) AS meetings,
         COALESCE(SUM(pa.paid_amount) FILTER (WHERE cc.pool_key='oneoff'),0)      AS emergencies_collected,
         COALESCE(SUM(pa.paid_amount) FILTER (WHERE cc.pool_key LIKE 'plan-%'),0) AS events_collected
       FROM penalty_assessments pa
       LEFT JOIN contribution_schedules cs ON pa.source_type='contribution_schedule' AND cs.id=pa.source_id
       LEFT JOIN contribution_cycles cc ON cc.id=cs.cycle_id
      WHERE pa.${memberFilter}`,
      [wid],
    )).rows[0];

    // Split the outstanding into principal vs interest. Member-loan repayments
    // clear interest before principal, so interest_outstanding = the unpaid
    // interest, and principal_outstanding is whatever's left of the balance.
    const loans = (await query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('active','defaulted'))::int AS open_count,
              COALESCE(SUM(principal),0) AS disbursed,
              COALESCE(SUM(amount_paid),0) AS repaid,
              COALESCE(SUM(total_amount_due-amount_paid) FILTER (WHERE status IN ('active','defaulted')),0) AS outstanding,
              COALESCE(SUM(GREATEST(total_interest-amount_paid,0)) FILTER (WHERE status IN ('active','defaulted')),0) AS interest_outstanding,
              COALESCE(SUM((total_amount_due-amount_paid) - GREATEST(total_interest-amount_paid,0)) FILTER (WHERE status IN ('active','defaulted')),0) AS principal_outstanding
         FROM member_loans WHERE ${memberFilter}`,
      [wid],
    )).rows[0];

    const dividends = (await query(`SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*)::int AS runs FROM dividend_distributions WHERE welfare_id=$1`, [wid])).rows[0];

    // Benefit pools: recurring plan pools ('plan-*') = Events; the shared
    // 'oneoff' pool = Emergencies. Balance = net of contributions − payouts.
    const benefitPools = (await query(
      `SELECT COALESCE(SUM(direction*amount) FILTER (WHERE pool_key LIKE 'plan-%'),0) AS events,
              COALESCE(SUM(direction*amount) FILTER (WHERE pool_key = 'oneoff'),0)   AS emergencies,
              COUNT(*)::int AS rows
         FROM benefit_pool_ledger WHERE welfare_id=$1`, [wid])).rows[0];

    // Investments (e.g. MMF): income = total interest earned (independent of
    // withdrawals — a withdrawal isn't a loss).
    const investments = (await query(
      `SELECT COALESCE(SUM(amount_invested),0) AS invested, COALESCE(SUM(current_balance),0) AS current,
              COALESCE(SUM(interest_earned),0) AS income, COALESCE(SUM(withdrawn),0) AS withdrawn, COUNT(*)::int AS count
         FROM welfare_investments WHERE welfare_id=$1`, [wid])).rows[0];

    // Latest open MONTHLY cycle's contribution compliance.
    const cycle = (await query(
      `SELECT c.id, c.name, c.due_date,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id)::int AS total,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='paid')::int AS paid,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='partial')::int AS partial,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status IN ('pending','overdue'))::int AS unpaid
         FROM contribution_cycles c
         JOIN contribution_plans p ON p.id=c.plan_id
        WHERE c.welfare_id=$1 AND c.status='open' AND p.frequency='monthly'
        ORDER BY c.due_date DESC, c.id DESC LIMIT 1`,
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

    return {
      welfare: { id: wid, name: welfare.name },
      pool: {
        balance: poolBalance,
        total_contributions: num(ledger.contributions),
        total_withdrawals: num(ledger.withdrawals),
        total_dividends: num(ledger.dividends),
        members_savings: num(ledger.savings),
        surplus: Math.round((poolBalance - num(ledger.savings)) * 100) / 100,
        profit: Math.round((poolBalance - num(ledger.savings)) * 100) / 100,
        expenses: num(ledger.expenses),
      },
      members: { active: members.active, inactive: members.inactive },
      penalties: { assessed: num(penalties.assessed), outstanding: num(penalties.outstanding), collected: num(penalties.collected),
        collected_benefit: num(penByPool.events_collected) + num(penByPool.emergencies_collected),
        by_pool: { savings: num(penByPool.savings), events: num(penByPool.events), emergencies: num(penByPool.emergencies), meetings: num(penByPool.meetings) } },
      loans: { open: loans.open_count, disbursed: num(loans.disbursed), repaid: num(loans.repaid), outstanding: num(loans.outstanding), principal_outstanding: num(loans.principal_outstanding), interest_outstanding: num(loans.interest_outstanding) },
      dividends: { total: num(dividends.total), runs: dividends.runs },
      benefit_pools: { events: num(benefitPools.events), emergencies: num(benefitPools.emergencies), active: benefitPools.rows > 0 },
      investments: { invested: num(investments.invested), current: num(investments.current), income: num(investments.income), withdrawn: num(investments.withdrawn), count: investments.count },
      compliance,
      attendance,
      sms_sent: sms.n,
    };
}

// Per-member statement rows (shared by JSON + CSV/PDF export).
export async function buildMemberRows(welfare, includeInactive) {
  return (await query(
    `SELECT m.id, m.member_no, m.first_name, m.last_name, m.phone_number, m.status, m.role,
            m.contribution_exempt, m.exempt_reason,
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
    [welfare.id],
  )).rows.map((m) => ({
    member_id: m.id, member_no: m.member_no, name: `${m.first_name} ${m.last_name}`,
    phone: m.phone_number, status: m.status, role: m.role || "member",
    contribution_exempt: m.contribution_exempt, exempt_reason: m.exempt_reason,
    savings: num(m.savings), contributions: num(m.contributions), dividends: num(m.dividends),
    loan_outstanding: num(m.loan_outstanding), penalty_outstanding: num(m.penalty_outstanding),
    meetings_attended: m.meetings_attended, meetings_recorded: m.meetings_recorded,
    attendance_pct: m.meetings_recorded > 0 ? Math.round((m.meetings_attended / m.meetings_recorded) * 100) : null,
  }));
}

// GET /reports/summary — the welfare dashboard.
router.get("/reports/summary", async (req, res) => {
  try {
    res.json({ success: true, data: await buildSummary(req.welfare) });
  } catch (e) {
    logger.error("welfare summary error:", e);
    res.status(500).json({ error: "Failed to build summary" });
  }
});

// GET /reports/charts?year=YYYY — time series + breakdowns for the dashboard charts.
export async function buildCharts(welfare, year) {
  const wid = welfare.id;
  const memberFilter = `member_id IN (SELECT id FROM members WHERE welfare_id=$1)`;

  // Savings-pool balance at the end of each month (cumulative by txn DATE, so it's
  // correct even when rows were backfilled out of insertion order).
  const poolGrowth = (await query(
    `SELECT to_char(m,'YYYY-MM') AS label,
            (SELECT COALESCE(SUM(direction*amount),0) FROM member_pool_transactions
              WHERE welfare_id=$1 AND txn_date < (m + interval '1 month')) AS balance
       FROM generate_series(
              date_trunc('month', COALESCE((SELECT MIN(txn_date) FROM member_pool_transactions WHERE welfare_id=$1), CURRENT_DATE)),
              date_trunc('month', CURRENT_DATE), interval '1 month') m
      ORDER BY m`,
    [wid],
  )).rows.map((r) => ({ label: r.label, balance: num(r.balance) }));

  const memberCount = (await query(`SELECT COUNT(*)::int n FROM members WHERE welfare_id=$1 AND status='active'`, [wid])).rows[0].n;

  // Monthly contributions (the savings plan) — collected vs expected per month,
  // plus contribution-late fines assessed that month (a 3rd bar).
  const monthRows = (await query(
    `SELECT EXTRACT(MONTH FROM c.due_date)::int AS mo, to_char(c.due_date,'Mon') AS label,
            COALESCE(SUM(s.amount_due),0) AS expected, COALESCE(SUM(s.amount_paid),0) AS collected
       FROM contribution_cycles c
       JOIN contribution_plans p ON p.id=c.plan_id
       JOIN contribution_schedules s ON s.cycle_id=c.id
      WHERE c.welfare_id=$1 AND p.frequency='monthly' AND EXTRACT(YEAR FROM c.due_date)=$2
      GROUP BY 1,2 ORDER BY 1`,
    [wid, year],
  )).rows;
  const fineByMonth = {};
  (await query(
    `SELECT EXTRACT(MONTH FROM assessed_at)::int AS mo, COALESCE(SUM(amount),0) AS fines
       FROM penalty_assessments WHERE ${memberFilter} AND trigger='contribution_late' AND EXTRACT(YEAR FROM assessed_at)=$2
      GROUP BY 1`, [wid, year],
  )).rows.forEach((r) => { fineByMonth[r.mo] = num(r.fines); });
  const contributions = monthRows.map((r) => ({ label: r.label, expected: num(r.expected), collected: num(r.collected), fines: fineByMonth[r.mo] || 0 }));

  // Quarterly contributions — ALWAYS the 4 quarters; unopened ones are projected
  // (expected = plan amount × active members, collected 0).
  const qPlan = (await query(`SELECT amount FROM contribution_plans WHERE welfare_id=$1 AND frequency='quarterly' AND active=true ORDER BY id LIMIT 1`, [wid])).rows[0];
  const qActual = {};
  (await query(
    `SELECT EXTRACT(QUARTER FROM c.due_date)::int AS q,
            COALESCE(SUM(s.amount_due),0) AS expected, COALESCE(SUM(s.amount_paid),0) AS collected
       FROM contribution_cycles c JOIN contribution_plans p ON p.id=c.plan_id JOIN contribution_schedules s ON s.cycle_id=c.id
      WHERE c.welfare_id=$1 AND p.frequency='quarterly' AND EXTRACT(YEAR FROM c.due_date)=$2 GROUP BY 1`,
    [wid, year],
  )).rows.forEach((r) => { qActual[r.q] = { expected: num(r.expected), collected: num(r.collected) }; });
  const projected = qPlan ? num(qPlan.amount) * memberCount : 0;
  const quarterly = [1, 2, 3, 4].map((q) => ({
    label: `Q${q}`,
    expected: qActual[q]?.expected ?? projected,
    collected: qActual[q]?.collected ?? 0,
  }));

  // Attendance rate per HELD meeting, split into normal meetings vs event
  // meetings (an event meeting handed out a benefit-pool payout). The chart
  // plots two series so turnout for regular meetings and events can be compared.
  const attendance = (await query(
    `SELECT gm.meeting_date::date AS date, gm.title,
            EXISTS(SELECT 1 FROM benefit_pool_ledger l WHERE l.meeting_id=gm.id AND l.type='payout') AS is_event,
            (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=gm.id AND a.status IN ('present','late'))::int AS attended,
            (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id=gm.id)::int AS recorded
       FROM group_meetings gm WHERE gm.group_id=$1 AND gm.status='held' ORDER BY gm.meeting_date ASC, gm.id ASC`,
    [wid],
  )).rows.map((r) => {
    const rate = r.recorded > 0 ? Math.round((r.attended / r.recorded) * 100) : 0;
    return {
      label: new Date(r.date).toISOString().slice(0, 10),
      title: r.title,
      kind: r.is_event ? "event" : "meeting",
      attended: r.attended,
      recorded: r.recorded,
      // Separate series so each renders as its own line (null = no point).
      meetingRate: r.is_event ? null : rate,
      eventRate: r.is_event ? rate : null,
    };
  });

  // Fines by activity type — accrued vs collected per penalty trigger.
  const FINE_LABELS = { contribution_late: "Contribution late", loan_late: "Loan late", attendance_late: "Attendance late", attendance_absent: "Attendance absent", meeting_missed: "Meeting missed", manual: "Manual" };
  const fines = (await query(
    `SELECT trigger, COALESCE(SUM(amount),0) AS accrued, COALESCE(SUM(paid_amount),0) AS collected
       FROM penalty_assessments WHERE ${memberFilter}
      GROUP BY trigger ORDER BY accrued DESC`,
    [wid],
  )).rows.map((r) => ({ type: r.trigger, label: FINE_LABELS[r.trigger] || r.trigger, accrued: num(r.accrued), collected: num(r.collected) }));

  // Balance of every pool — savings + each benefit pool (quarterly, emergencies).
  const savingsBal = (await query(`SELECT balance_after FROM member_pool_transactions WHERE welfare_id=$1 ORDER BY id DESC LIMIT 1`, [wid])).rows[0];
  const pools = [{ name: "Savings", balance: savingsBal ? num(savingsBal.balance_after) : 0, kind: "savings" }];
  for (const p of (await query(`SELECT id, name FROM contribution_plans WHERE welfare_id=$1 AND pool_kind='benefit' AND active=true ORDER BY id`, [wid])).rows) {
    pools.push({ name: p.name, balance: await benefitPoolBalance(wid, `plan-${p.id}`), kind: "benefit" });
  }
  if ((await query(`SELECT 1 FROM benefit_pool_ledger WHERE welfare_id=$1 AND pool_key='oneoff' LIMIT 1`, [wid])).rows.length) {
    pools.push({ name: "Emergencies", balance: await benefitPoolBalance(wid, "oneoff"), kind: "benefit" });
  }

  return { year, pool_growth: poolGrowth, contributions, quarterly, attendance, fines, pools };
}

router.get("/reports/charts", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json({ success: true, data: await buildCharts(req.welfare, year) });
  } catch (e) {
    logger.error("welfare charts error:", e);
    res.status(500).json({ error: "Failed to build charts" });
  }
});

// GET /reports/members — per-member statement rows. ?include=all adds inactive.
router.get("/reports/members", async (req, res) => {
  try {
    res.json({ success: true, data: await buildMemberRows(req.welfare, req.query.include === "all") });
  } catch (e) {
    logger.error("welfare member report error:", e);
    res.status(500).json({ error: "Failed to build member report" });
  }
});

// ---- Exports (CSV / PDF) ----

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /reports/members.csv — the per-member table as CSV.
router.get("/reports/members.csv", async (req, res) => {
  try {
    const rows = await buildMemberRows(req.welfare, req.query.include === "all");
    const headers = ["Member No", "Name", "Phone", "Status", "Savings", "Contributions", "Dividends", "Loan outstanding", "Penalty outstanding", "Attendance %"];
    const lines = [headers.join(",")];
    for (const m of rows) {
      lines.push([m.member_no, m.name, m.phone || "", m.status, m.savings, m.contributions, m.dividends, m.loan_outstanding, m.penalty_outstanding, m.attendance_pct ?? ""].map(csvCell).join(","));
    }
    const filename = `${req.welfare.name.replace(/[^a-z0-9]+/gi, "_")}_members_${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  } catch (e) {
    logger.error("welfare members csv error:", e);
    res.status(500).json({ error: "Failed to export CSV" });
  }
});

// GET /reports/statement.pdf — the group statement (summary + member table).
router.get("/reports/statement.pdf", async (req, res) => {
  try {
    const [summary, members] = await Promise.all([buildSummary(req.welfare), buildMemberRows(req.welfare, req.query.include === "all")]);
    const { buffer, filename } = await buildWelfareStatementPdf(req.welfare, summary, members);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    logger.error("welfare statement pdf error:", e);
    res.status(500).json({ error: "Failed to build statement" });
  }
});

// GET /reports/members/:id/statement.pdf — one member's statement (balances + ledger).
router.get("/reports/members/:id/statement.pdf", async (req, res) => {
  try {
    const member = (await query(`SELECT * FROM members WHERE id=$1 AND welfare_id=$2`, [req.params.id, req.welfare.id])).rows[0];
    if (!member) return res.status(404).json({ error: "Member not found" });
    const rows = await buildMemberRows(req.welfare, true);
    const b = rows.find((r) => r.member_id === member.id) || { savings: 0, loan_outstanding: 0, penalty_outstanding: 0, dividends: 0 };
    const ledger = (await query(`SELECT type, amount, direction, balance_after, txn_date FROM member_pool_transactions WHERE member_id=$1 ORDER BY id ASC`, [member.id])).rows;
    const { buffer, filename } = await buildMemberStatementPdf(req.welfare, member, b, ledger);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    logger.error("member statement pdf error:", e);
    res.status(500).json({ error: "Failed to build member statement" });
  }
});

export default router;
