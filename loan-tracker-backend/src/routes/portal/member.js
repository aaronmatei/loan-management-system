// Welfare/chama MEMBER self-service portal. A platform_customer who is linked to
// a welfare tenant (customer_tenant_links.member_id) sees their own savings,
// contributions, chama loans, dividends, meetings and penalties here. Mounted at
// /api/welfare/member, gated by verifyCustomer + resolveMember. Read-only in this
// phase; pay actions (Phase C) and requests (Phase D) build on the same resolver.
import express from "express";
import { query } from "../../config/database.js";
import { verifyCustomer } from "../../middleware/customerAuth.js";
import { poolBalance, memberSavings, round2, SAVINGS_TYPES } from "../../services/welfarePoolService.js";
import { initiateWelfareSTK } from "../../services/welfareMpesaService.js";
import { buildMemberStatementPdf } from "../../utils/welfarePdf.js";
import { buildSummary, buildCharts, buildMemberRows } from "../welfareReports.js";
import { computeWelfareBooks } from "../../services/welfareBooksService.js";
import { loadContributionsView, loadPlanOverview, loadCycleDetail } from "../welfareContributions.js";
import { gateLoanWrites } from "../../services/welfareLoanFlag.js";
import { VISIBILITIES, runDocUpload, storeDocFile, isCloudinaryConfigured, isOfficer, cleanCategory } from "../../services/welfareDocumentService.js";
import { loadAgenda, loadMinutes, nextPosition } from "../../services/meetingAgendaService.js";
import { VOTES, decorate, resolveIfDue, finalize, closeOutcome, resolveElectionTarget, electionTitle } from "../../services/welfareDecisionService.js";
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
    const [savings, pool, loans, penalties, nextDue, recent, attend, comply] = await Promise.all([
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
        `SELECT cs.amount_due, cs.amount_paid, cs.due_date, cs.status, cc.name AS cycle_name, cc.pool_key
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
      // Attendance % over recorded meetings; compliance % over the member's
      // monthly contribution schedules (paid vs expected).
      query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended, COUNT(*)::int AS recorded
           FROM member_attendance WHERE member_id = $1`,
        [m.id],
      ),
      query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE cs.status = 'paid')::int AS paid
           FROM contribution_schedules cs
           JOIN contribution_cycles cc ON cc.id = cs.cycle_id
           JOIN contribution_plans p ON p.id = cc.plan_id
          WHERE cs.member_id = $1 AND p.frequency = 'monthly'`,
        [m.id],
      ),
    ]);
    const at = attend.rows[0], co = comply.rows[0];
    const loansEnabled = (await query(`SELECT COALESCE(loans_enabled,false) AS le FROM welfare_settings WHERE tenant_id=$1`, [m.tenant_id])).rows[0]?.le || false;
    res.json({
      success: true,
      data: {
        member: {
          id: m.id, member_no: m.member_no, first_name: m.first_name, last_name: m.last_name,
          phone_number: m.phone_number, status: m.status, monthly_contribution: m.monthly_contribution,
          joined_at: m.joined_at, role: m.role || "member",
        },
        welfare: { id: req.welfareId, name: m.welfare_name, pool_balance: round2(pool), loans_enabled: loansEnabled },
        savings_balance: round2(savings),
        loans: { active: loans.rows[0].active_count, outstanding: round2(loans.rows[0].outstanding) },
        penalties_outstanding: round2(penalties.rows[0].outstanding),
        next_contribution: nextDue.rows[0] || null,
        recent_transactions: recent.rows,
        attendance_pct: at.recorded > 0 ? Math.round((at.attended / at.recorded) * 100) : null,
        attendance: { attended: at.attended, recorded: at.recorded },
        compliance_pct: co.total > 0 ? Math.round((co.paid / co.total) * 100) : null,
        compliance: { paid: co.paid, total: co.total },
      },
    });
  } catch (e) {
    logger.error("member overview error:", e);
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// GET /ledger — the member's COMPLETE activity statement. Unions every place a
// member's money/fines are recorded so nothing is missed:
//   • member_pool_transactions  — savings pool (contributions, withdrawals,
//                                  dividends, loans, penalty payments)
//   • benefit_pool_ledger       — benefit pools (quarterly / emergencies)
//   • welfare_event_ledger      — ad-hoc events
//   • penalty_assessments       — fines charged (the payment side already shows
//                                 as a 'penalty' pool row, so this adds the charge)
// No source overlaps for the same cash event (savings vs benefit vs event are
// mutually exclusive at posting time), so there's no double-counting.
const CASH_LABELS = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  dividend: "Dividend",
  adjustment: "Adjustment",
  loan_disbursed: "Loan disbursed",
  loan_repayment: "Loan repayment",
  loan_interest: "Loan interest",
  loan_penalty: "Loan penalty",
  payout: "Payout",
  bridge_in: "Bridge in",
  bridge_repay: "Bridge repayment",
};
const FINE_LABELS = {
  attendance_absent: "Fine — Absent from meeting",
  attendance_late: "Fine — Late to meeting",
  contribution_late: "Fine — Late contribution",
  event_late: "Fine — Late event contribution",
};
const titleize = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// From the MEMBER's perspective (not the pool's): "in" = money the member
// received, "out" = money the member paid. Pool `direction` is pool-centric
// (a contribution is +1 into the pool but the member PAID it), so map by type.
const MEMBER_IN = new Set(["withdrawal", "dividend", "loan_disbursed", "payout"]);
const MEMBER_OUT = new Set(["contribution", "loan_repayment", "loan_interest", "loan_penalty"]);
function memberFlow(type, direction) {
  if (type === "penalty") return direction < 0 ? "in" : "out"; // refund vs payment
  if (MEMBER_IN.has(type)) return "in";
  if (MEMBER_OUT.has(type)) return "out";
  if (type === "adjustment") return direction > 0 ? "in" : "out"; // credit vs debit
  return direction > 0 ? "out" : "in"; // fallback: pool +1 ⇒ member paid in
}

router.get("/ledger", async (req, res) => {
  try {
    const mid = req.member.id;
    const [savingsBal, savings, benefit, events, fines] = await Promise.all([
      memberSavings(mid),
      query(
        `SELECT id, type, amount, direction, txn_date, description
           FROM member_pool_transactions WHERE member_id = $1`,
        [mid],
      ),
      query(
        `SELECT id, type, amount, direction, txn_date, description, pool_key
           FROM benefit_pool_ledger WHERE member_id = $1`,
        [mid],
      ),
      query(
        `SELECT id, type, amount, direction, txn_date, description
           FROM welfare_event_ledger WHERE member_id = $1`,
        [mid],
      ),
      query(
        `SELECT id, trigger, amount, paid_amount, status, description, assessed_at
           FROM penalty_assessments WHERE member_id = $1`,
        [mid],
      ),
    ]);

    const rows = [];
    for (const t of savings.rows) {
      // A negative 'penalty' row is a reversal/refund of a fine.
      const label =
        t.type === "penalty"
          ? Number(t.direction) < 0 ? "Fine reversal (refund)" : "Penalty payment"
          : CASH_LABELS[t.type] || titleize(t.type);
      rows.push({ kind: "cash", source: "savings", category: label, description: t.description, amount: Number(t.amount), direction: Number(t.direction), flow: memberFlow(t.type, Number(t.direction)), date: t.txn_date, sort: `${t.txn_date} ${String(t.id).padStart(9, "0")}` });
    }
    for (const t of benefit.rows) {
      const label = `${CASH_LABELS[t.type] || titleize(t.type)} (benefit)`;
      rows.push({ kind: "cash", source: "benefit", category: label, description: t.description, amount: Number(t.amount), direction: Number(t.direction), flow: memberFlow(t.type, Number(t.direction)), date: t.txn_date, sort: `${t.txn_date} ${String(t.id).padStart(9, "0")}` });
    }
    for (const t of events.rows) {
      const label = `${CASH_LABELS[t.type] || titleize(t.type)} (event)`;
      rows.push({ kind: "cash", source: "event", category: label, description: t.description, amount: Number(t.amount), direction: Number(t.direction), flow: memberFlow(t.type, Number(t.direction)), date: t.txn_date, sort: `${t.txn_date} ${String(t.id).padStart(9, "0")}` });
    }
    for (const f of fines.rows) {
      if (f.status === "reversed") continue; // the refund already shows on the savings side
      rows.push({ kind: "fine", source: "fine", category: FINE_LABELS[f.trigger] || `Fine — ${titleize(f.trigger)}`, description: f.description, amount: Number(f.amount), paid: Number(f.paid_amount), status: f.status, date: f.assessed_at, sort: `${new Date(f.assessed_at).toISOString().slice(0, 10)} ${String(f.id).padStart(9, "0")}` });
    }
    // Newest first; stable within a day by source id.
    rows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));

    res.json({ success: true, data: { savings_balance: round2(savingsBal), transactions: rows.slice(0, 500) } });
  } catch (e) {
    logger.error("member ledger error:", e);
    res.status(500).json({ error: "Failed to load ledger" });
  }
});

// GET /dashboard — the SAME group dashboard the admin sees (read-only). A member
// is an equal owner of the chama, so they see the group's health, not just their
// own numbers. Reuses the admin aggregation so the figures match exactly.
router.get("/dashboard", async (req, res) => {
  try {
    const welfare = { id: req.welfareId, tenant_id: req.member.tenant_id, name: req.member.welfare_name };
    res.json({ success: true, data: await buildSummary(welfare) });
  } catch (e) {
    logger.error("member dashboard error:", e);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// Read-only Contributions & Events views — the SAME plan list, drill-in overview
// and per-cycle schedules the admin sees (members are equal owners). ensure:false
// so a member's read never auto-opens cycles.
// Sub-paths mirror the admin routes so the shared panel differs only by base.
const portalWelfare = (req) => ({ id: req.welfareId, tenant_id: req.member.tenant_id });
router.get("/contrib/contribution-plans", async (req, res) => {
  try { res.json({ success: true, data: await loadContributionsView(portalWelfare(req), { ensure: false }) }); }
  catch (e) { logger.error("member contrib plans error:", e); res.status(500).json({ error: "Failed to load contributions" }); }
});
router.get("/contrib/contribution-plans/:planId/overview", async (req, res) => {
  try {
    const data = await loadPlanOverview(portalWelfare(req), req.params.planId, parseInt(req.query.year, 10) || new Date().getFullYear(), { ensure: false });
    if (!data) return res.status(404).json({ error: "Contribution not found" });
    res.json({ success: true, data });
  } catch (e) { logger.error("member contrib overview error:", e); res.status(500).json({ error: "Failed to load overview" }); }
});
router.get("/contrib/cycles/:cycleId", async (req, res) => {
  try {
    const data = await loadCycleDetail(portalWelfare(req), req.params.cycleId);
    if (!data) return res.status(404).json({ error: "Cycle not found" });
    res.json({ success: true, data });
  } catch (e) { logger.error("member contrib cycle error:", e); res.status(500).json({ error: "Failed to load cycle" }); }
});

// GET /meetings/:meetingId — a meeting's attendance roster (all members,
// present/late/absent/excused + arrival), the same as the admin sees. Read-only.
router.get("/meetings/:meetingId", async (req, res) => {
  try {
    const m = (await query(`SELECT * FROM group_meetings WHERE id=$1 AND group_id=$2`, [req.params.meetingId, req.welfareId])).rows[0];
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const roster = (await query(
      `SELECT mem.id AS member_id, mem.first_name, mem.last_name, mem.member_no,
              a.status AS attendance_status, a.arrival_time, a.apology,
              c.attending AS confirmed
         FROM members mem
         LEFT JOIN member_attendance a ON a.meeting_id=$2 AND a.member_id=mem.id
         LEFT JOIN meeting_confirmations c ON c.meeting_id=$2 AND c.member_id=mem.id
        WHERE mem.welfare_id=$1 AND mem.status='active'
        ORDER BY mem.first_name`,
      [req.welfareId, m.id],
    )).rows;
    const agenda = await loadAgenda(m.id);
    const minutes = await loadMinutes(req.welfareId, m.id);
    res.json({ success: true, data: { meeting: m, roster, agenda, minutes, my_member_id: req.member.id, can_upload_minutes: req.member.role === "secretary" } });
  } catch (e) { logger.error("member meeting detail error:", e); res.status(500).json({ error: "Failed to load meeting" }); }
});

// POST /meetings/:meetingId/agenda — a member suggests an agenda item (appended).
router.post("/meetings/:meetingId/agenda", async (req, res) => {
  try {
    const m = (await query(`SELECT id FROM group_meetings WHERE id=$1 AND group_id=$2`, [req.params.meetingId, req.welfareId])).rows[0];
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    if (req.member.status !== "active") return res.status(400).json({ error: "Your membership is not active" });
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Agenda item can't be empty" });
    const r = await query(
      `INSERT INTO meeting_agenda_items (tenant_id, welfare_id, meeting_id, content, position, status, suggested_by_member, author_name)
       VALUES ($1,$2,$3,$4,$5,'suggested',$6,$7) RETURNING *`,
      [req.member.tenant_id, req.welfareId, m.id, content, await nextPosition(m.id), req.member.id, `${req.member.first_name} ${req.member.last_name}`.trim()],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { logger.error("member agenda add error:", e); res.status(500).json({ error: "Failed to add agenda item" }); }
});

// PUT/DELETE — a member may change ONLY their own suggestion (admin harmonizes the rest).
router.put("/meetings/:meetingId/agenda/:itemId", async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Agenda item can't be empty" });
    const r = await query(
      `UPDATE meeting_agenda_items SET content=$1, updated_at=NOW()
        WHERE id=$2 AND meeting_id=$3 AND suggested_by_member=$4 AND status='suggested' RETURNING *`,
      [content, req.params.itemId, req.params.meetingId, req.member.id],
    );
    if (!r.rows.length) return res.status(403).json({ error: "You can only edit your own pending suggestions" });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { logger.error("member agenda edit error:", e); res.status(500).json({ error: "Failed to update agenda item" }); }
});
router.delete("/meetings/:meetingId/agenda/:itemId", async (req, res) => {
  try {
    const r = await query(
      `DELETE FROM meeting_agenda_items WHERE id=$1 AND meeting_id=$2 AND suggested_by_member=$3 AND status='suggested' RETURNING id`,
      [req.params.itemId, req.params.meetingId, req.member.id],
    );
    if (!r.rows.length) return res.status(403).json({ error: "You can only remove your own pending suggestions" });
    res.json({ success: true });
  } catch (e) { logger.error("member agenda delete error:", e); res.status(500).json({ error: "Failed to delete agenda item" }); }
});

// GET /books — the welfare's Books of Accounts, same statements the admin sees
// (members are equal owners). Read-only.
router.get("/books", async (req, res) => {
  try {
    res.json({ success: true, data: await computeWelfareBooks(req.welfareId, { year: req.query.year }) });
  } catch (e) {
    logger.error("member books error:", e);
    res.status(500).json({ error: "Failed to load books of accounts" });
  }
});

// GET /group-members — every member's standing (savings, contributions,
// dividends, loan + penalty balances, attendance), as on the admin Reports page.
router.get("/group-members", async (req, res) => {
  try {
    const welfare = { id: req.welfareId, tenant_id: req.member.tenant_id, name: req.member.welfare_name };
    res.json({ success: true, data: await buildMemberRows(welfare, req.query.include === "all") });
  } catch (e) {
    logger.error("member group-members error:", e);
    res.status(500).json({ error: "Failed to load members" });
  }
});

// Read-only group activity so a member can see "what's happening" — every loan,
// expense and contribution cycle in the chama. Privileged writes stay admin-only.
// Loans are private — a member sees only their own (GET /loans); there is no
// group-wide loan list in the portal.

router.get("/group-expenses", async (req, res) => {
  try {
    const r = await query(
      `SELECT amount, txn_date, description FROM member_pool_transactions
        WHERE welfare_id = $1 AND type = 'expense' ORDER BY txn_date DESC, id DESC LIMIT 100`,
      [req.welfareId],
    );
    const total = (await query(`SELECT COALESCE(SUM(amount),0) t FROM member_pool_transactions WHERE welfare_id=$1 AND type='expense'`, [req.welfareId])).rows[0].t;
    res.json({ success: true, data: { expenses: r.rows, total: round2(total) } });
  } catch (e) { logger.error("member group-expenses error:", e); res.status(500).json({ error: "Failed to load expenses" }); }
});

// Documents — shared welfare files. Officers see officer-only docs too; every
// active member can upload (your choice). An uploader (or any officer) can
// delete what they posted.
router.get("/documents", async (req, res) => {
  try {
    const officer = isOfficer(req.member.role);
    const r = await query(
      `SELECT id, title, category, visibility, file_url, file_name, mime, size_bytes,
              uploaded_by_member, uploaded_by_name, created_at
         FROM welfare_documents
        WHERE welfare_id = $1 ${officer ? "" : "AND visibility = 'members'"}
        ORDER BY created_at DESC`,
      [req.welfareId],
    );
    res.json({ success: true, data: { documents: r.rows, is_officer: officer, my_member_id: req.member.id } });
  } catch (e) { logger.error("member documents list error:", e); res.status(500).json({ error: "Failed to load documents" }); }
});

router.post("/documents", runDocUpload, async (req, res) => {
  try {
    const category = cleanCategory(req.body?.category);
    const meetingId = req.body?.meeting_id ? parseInt(req.body.meeting_id, 10) : null;
    // Minutes are the secretary's responsibility — only they upload them.
    if (category === "minutes" && req.member.role !== "secretary") {
      return res.status(403).json({ error: "Only the secretary can upload meeting minutes." });
    }
    if (!isCloudinaryConfigured()) return res.status(503).json({ error: "File storage is not configured yet." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required" });
    // Only officers may post officer-only documents; members always share with the group.
    const visibility = isOfficer(req.member.role) && VISIBILITIES.includes(req.body?.visibility) ? req.body.visibility : "members";
    const url = await storeDocFile(req.file, req.welfareId);
    const r = await query(
      `INSERT INTO welfare_documents
         (tenant_id, welfare_id, title, category, visibility, file_url, file_name, mime, size_bytes, meeting_id, uploaded_by_member, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.member.tenant_id, req.welfareId, title, category, visibility,
        url, req.file.originalname?.slice(0, 200) || null, req.file.mimetype, req.file.size,
        meetingId, req.member.id, `${req.member.first_name} ${req.member.last_name}`.trim(),
      ],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { logger.error("member document upload error:", e); res.status(500).json({ error: "Failed to upload document" }); }
});

