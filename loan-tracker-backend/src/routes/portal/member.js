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
import { gateLoanWrites } from "../../services/welfareLoanFlag.js";
import { VISIBILITIES, runDocUpload, storeDocFile, isCloudinaryConfigured, isOfficer, cleanCategory } from "../../services/welfareDocumentService.js";
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

// GET /books — the welfare's Books of Accounts, same statements the admin sees
// (members are equal owners). Read-only.
router.get("/books", async (req, res) => {
  try {
    res.json({ success: true, data: await computeWelfareBooks(req.welfareId) });
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
router.get("/group-loans", async (req, res) => {
  try {
    const r = await query(
      `SELECT l.loan_code, l.principal, l.status, GREATEST(l.total_amount_due - l.amount_paid, 0) AS balance,
              l.disbursed_at, m.first_name, m.last_name
         FROM member_loans l JOIN members m ON m.id = l.member_id
        WHERE l.welfare_id = $1 AND l.status IN ('active','defaulted','completed')
        ORDER BY l.created_at DESC LIMIT 200`,
      [req.welfareId],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) { logger.error("member group-loans error:", e); res.status(500).json({ error: "Failed to load loans" }); }
});

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
    if (!isCloudinaryConfigured()) return res.status(503).json({ error: "File storage is not configured yet." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required" });
    // Only officers may post officer-only documents; members always share with the group.
    const visibility = isOfficer(req.member.role) && VISIBILITIES.includes(req.body?.visibility) ? req.body.visibility : "members";
    const url = await storeDocFile(req.file, req.welfareId);
    const r = await query(
      `INSERT INTO welfare_documents
         (tenant_id, welfare_id, title, category, visibility, file_url, file_name, mime, size_bytes, uploaded_by_member, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.member.tenant_id, req.welfareId, title, cleanCategory(req.body?.category), visibility,
        url, req.file.originalname?.slice(0, 200) || null, req.file.mimetype, req.file.size,
        req.member.id, `${req.member.first_name} ${req.member.last_name}`.trim(),
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

// GET /meetings — the welfare's meetings + this member's attendance.
router.get("/meetings", async (req, res) => {
  try {
    const r = await query(
      `SELECT gm.id, gm.title, gm.meeting_date, gm.location, gm.agenda, gm.status,
              ma.status AS my_attendance,
              (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id = gm.id AND a.status IN ('present','late'))::int AS present_count
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
                e.due_date, (e.beneficiary_member_id = $2) AS is_beneficiary
           FROM welfare_event_shares s
           JOIN welfare_events e ON e.id = s.event_id
          WHERE s.member_id = $2 AND s.tenant_id = $1
          ORDER BY e.id DESC`,
        [req.member.tenant_id, req.member.id],
      )
    ).rows;
    res.json({ success: true, data: { events: rows } });
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

// POST /loan-requests { principal, duration_months, interest_rate?, purpose }
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
    } else if (req.body?.interest_rate != null && req.body.interest_rate !== "") {
      rate = parseFloat(req.body.interest_rate);
    }
    const r = await query(
      `INSERT INTO member_loan_requests
         (tenant_id, welfare_id, member_id, principal, duration_months, interest_rate, product_id, interest_method, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
      [req.member.tenant_id, req.welfareId, req.member.id, principal, months, rate, productId, method, req.body?.purpose || null],
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
