// Welfare M-Pesa. Mounted at /api/welfares/:welfareId/mpesa. Initiates Daraja
// STK pushes for contributions, member-loan repayments and penalty payments;
// the shared /api/mpesa/callback confirms and allocateWelfarePayment credits
// the target. Also a transactions log + manual reconciliation.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import * as mpesa from "../services/mpesaService.js";
import { allocateWelfarePayment } from "../services/welfareMpesaService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (mpesa) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function member(welfareId, id) {
  const r = await query(`SELECT * FROM members WHERE id = $1 AND welfare_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}

// Push an STK and record the pending welfare transaction. Shared by all 3 flows.
async function pushAndRecord(req, res, { m, amount, targetType, targetId, purpose, desc }) {
  const phone = req.body?.phone || m.phone_number;
  if (!phone) return res.status(400).json({ error: "No phone number for this member" });
  if (!(amount > 0)) return res.status(400).json({ error: "Nothing outstanding to pay" });

  let result;
  try {
    result = await mpesa.initiateSTKPush({
      phone,
      amount,
      accountReference: (m.member_no || `M${m.id}`).substring(0, 12),
      transactionDesc: desc,
    });
  } catch (err) {
    logger.error("welfare STK error:", err.message);
    return res.status(502).json({ error: err.message || "M-Pesa is not available right now" });
  }

  await query(
    `INSERT INTO mpesa_transactions (
       tenant_id, purpose, welfare_id, member_id, target_type, target_id,
       initiated_by_user_id, phone_number, amount, account_reference, transaction_desc,
       merchant_request_id, checkout_request_id, status, request_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)`,
    [
      req.welfare.tenant_id, purpose, req.welfare.id, m.id, targetType, targetId,
      req.user.id, result.normalizedPhone, result.amount, (m.member_no || `M${m.id}`), desc,
      result.merchantRequestId, result.checkoutRequestId, JSON.stringify(result.raw),
    ],
  );
  res.json({ success: true, message: result.customerMessage || "STK sent — enter the M-Pesa PIN", checkout_request_id: result.checkoutRequestId });
}

// POST /mpesa/contribution { schedule_id, phone? }
router.post("/mpesa/contribution", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const s = (
      await query(
        `SELECT s.* FROM contribution_schedules s JOIN contribution_cycles c ON c.id = s.cycle_id
          WHERE s.id = $1 AND c.welfare_id = $2`,
        [req.body?.schedule_id, req.welfare.id],
      )
    ).rows[0];
    if (!s) return res.status(404).json({ error: "Schedule not found" });
    const m = await member(req.welfare.id, s.member_id);
    const outstanding = round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid));
    return pushAndRecord(req, res, { m, amount: outstanding, targetType: "contribution_schedule", targetId: s.id, purpose: "welfare_contribution", desc: "Contribution" });
  } catch (e) {
    logger.error("welfare mpesa contribution error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// POST /mpesa/loan-repayment { loan_id, amount?, phone? }
router.post("/mpesa/loan-repayment", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const l = (await query(`SELECT * FROM member_loans WHERE id = $1 AND tenant_id = $2`, [req.body?.loan_id, req.welfare.tenant_id])).rows[0];
    if (!l) return res.status(404).json({ error: "Loan not found" });
    const m = await member(req.welfare.id, l.member_id);
    if (!m) return res.status(404).json({ error: "Member not found" });
    const outstanding = round2(parseFloat(l.total_amount_due) - parseFloat(l.amount_paid));
    const amount = req.body?.amount != null && req.body.amount !== "" ? Math.min(parseFloat(req.body.amount), outstanding) : outstanding;
    return pushAndRecord(req, res, { m, amount, targetType: "member_loan", targetId: l.id, purpose: "welfare_loan_repayment", desc: "Loan Repay" });
  } catch (e) {
    logger.error("welfare mpesa loan error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// POST /mpesa/penalty { assessment_id, phone? }
router.post("/mpesa/penalty", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const a = (await query(`SELECT * FROM penalty_assessments WHERE id = $1 AND tenant_id = $2`, [req.body?.assessment_id, req.welfare.tenant_id])).rows[0];
    if (!a) return res.status(404).json({ error: "Penalty not found" });
    if (a.status !== "outstanding") return res.status(400).json({ error: `Penalty is ${a.status}` });
    const m = await member(req.welfare.id, a.member_id);
    if (!m) return res.status(404).json({ error: "Member not found" });
    const outstanding = round2(parseFloat(a.amount) - parseFloat(a.paid_amount));
    return pushAndRecord(req, res, { m, amount: outstanding, targetType: "penalty_assessment", targetId: a.id, purpose: "welfare_penalty", desc: "Penalty" });
  } catch (e) {
    logger.error("welfare mpesa penalty error:", e);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

// GET /mpesa/transactions — the welfare M-Pesa log (doubles as reconciliation).
router.get("/mpesa/transactions", async (req, res) => {
  try {
    const r = await query(
      `SELECT t.id, t.purpose, t.target_type, t.target_id, t.amount, t.status, t.allocated,
              t.phone_number, t.mpesa_receipt_number, t.created_at,
              m.first_name, m.last_name, m.member_no
         FROM mpesa_transactions t
         LEFT JOIN members m ON m.id = t.member_id
        WHERE t.welfare_id = $1
        ORDER BY t.created_at DESC
        LIMIT 200`,
      [req.welfare.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("welfare mpesa list error:", e);
    res.status(500).json({ error: "Failed to load transactions" });
  }
});

// POST /mpesa/transactions/:id/allocate — manual reconciliation of a confirmed
// but un-applied payment (e.g. callback applied failed, or a matched C2B entry).
router.post("/mpesa/transactions/:id/allocate", authorize("admin", "manager"), async (req, res) => {
  try {
    const t = (await query(`SELECT * FROM mpesa_transactions WHERE id = $1 AND welfare_id = $2`, [req.params.id, req.welfare.id])).rows[0];
    if (!t) return res.status(404).json({ error: "Transaction not found" });
    if (t.status !== "success") return res.status(400).json({ error: "Only successful payments can be allocated" });
    if (t.allocated) return res.status(400).json({ error: "Already allocated" });
    const r = await allocateWelfarePayment(t, { amount: t.amount });
    res.json({ success: true, ...r });
  } catch (e) {
    logger.error("welfare mpesa allocate error:", e);
    res.status(500).json({ error: "Failed to allocate" });
  }
});

export default router;