router.delete("/documents/:id", async (req, res) => {
  try {
    const doc = (await query(`SELECT * FROM welfare_documents WHERE id = $1 AND welfare_id = $2`, [req.params.id, req.welfareId])).rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.uploaded_by_member !== req.member.id && !isOfficer(req.member.role)) {
      return res.status(403).json({ error: "Only the uploader or an officer can delete this." });
    }
    await query(`DELETE FROM welfare_documents WHERE id = $1`, [doc.id]);
    res.json({ success: true });
  } catch (e) { logger.error("member document delete error:", e); res.status(500).json({ error: "Failed to delete document" }); }
});

// Decisions / voting — governance motions the group votes on. Any active member
// can propose; everyone votes once; the proposer or an officer can close/cancel.
const myVotesMap = async (memberId, decisionIds) => {
  if (!decisionIds.length) return {};
  const r = await query(`SELECT decision_id, vote FROM welfare_decision_votes WHERE member_id = $1 AND decision_id = ANY($2)`, [memberId, decisionIds]);
  return Object.fromEntries(r.rows.map((x) => [x.decision_id, x.vote]));
};
const loadDecision = (welfareId, id) =>
  query(`SELECT * FROM welfare_decisions WHERE id = $1 AND welfare_id = $2`, [id, welfareId]).then((r) => r.rows[0] || null);

