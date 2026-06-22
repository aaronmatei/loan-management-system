// Welfare admin review of member-initiated requests (loans from the pool +
// savings withdrawals). Mounted at /api/welfares/:welfareId/requests. Approving
// runs the SAME pool logic as the admin-direct flows (welfarePoolService), so a
// request that's approved is indistinguishable from a directly-issued loan /
// withdrawal.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { issueMemberLoan, recordWithdrawal } from "../services/welfarePoolService.js";
import { createEvent } from "../services/welfareEventsService.js";
import { sendWelfareSms } from "../services/welfareSmsService.js";
import { gateLoanWrites } from "../services/welfareLoanFlag.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

// Resolve + tenant-check the welfare (same pattern as members.js).
router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (requests) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function loadMember(welfareId, id) {
  const r = await query(`SELECT * FROM members WHERE id = $1 AND welfare_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}
const smsName = (m) => m.first_name || "Member";

// GET /loans?status=pending — member loan requests with the member's name.
router.get("/loans", async (req, res) => {
  try {
    const status = req.query.status;
    const params = [req.welfare.id];
    let where = "r.welfare_id = $1";
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
    const r = await query(
      `SELECT r.*, m.first_name, m.last_name, m.member_no, m.phone_number
         FROM member_loan_requests r JOIN members m ON m.id = r.member_id
        WHERE ${where} ORDER BY r.id DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("loan-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// GET /withdrawals?status=pending
router.get("/withdrawals", async (req, res) => {
  try {
    const status = req.query.status;
    const params = [req.welfare.id];
    let where = "r.welfare_id = $1";
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
    const r = await query(
      `SELECT r.*, m.first_name, m.last_name, m.member_no, m.phone_number
         FROM member_withdrawal_requests r JOIN members m ON m.id = r.member_id
        WHERE ${where} ORDER BY r.id DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("withdrawal-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

async function loadPending(table, welfareId, id) {
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND welfare_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}

// POST /loans/:id/approve { interest_rate?, duration_months?, notes? } — issue
// the loan from the pool and mark the request approved.
router.post("/loans/:id/approve", authorize("admin", "manager"), gateLoanWrites, async (req, res) => {
  try {
    const reqRow = await loadPending("member_loan_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    const rate =
      req.body?.interest_rate != null && req.body.interest_rate !== ""
        ? parseFloat(req.body.interest_rate)
        : reqRow.interest_rate != null ? parseFloat(reqRow.interest_rate) : 0;
    const months = parseInt(req.body?.duration_months, 10) || reqRow.duration_months || 1;

    const { loan } = await issueMemberLoan({
      welfare: req.welfare, member, principal: parseFloat(reqRow.principal), rate, months,
      notes: req.body?.notes || reqRow.purpose, userId: req.user.id,
    });
    await query(
      `UPDATE member_loan_requests
          SET status='approved', reviewed_by=$2, decision_notes=$3, issued_loan_id=$4, decided_at=NOW()
        WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null, loan.id],
    );
    // Carry any collateral the member offered onto the issued loan.
    if (reqRow.collateral_description && Number(reqRow.collateral_value) > 0) {
      await query(
        `INSERT INTO member_loan_collateral (tenant_id, member_loan_id, description, appraised_value, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.welfare.tenant_id, loan.id, reqRow.collateral_description, parseFloat(reqRow.collateral_value), req.user.id],
      );
    }
    await logAudit({
      user: req.user, action: "member_loan_request_approved", entityType: "member_loan",
      entityId: loan.id, entityCode: loan.loan_code,
      description: `Approved loan request for ${member.first_name} ${member.last_name} → ${loan.loan_code}`, req,
    });
    sendWelfareSms({
      tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "loan_request_approved",
      message: `Hi ${smsName(member)}, your ${req.welfare.name} loan request of KES ${Number(reqRow.principal).toLocaleString()} was approved (${loan.loan_code}).`,
      sentBy: req.user.id,
    });
    res.json({ success: true, data: { loan } });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("loan-request approve error:", e);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

// POST /loans/:id/reject { notes? }
router.post("/loans/:id/reject", authorize("admin", "manager"), async (req, res) => {
  try {
    const reqRow = await loadPending("member_loan_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    await query(
      `UPDATE member_loan_requests SET status='rejected', reviewed_by=$2, decision_notes=$3, decided_at=NOW() WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null],
    );
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (member) {
      sendWelfareSms({
        tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "loan_request_rejected",
        message: `Hi ${smsName(member)}, your ${req.welfare.name} loan request was not approved${req.body?.notes ? ` (${req.body.notes})` : ""}.`,
        sentBy: req.user.id,
      });
    }
    res.json({ success: true });
  } catch (e) {
    logger.error("loan-request reject error:", e);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

// POST /withdrawals/:id/approve { notes? } — pay out from the pool.
router.post("/withdrawals/:id/approve", authorize("admin", "manager"), async (req, res) => {
  try {
    const reqRow = await loadPending("member_withdrawal_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    // recordWithdrawal re-validates savings + pool at approval time.
    const { poolTxn } = await recordWithdrawal({
      welfare: req.welfare, member, amount: parseFloat(reqRow.amount),
      description: reqRow.reason || "Approved withdrawal request", userId: req.user.id,
    });
    await query(
      `UPDATE member_withdrawal_requests
          SET status='approved', reviewed_by=$2, decision_notes=$3, pool_txn_id=$4, decided_at=NOW()
        WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null, poolTxn.id],
    );
    await logAudit({
      user: req.user, action: "member_withdrawal_request_approved", entityType: "member",
      entityId: member.id, entityCode: member.member_no,
      description: `Approved withdrawal of KES ${Number(reqRow.amount).toLocaleString()} for ${member.first_name} ${member.last_name}`, req,
    });
    sendWelfareSms({
      tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "withdrawal_request_approved",
      message: `Hi ${smsName(member)}, your ${req.welfare.name} withdrawal of KES ${Number(reqRow.amount).toLocaleString()} was approved.`,
      sentBy: req.user.id,
    });
    res.json({ success: true, data: { pool_balance: Number(poolTxn.balance_after) } });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("withdrawal-request approve error:", e);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

// POST /withdrawals/:id/reject { notes? }
router.post("/withdrawals/:id/reject", authorize("admin", "manager"), async (req, res) => {
  try {
    const reqRow = await loadPending("member_withdrawal_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    await query(
      `UPDATE member_withdrawal_requests SET status='rejected', reviewed_by=$2, decision_notes=$3, decided_at=NOW() WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null],
    );
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (member) {
      sendWelfareSms({
        tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "withdrawal_request_rejected",
        message: `Hi ${smsName(member)}, your ${req.welfare.name} withdrawal request was not approved${req.body?.notes ? ` (${req.body.notes})` : ""}.`,
        sentBy: req.user.id,
      });
    }
    res.json({ success: true });
  } catch (e) {
    logger.error("withdrawal-request reject error:", e);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

// GET /events?status=pending — member event-fund requests.
router.get("/events", async (req, res) => {
  try {
    const status = req.query.status;
    const params = [req.welfare.id];
    let where = "r.welfare_id = $1";
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
    const r = await query(
      `SELECT r.*, m.first_name, m.last_name, m.member_no, m.phone_number
         FROM member_event_requests r JOIN members m ON m.id = r.member_id
        WHERE ${where} ORDER BY r.id DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("event-requests list error:", e);
    res.status(500).json({ error: "Failed to load requests" });
  }
});

// POST /events/:id/approve { notes? } — create the welfare event (status open)
// for the requester; the admin funds it next.
router.post("/events/:id/approve", authorize("admin", "manager"), async (req, res) => {
  try {
    const reqRow = await loadPending("member_event_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    const today = new Date().toISOString().slice(0, 10);
    const ed = reqRow.event_date ? new Date(reqRow.event_date).toISOString().slice(0, 10) : null;
    const event = await createEvent({
      welfare: req.welfare, beneficiaryMemberId: member.id, amount: parseFloat(reqRow.amount),
      neededBy: ed && ed > today ? ed : null, // drop a now-past requested date
      title: reqRow.reason || `Event for ${member.first_name} ${member.last_name}`,
      description: req.body?.notes || null, userId: req.user.id,
    });
    await query(
      `UPDATE member_event_requests
          SET status='approved', reviewed_by=$2, decision_notes=$3, created_event_id=$4, decided_at=NOW()
        WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null, event.id],
    );
    await logAudit({
      user: req.user, action: "member_event_request_approved", entityType: "welfare_event",
      entityId: event.id, description: `Approved event request for ${member.first_name} ${member.last_name} (KES ${Number(reqRow.amount).toLocaleString()})`, req,
    });
    sendWelfareSms({
      tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "event_request_approved",
      message: `Hi ${smsName(member)}, your ${req.welfare.name} event request of KES ${Number(reqRow.amount).toLocaleString()} was approved.`,
      sentBy: req.user.id,
    });
    res.json({ success: true, data: { event } });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    logger.error("event-request approve error:", e);
    res.status(500).json({ error: "Failed to approve request" });
  }
});

// POST /events/:id/reject { notes? }
router.post("/events/:id/reject", authorize("admin", "manager"), async (req, res) => {
  try {
    const reqRow = await loadPending("member_event_requests", req.welfare.id, req.params.id);
    if (!reqRow) return res.status(404).json({ error: "Request not found" });
    if (reqRow.status !== "pending") return res.status(400).json({ error: `Request is ${reqRow.status}` });
    await query(
      `UPDATE member_event_requests SET status='rejected', reviewed_by=$2, decision_notes=$3, decided_at=NOW() WHERE id=$1`,
      [reqRow.id, req.user.id, req.body?.notes || null],
    );
    const member = await loadMember(req.welfare.id, reqRow.member_id);
    if (member) {
      sendWelfareSms({
        tenantId: req.welfare.tenant_id, phone: member.phone_number, type: "event_request_rejected",
        message: `Hi ${smsName(member)}, your ${req.welfare.name} event request was not approved${req.body?.notes ? ` (${req.body.notes})` : ""}.`,
        sentBy: req.user.id,
      });
    }
    res.json({ success: true });
  } catch (e) {
    logger.error("event-request reject error:", e);
    res.status(500).json({ error: "Failed to reject request" });
  }
});

export default router;
