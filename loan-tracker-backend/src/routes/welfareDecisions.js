// Welfare decisions — staff/admin side. Mounted at
// /api/welfares/:welfareId/decisions. Staff open governance motions and oversee
// / close them; members vote in the portal (routes/portal/member.js). Voting
// itself is a member action, so there is no staff vote endpoint. See migration
// 098 and services/welfareDecisionService.js.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { decorate, resolveIfDue, finalize, closeOutcome } from "../services/welfareDecisionService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (decisions) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

const loadDecision = (welfareId, id) =>
  query(`SELECT * FROM welfare_decisions WHERE id = $1 AND welfare_id = $2`, [id, welfareId]).then((r) => r.rows[0] || null);

// GET /decisions — list, resolving any that are now due.
router.get("/", async (req, res) => {
  try {
    const rows = (await query(`SELECT * FROM welfare_decisions WHERE welfare_id = $1 ORDER BY created_at DESC`, [req.welfare.id])).rows;
    const out = [];
    for (const d of rows) out.push(await decorate(await resolveIfDue(d)));
    res.json({ success: true, data: out });
  } catch (e) {
    logger.error("welfare decisions list error:", e);
    res.status(500).json({ error: "Failed to load decisions" });
  }
});

// GET /decisions/:id — detail with the votes cast.
router.get("/:id", async (req, res) => {
  try {
    let d = await loadDecision(req.welfare.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    d = await resolveIfDue(d);
    const votes = (await query(
      `SELECT v.vote, v.comment, v.voted_at, m.first_name, m.last_name, m.member_no
         FROM welfare_decision_votes v JOIN members m ON m.id = v.member_id
        WHERE v.decision_id = $1 ORDER BY v.voted_at`,
      [d.id],
    )).rows;
    res.json({ success: true, data: { ...(await decorate(d)), votes } });
  } catch (e) {
    logger.error("welfare decision detail error:", e);
    res.status(500).json({ error: "Failed to load decision" });
  }
});

// POST /decisions — open a governance motion.
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Title is required" });
    const quorum = Math.min(100, Math.max(1, parseInt(req.body?.quorum_percent, 10) || 50));
    const closesAt = req.body?.closes_at ? new Date(req.body.closes_at) : null;
    if (closesAt && isNaN(closesAt.getTime())) return res.status(400).json({ error: "Invalid closing date" });
    const r = await query(
      `INSERT INTO welfare_decisions (tenant_id, welfare_id, type, title, description, quorum_percent, closes_at, opened_by_user, opened_by_name)
       VALUES ($1,$2,'motion',$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.welfare.tenant_id, req.welfare.id, title, req.body?.description?.trim() || null, quorum, closesAt,
        req.user.id, `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() || req.user.email || "Staff"],
    );
    await logAudit({ user: req.user, action: "created", entityType: "welfare_decision", entityId: r.rows[0].id, entityCode: title, description: `Opened motion: ${title}`, req });
    res.status(201).json({ success: true, data: await decorate(r.rows[0]) });
  } catch (e) {
    logger.error("welfare decision open error:", e);
    res.status(500).json({ error: "Failed to open decision" });
  }
});

// POST /decisions/:id/close — finalize now based on the current tally.
router.post("/:id/close", authorize("admin", "manager"), async (req, res) => {
  try {
    const d = await loadDecision(req.welfare.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    if (d.status !== "open") return res.status(409).json({ error: "Decision is already resolved" });
    const updated = await finalize(d, await closeOutcome(d));
    res.json({ success: true, data: await decorate(updated) });
  } catch (e) {
    logger.error("welfare decision close error:", e);
    res.status(500).json({ error: "Failed to close decision" });
  }
});

// POST /decisions/:id/cancel — withdraw a motion without an outcome.
router.post("/:id/cancel", authorize("admin", "manager"), async (req, res) => {
  try {
    const d = await loadDecision(req.welfare.id, req.params.id);
    if (!d) return res.status(404).json({ error: "Decision not found" });
    if (d.status !== "open") return res.status(409).json({ error: "Decision is already resolved" });
    const updated = await finalize(d, "cancelled");
    res.json({ success: true, data: await decorate(updated) });
  } catch (e) {
    logger.error("welfare decision cancel error:", e);
    res.status(500).json({ error: "Failed to cancel decision" });
  }
});

export default router;