router.get("/decisions", async (req, res) => {
  try {
    const rows = (await query(`SELECT * FROM welfare_decisions WHERE welfare_id = $1 ORDER BY created_at DESC`, [req.welfareId])).rows;
    const resolved = [];
    for (const d of rows) resolved.push(await resolveIfDue(d));
    const mine = await myVotesMap(req.member.id, resolved.map((d) => d.id));
    const out = [];
    for (const d of resolved) out.push({ ...(await decorate(d)), my_vote: mine[d.id] || null });
    res.json({ success: true, data: { decisions: out, is_officer: isOfficer(req.member.role), my_member_id: req.member.id } });
  } catch (e) { logger.error("member decisions list error:", e); res.status(500).json({ error: "Failed to load decisions" }); }
});

router.get("/decisions/:id", async (req, res) => {
  try {
    let d = await loadDecision(req.welfareId, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    d = await resolveIfDue(d);
    const votes = (await query(
      `SELECT v.vote, v.comment, v.voted_at, m.first_name, m.last_name, m.member_no
         FROM welfare_decision_votes v JOIN members m ON m.id = v.member_id
        WHERE v.decision_id = $1 ORDER BY v.voted_at`, [d.id],
    )).rows;
    const mine = (await query(`SELECT vote FROM welfare_decision_votes WHERE decision_id=$1 AND member_id=$2`, [d.id, req.member.id])).rows[0]?.vote || null;
    res.json({ success: true, data: { ...(await decorate(d)), votes, my_vote: mine, is_officer: isOfficer(req.member.role) } });
  } catch (e) { logger.error("member decision detail error:", e); res.status(500).json({ error: "Failed to load decision" }); }
});

router.post("/decisions", async (req, res) => {
  try {
    // Only officers may call an officer election; ordinary members propose motions.
    const isElection = req.body?.type === "election" && isOfficer(req.member.role);
    let title = String(req.body?.title || "").trim();
    let targetMemberId = null, targetRole = null;
    if (isElection) {
      const t = await resolveElectionTarget(req.welfareId, req.body?.target_member_id, req.body?.target_role);
      if (t.error) return res.status(400).json({ error: t.error });
      targetMemberId = t.member.id; targetRole = t.role;
      if (!title) title = electionTitle(t.member, t.role);
    }
    if (!title) return res.status(400).json({ error: "Title is required" });
    const quorum = Math.min(100, Math.max(1, parseInt(req.body?.quorum_percent, 10) || 50));
    const closesAt = req.body?.closes_at ? new Date(req.body.closes_at) : null;
    if (closesAt && isNaN(closesAt.getTime())) return res.status(400).json({ error: "Invalid closing date" });
    const r = await query(
      `INSERT INTO welfare_decisions (tenant_id, welfare_id, type, title, description, quorum_percent, closes_at, target_member_id, target_role, opened_by_member, opened_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.member.tenant_id, req.welfareId, isElection ? "election" : "motion", title, req.body?.description?.trim() || null, quorum, closesAt, targetMemberId, targetRole, req.member.id, `${req.member.first_name} ${req.member.last_name}`.trim()],
    );
    res.status(201).json({ success: true, data: await decorate(r.rows[0]) });
  } catch (e) { logger.error("member decision open error:", e); res.status(500).json({ error: "Failed to open decision" }); }
});

router.post("/decisions/:id/vote", async (req, res) => {
  try {
    const vote = String(req.body?.vote || "").toLowerCase();
    if (!VOTES.includes(vote)) return res.status(400).json({ error: `Vote must be one of: ${VOTES.join(", ")}` });
    let d = await loadDecision(req.welfareId, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    if (d.status !== "open") return res.status(409).json({ error: "Voting on this decision has closed" });
    await query(
      `INSERT INTO welfare_decision_votes (decision_id, member_id, vote, comment) VALUES ($1,$2,$3,$4)
       ON CONFLICT (decision_id, member_id) DO UPDATE SET vote = EXCLUDED.vote, comment = EXCLUDED.comment, voted_at = NOW()`,
      [d.id, req.member.id, vote, req.body?.comment?.trim() || null],
    );
    d = await resolveIfDue(await loadDecision(req.welfareId, d.id));
    res.json({ success: true, data: { ...(await decorate(d)), my_vote: vote } });
  } catch (e) { logger.error("member decision vote error:", e); res.status(500).json({ error: "Failed to record vote" }); }
});

const closeOrCancel = (outcomeFn) => async (req, res) => {
  try {
    const d = await loadDecision(req.welfareId, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    if (d.opened_by_member !== req.member.id && !isOfficer(req.member.role)) {
      return res.status(403).json({ error: "Only the proposer or an officer can do this." });
    }
    if (d.status !== "open") return res.status(409).json({ error: "Decision is already resolved" });
    const updated = await finalize(d, await outcomeFn(d));
    res.json({ success: true, data: await decorate(updated) });
  } catch (e) { logger.error("member decision close/cancel error:", e); res.status(500).json({ error: "Failed to update decision" }); }
};
router.post("/decisions/:id/close", closeOrCancel((d) => closeOutcome(d)));
router.post("/decisions/:id/cancel", closeOrCancel(() => "cancelled"));

router.get("/group-cycles", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const r = await query(
      `SELECT c.name, c.frequency, c.due_date, c.status, c.pool_key,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id)::int AS member_count,
              (SELECT COUNT(*) FROM contribution_schedules s WHERE s.cycle_id=c.id AND s.status='paid')::int AS paid_count,
              (SELECT COALESCE(SUM(s.amount_due),0) FROM contribution_schedules s WHERE s.cycle_id=c.id) AS expected,
              (SELECT COALESCE(SUM(s.amount_paid),0) FROM contribution_schedules s WHERE s.cycle_id=c.id) AS collected
         FROM contribution_cycles c
        WHERE c.welfare_id=$1 AND EXTRACT(YEAR FROM c.due_date)=$2
        ORDER BY c.due_date DESC, c.id DESC`,
      [req.welfareId, year],
    );
    res.json({ success: true, data: r.rows.map((c) => ({ ...c, expected: Number(c.expected), collected: Number(c.collected) })) });
  } catch (e) { logger.error("member group-cycles error:", e); res.status(500).json({ error: "Failed to load cycles" }); }
});

// GET /charts — the group dashboard charts (read-only).
router.get("/charts", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const welfare = { id: req.welfareId, tenant_id: req.member.tenant_id, name: req.member.welfare_name };
    res.json({ success: true, data: await buildCharts(welfare, year) });
  } catch (e) {
    logger.error("member charts error:", e);
    res.status(500).json({ error: "Failed to load charts" });
  }
});

// GET /statement.pdf — the member's own statement (balances + full ledger).
router.get("/statement.pdf", async (req, res) => {
  try {
    const m = req.member;
    const [savings, loanOut, penOut, div, ledger] = await Promise.all([
      memberSavings(m.id),
      query(`SELECT COALESCE(SUM(total_amount_due - amount_paid),0) v FROM member_loans WHERE member_id=$1 AND status='active'`, [m.id]),
      query(`SELECT COALESCE(SUM(amount - paid_amount),0) v FROM penalty_assessments WHERE member_id=$1 AND status='outstanding'`, [m.id]),
      query(`SELECT COALESCE(SUM(amount),0) v FROM member_pool_transactions WHERE member_id=$1 AND type='dividend'`, [m.id]),
      query(`SELECT type, amount, direction, balance_after, txn_date FROM member_pool_transactions WHERE member_id=$1 ORDER BY id ASC`, [m.id]),
    ]);
    const balances = { savings: round2(savings), loan_outstanding: round2(loanOut.rows[0].v), penalty_outstanding: round2(penOut.rows[0].v), dividends: round2(div.rows[0].v) };
    const { buffer, filename } = await buildMemberStatementPdf({ id: req.welfareId, name: m.welfare_name }, m, balances, ledger.rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    logger.error("member self statement pdf error:", e);
    res.status(500).json({ error: "Failed to build statement" });
  }
});

// GET /contributions — the member's contribution schedules across cycles.
router.get("/contributions", async (req, res) => {
  try {
    const r = await query(
      `SELECT cs.id, cs.amount_due, cs.amount_paid, cs.due_date, cs.status,
              cc.id AS cycle_id, cc.name AS cycle_name, cc.frequency, cc.period_start, cc.pool_key,
              (cc.beneficiary_member_id = $1) AS i_am_beneficiary
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
                status, disbursed_at, due_date, notes, interest_method, start_date, end_date
           FROM member_loans WHERE id = $1 AND member_id = $2`,
        [req.params.loanId, req.member.id],
      )
    ).rows[0];
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    const schedule = (await query(
      `SELECT payment_number, due_date, amount_due, amount_paid, interest_portion, principal_portion, status
         FROM member_loan_schedules WHERE member_loan_id = $1 ORDER BY payment_number`,
      [loan.id],
    )).rows;
    const payments = await query(
      `SELECT amount, type, txn_date, description FROM member_pool_transactions
        WHERE member_loan_id = $1 AND type IN ('loan_repayment','loan_interest','loan_penalty') ORDER BY id DESC`,
      [loan.id],
    );
    res.json({ success: true, data: { loan, schedule, payments: payments.rows } });
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

// GET /meetings — the welfare's meetings + this member's attendance + RSVP.
router.get("/meetings", async (req, res) => {
  try {
    const r = await query(
      `SELECT gm.id, gm.title, gm.meeting_date, gm.location, gm.venue, gm.agenda, gm.status, gm.start_time, gm.grace_minutes,
              ma.status AS my_attendance,
              mc.attending AS my_confirmation,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id = gm.id AND a.status IN ('present','late'))::int AS present_count,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id = gm.id)::int AS recorded_count,
              (SELECT COUNT(*) FROM meeting_confirmations c
                 JOIN members mm ON mm.id = c.member_id
                WHERE c.meeting_id = gm.id AND c.attending = true
                  AND mm.status = 'active' AND COALESCE(mm.contribution_exempt,false) = false)::int AS confirmed_count
         FROM group_meetings gm
         LEFT JOIN member_attendance ma ON ma.meeting_id = gm.id AND ma.member_id = $1
         LEFT JOIN meeting_confirmations mc ON mc.meeting_id = gm.id AND mc.member_id = $1
        WHERE gm.group_id = $2
        ORDER BY gm.meeting_date DESC`,
      [req.member.id, req.welfareId],
    );
    const base = (await query(
      `SELECT COUNT(*)::int AS n FROM members
        WHERE welfare_id = $1 AND status = 'active' AND COALESCE(contribution_exempt,false) = false`,
      [req.welfareId],
    )).rows[0].n;
    const needed = Math.floor(base / 2) + 1;
    const rows = r.rows.map((m) => ({
      ...m,
      quorum_base: base,
      quorum_needed: needed,
      quorum_met: m.confirmed_count >= needed,
    }));
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("member meetings error:", e);
    res.status(500).json({ error: "Failed to load meetings" });
  }
});

// POST /meetings/:meetingId/confirm — member RSVPs for a SCHEDULED meeting.
// { attending: true|false }. Upserts; only allowed while the meeting is open.
router.post("/meetings/:meetingId/confirm", async (req, res) => {
  try {
    const m = (await query(
      `SELECT id, status FROM group_meetings WHERE id=$1 AND group_id=$2`,
      [req.params.meetingId, req.welfareId],
    )).rows[0];
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    if (m.status !== "scheduled")
      return res.status(400).json({ error: "This meeting is no longer open for confirmation." });
    const attending = req.body?.attending === true || req.body?.attending === "true";
    await query(
      `INSERT INTO meeting_confirmations (tenant_id, welfare_id, meeting_id, member_id, attending)
         VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (meeting_id, member_id)
         DO UPDATE SET attending = EXCLUDED.attending, updated_at = NOW()`,
      [req.member.tenant_id, req.welfareId, m.id, req.member.id, attending],
    );
    res.json({ success: true, attending });
  } catch (e) {
    logger.error("member meeting confirm error:", e);
    res.status(500).json({ error: "Failed to confirm attendance" });
  }
});

// GET /attendance-summary — group attendance stats (same as admin), read-only.
router.get("/attendance-summary", async (req, res) => {
  try {
    const held = (await query(`SELECT COUNT(*)::int AS n FROM group_meetings WHERE group_id=$1 AND status='held'`, [req.welfareId])).rows[0].n;
    const rows = await query(
      `SELECT mem.id AS member_id, mem.first_name, mem.last_name,
              COUNT(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS attended,
              COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent
         FROM members mem
         LEFT JOIN member_attendance a ON a.member_id = mem.id
         LEFT JOIN group_meetings m ON m.id = a.meeting_id AND m.group_id = $1 AND m.status = 'held'
        WHERE mem.welfare_id = $1 AND mem.status = 'active'
        GROUP BY mem.id, mem.first_name, mem.last_name
        ORDER BY attended DESC`,
      [req.welfareId],
    );
    res.json({ success: true, data: { held_meetings: held, members: rows.rows.map((m) => ({ ...m, rate: held ? Math.round((m.attended / held) * 100) : null })) } });
  } catch (e) { logger.error("member attendance summary error:", e); res.status(500).json({ error: "Failed to load attendance summary" }); }
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

// GET /dividends-projection — if a share-out ran today, the member's estimated
// share on each basis. Surplus = pool above members' total savings principal.
router.get("/dividends-projection", async (req, res) => {
  try {
    const m = req.member;
    const [pool, mine, agg] = await Promise.all([
      poolBalance(req.welfareId),
      memberSavings(m.id),
      query(
        `SELECT COUNT(*)::int AS members,
                COALESCE(SUM((SELECT COALESCE(SUM(direction*amount),0) FROM member_pool_transactions p
                               WHERE p.member_id = mm.id AND p.type IN ${SAVINGS_TYPES})),0) AS total_savings
           FROM members mm WHERE mm.welfare_id = $1 AND mm.status = 'active'`,
        [req.welfareId],
      ),
    ]);
    const totalSavings = parseFloat(agg.rows[0].total_savings) || 0;
    const members = agg.rows[0].members || 0;
    const surplus = round2(pool - totalSavings);
    const equal = surplus > 0 && members > 0 ? round2(surplus / members) : 0;
    const bySavings = surplus > 0 && totalSavings > 0 && mine > 0 ? round2((surplus * mine) / totalSavings) : 0;
    res.json({ success: true, data: { surplus: Math.max(surplus, 0), my_savings: round2(mine), active_members: members, projected: { equal, savings: bySavings } } });
  } catch (e) {
    logger.error("member dividends projection error:", e);
    res.status(500).json({ error: "Failed to project dividends" });
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

// GET /events — the member's event shares (welfare events they contribute to).
router.get("/events", async (req, res) => {
  try {
    const rows = (
      await query(
        `SELECT s.id AS share_id, s.amount_due, s.amount_paid, s.status,
                e.id AS event_id, e.title, e.amount, e.status AS event_status,
                e.due_date, e.disbursed_amount, e.disbursed_at,
                (e.beneficiary_member_id = $2) AS is_beneficiary
           FROM welfare_event_shares s
           JOIN welfare_events e ON e.id = s.event_id
          WHERE s.member_id = $2 AND s.tenant_id = $1
          ORDER BY e.id DESC`,
        [req.member.tenant_id, req.member.id],
      )
    ).rows;
    // What the member has actually BENEFITED from — payouts received from the
    // benefit pools (Event = quarterly/dowry, Emergency = oneoff) and ad-hoc
    // events. Each carries type, amount and date.
    const benefits = (
      await query(
        `SELECT pool_key, amount, txn_date, description FROM benefit_pool_ledger
          WHERE member_id = $1 AND type = 'payout'
         UNION ALL
         SELECT 'event_pool' AS pool_key, amount, txn_date, description FROM welfare_event_ledger
          WHERE member_id = $1 AND type = 'payout'
         ORDER BY txn_date DESC`,
        [req.member.id],
      )
    ).rows.map((p) => ({
      kind: p.pool_key === "oneoff" ? "Emergency" : "Event",
      name: p.description || (p.pool_key === "oneoff" ? "Emergency payout" : "Event payout"),
      amount: Number(p.amount),
      date: p.txn_date,
    }));
    res.json({ success: true, data: { events: rows, benefits } });
  } catch (e) {
    logger.error("member events error:", e);
    res.status(500).json({ error: "Failed to load events" });
  }
});

// POST /mpesa/event-share { share_id, phone? } — STK to pay an event share.
router.post("/mpesa/event-share", async (req, res) => {
  try {
    const s = (
      await query(`SELECT * FROM welfare_event_shares WHERE id = $1 AND member_id = $2`, [req.body?.share_id, req.member.id])
    ).rows[0];
    if (!s) return res.status(404).json({ error: "Share not found" });
    const amount = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
    if (!(amount > 0)) return res.status(400).json({ error: "Share already paid" });
    const r = await initiateWelfareSTK({
      welfare: welfareOf(req), member: req.member, amount,
      targetType: "welfare_event_share", targetId: s.id,
      purpose: "welfare_event_share", desc: "Event", phone: req.body?.phone,
    });
    res.json({ success: true, message: r.message, checkout_request_id: r.checkoutRequestId });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("member pay event share error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// ── Requests (loan from the pool / savings withdrawal) ────────────────────
// Members ASK; a welfare admin approves. No pool effect until approval.

// POST /loan-requests { principal, duration_months, interest_rate?, interest_method?,
//   purpose, collateral_description?, collateral_value? }
router.post("/loan-requests", gateLoanWrites, async (req, res) => {
  try {
    if (req.member.status !== "active") return res.status(400).json({ error: "Your membership is not active" });
    const principal = parseFloat(req.body?.principal);
    if (!(principal > 0)) return res.status(400).json({ error: "Enter an amount greater than 0" });
    const months = parseInt(req.body?.duration_months, 10) || 1;
    // A product (optional) locks the rate/method + range-validates.
    let productId = null, rate = null, method = "flat";
    if (req.body?.product_id) {
      const p = (await query(`SELECT * FROM member_loan_products WHERE id=$1 AND welfare_id=$2 AND active`, [req.body.product_id, req.welfareId])).rows[0];
      if (!p) return res.status(400).json({ error: "Loan product not found" });
      if (principal < parseFloat(p.min_amount) || principal > parseFloat(p.max_amount)) return res.status(400).json({ error: `Amount must be between KES ${Number(p.min_amount).toLocaleString()} and KES ${Number(p.max_amount).toLocaleString()}` });
      if (months < p.min_duration_months || months > p.max_duration_months) return res.status(400).json({ error: `Duration must be ${p.min_duration_months}–${p.max_duration_months} months` });
      productId = p.id; rate = parseFloat(p.annual_interest_rate); method = p.interest_method;
    } else {
      if (req.body?.interest_rate != null && req.body.interest_rate !== "") rate = parseFloat(req.body.interest_rate);
      if (["flat", "reducing"].includes(req.body?.interest_method)) method = req.body.interest_method;
    }
    // Optional collateral offered with the request — must carry a value.
    const collDesc = String(req.body?.collateral_description || "").trim() || null;
    const collValue = req.body?.collateral_value != null && req.body.collateral_value !== "" ? parseFloat(req.body.collateral_value) : null;
    if (collDesc && !(collValue > 0)) return res.status(400).json({ error: "Enter the collateral's value (or clear its description)" });
    const r = await query(
      `INSERT INTO member_loan_requests
         (tenant_id, welfare_id, member_id, principal, duration_months, interest_rate, product_id, interest_method, purpose, status, collateral_description, collateral_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11) RETURNING *`,
      [req.member.tenant_id, req.welfareId, req.member.id, principal, months, rate, productId, method, req.body?.purpose || null, collDesc, collDesc ? collValue : null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member loan-request error:", e);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// GET /loan-products — active products the member can apply on.
router.get("/loan-products", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, name, annual_interest_rate, interest_method, processing_fee_rate,
              min_amount, max_amount, min_duration_months, max_duration_months
         FROM member_loan_products WHERE welfare_id = $1 AND active ORDER BY name`,
      [req.welfareId],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loan-products error:", e);
    res.status(500).json({ error: "Failed to load loan products" });
  }
});

