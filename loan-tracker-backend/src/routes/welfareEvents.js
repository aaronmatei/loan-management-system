// Welfare EVENTS admin API. Mounted at /api/welfares/:welfareId. An event is an
// ad-hoc payout to a member, funded from the SEPARATE events pool (a shortfall
// is collected from members as equal shares). See welfareEventsService.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import {
  eventsPoolBalance, createEvent, fundEvent, payEventShare, payoutEvent, repayBridge, recoverShareFromSavings,
} from "../services/welfareEventsService.js";
import { accrueEventSharePenalties } from "../services/welfarePenaltyAccrual.js";
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
    logger.error("welfare resolve (events) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

const loadEvent = async (welfareId, id) =>
  (await query(`SELECT * FROM welfare_events WHERE id = $1 AND welfare_id = $2`, [id, welfareId])).rows[0];

const fail = (res, e, msg) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  logger.error(msg, e);
  res.status(500).json({ error: msg });
};

// GET /events — events pool balance + the welfare's events.
router.get("/events", async (req, res) => {
  try {
    const balance = await eventsPoolBalance(req.welfare.id);
    const rows = (
      await query(
        `SELECT e.*, m.first_name AS beneficiary_first, m.last_name AS beneficiary_last,
                (SELECT COALESCE(SUM(amount_paid),0) FROM welfare_event_shares s WHERE s.event_id = e.id) AS collected,
                (SELECT COALESCE(SUM(amount_due),0)  FROM welfare_event_shares s WHERE s.event_id = e.id) AS to_collect
           FROM welfare_events e
           JOIN members m ON m.id = e.beneficiary_member_id
          WHERE e.welfare_id = $1
          ORDER BY e.id DESC`,
        [req.welfare.id],
      )
    ).rows;
    res.json({ success: true, data: { pool_balance: balance, events: rows } });
  } catch (e) { fail(res, e, "Failed to load events"); }
});

// GET /events/:id — one event with its shares + ledger.
router.get("/events/:id", async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const shares = (
      await query(
        `SELECT s.*, m.first_name, m.last_name, m.member_no
           FROM welfare_event_shares s JOIN members m ON m.id = s.member_id
          WHERE s.event_id = $1 ORDER BY m.id`,
        [event.id],
      )
    ).rows;
    const ledger = (
      await query(`SELECT * FROM welfare_event_ledger WHERE event_id = $1 ORDER BY id`, [event.id])
    ).rows;
    res.json({ success: true, data: { event, shares, ledger, pool_balance: await eventsPoolBalance(req.welfare.id) } });
  } catch (e) { fail(res, e, "Failed to load event"); }
});

// POST /events — create { beneficiary_member_id, amount, due_date?, title?, description? }
router.post("/events", authorize("admin", "manager"), async (req, res) => {
  try {
    const { beneficiary_member_id, amount, due_date, title, description } = req.body || {};
    const event = await createEvent({
      welfare: req.welfare, beneficiaryMemberId: beneficiary_member_id, amount,
      dueDate: due_date, title, description, userId: req.user.id,
    });
    await logAudit({ user: req.user, action: "welfare_event_created", entityType: "welfare_event", entityId: event.id, description: `Created event "${event.title}" (KES ${parseFloat(event.amount).toLocaleString()})`, req });
    res.status(201).json({ success: true, data: event });
  } catch (e) { fail(res, e, "Failed to create event"); }
});

// POST /events/:id/fund — { mode: 'pool' | 'collect', due_date? }
router.post("/events/:id/fund", authorize("admin", "manager"), async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const result = await fundEvent({ welfare: req.welfare, event, mode: req.body?.mode, dueDate: req.body?.due_date, userId: req.user.id });
    await logAudit({ user: req.user, action: "welfare_event_funded", entityType: "welfare_event", entityId: event.id, description: `Funded event "${event.title}" via ${req.body?.mode || "pool"}`, req });
    res.json({ success: true, data: result });
  } catch (e) { fail(res, e, "Failed to fund event"); }
});

// POST /events/:id/shares/:memberId/pay — { amount? } record a member's share payment.
router.post("/events/:id/shares/:memberId/pay", authorize("admin", "manager"), async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const result = await payEventShare({ welfare: req.welfare, event, memberId: parseInt(req.params.memberId, 10), amount: req.body?.amount, userId: req.user.id });
    res.json({ success: true, data: result });
  } catch (e) { fail(res, e, "Failed to record share payment"); }
});

// POST /events/assess-late — accrue event_late fines on overdue shares (manual).
router.post("/events/assess-late", authorize("admin", "manager"), async (req, res) => {
  try {
    const r = await accrueEventSharePenalties(req.welfare.tenant_id);
    res.json({ success: true, data: r });
  } catch (e) { fail(res, e, "Failed to assess event penalties"); }
});

// POST /events/:id/shares/:memberId/recover — settle an unpaid share from savings.
router.post("/events/:id/shares/:memberId/recover", authorize("admin", "manager"), async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const result = await recoverShareFromSavings({ welfare: req.welfare, event, memberId: parseInt(req.params.memberId, 10), userId: req.user.id });
    await logAudit({ user: req.user, action: "welfare_event_share_recovered", entityType: "welfare_event", entityId: event.id, description: `Recovered KES ${result.recovered.toLocaleString()} event share from member ${req.params.memberId}'s savings`, req });
    res.json({ success: true, data: result });
  } catch (e) { fail(res, e, "Failed to recover share"); }
});

// POST /events/:id/repay-bridge — repay the savings pool from the events pool.
router.post("/events/:id/repay-bridge", authorize("admin", "manager"), async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const result = await repayBridge({ welfare: req.welfare, event, userId: req.user.id });
    await logAudit({ user: req.user, action: "welfare_event_bridge_repaid", entityType: "welfare_event", entityId: event.id, description: `Repaid KES ${result.repaid.toLocaleString()} of the savings bridge for "${event.title}"`, req });
    res.json({ success: true, data: result });
  } catch (e) { fail(res, e, "Failed to repay bridge"); }
});

// POST /events/:id/payout — disburse a fully-funded event to its beneficiary.
router.post("/events/:id/payout", authorize("admin", "manager"), async (req, res) => {
  try {
    const event = await loadEvent(req.welfare.id, req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const result = await payoutEvent({ welfare: req.welfare, event, userId: req.user.id });
    await logAudit({ user: req.user, action: "welfare_event_disbursed", entityType: "welfare_event", entityId: event.id, description: `Disbursed KES ${parseFloat(event.amount).toLocaleString()} for "${event.title}"`, req });
    res.json({ success: true, data: result });
  } catch (e) { fail(res, e, "Failed to disburse event"); }
});

export default router;