// GET /loan-policy — the chama's default loan terms, used for a "standard loan
// (no package)" when no products are configured. Numbers, with safe defaults.
router.get("/loan-policy", async (req, res) => {
  try {
    const s = (await query(`SELECT default_loan_interest_rate, default_loan_interest_method, default_loan_processing_fee_rate FROM welfare_settings WHERE tenant_id = $1`, [req.member.tenant_id])).rows[0] || {};
    res.json({ success: true, data: {
      annual_interest_rate: s.default_loan_interest_rate != null ? Number(s.default_loan_interest_rate) : null,
      interest_method: s.default_loan_interest_method || "flat",
      processing_fee_rate: s.default_loan_processing_fee_rate != null ? Number(s.default_loan_processing_fee_rate) : 0,
    } });
  } catch (e) {
    logger.error("member loan-policy error:", e);
    res.status(500).json({ error: "Failed to load loan policy" });
  }
});

// GET /loan-requests — this member's loan requests.
router.get("/loan-requests", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, principal, duration_months, interest_rate, interest_method, purpose, status,
              collateral_description, collateral_value, decision_notes, issued_loan_id, created_at, decided_at
         FROM member_loan_requests WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member loan-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// POST /event-requests { amount, event_date, reason } — ask for event funds.
router.post("/event-requests", async (req, res) => {
  try {
    if (req.member.status !== "active") return res.status(400).json({ error: "Your membership is not active" });
    const amount = parseFloat(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ error: "Enter an amount greater than 0" });
    const eventDate = req.body?.event_date || null;
    if (eventDate && eventDate <= new Date().toISOString().slice(0, 10))
      return res.status(400).json({ error: "Event date must be in the future" });
    const r = await query(
      `INSERT INTO member_event_requests (tenant_id, welfare_id, member_id, amount, event_date, reason, status)
       VALUES ($1,$2,$3,$4,$5::date,$6,'pending') RETURNING *`,
      [req.member.tenant_id, req.welfareId, req.member.id, amount, eventDate, req.body?.reason || null],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("member event-request error:", e);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// GET /event-requests — this member's event-fund requests.
router.get("/event-requests", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, amount, event_date, reason, status, decision_notes, created_at, decided_at
         FROM member_event_requests WHERE member_id = $1 ORDER BY id DESC`,
      [req.member.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("member event-requests list error:", e);
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
