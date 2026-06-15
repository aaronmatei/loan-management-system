// Welfare SMS. Mounted at /api/welfares/:welfareId. Broadcast to members, fire
// contribution-due / meeting reminders on demand, and read the SMS log.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { sendWelfareSms, welfareTemplates } from "../services/welfareSmsService.js";
import { sendContributionReminders, sendMeetingReminders } from "../services/welfareSmsReminders.js";
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
    logger.error("welfare resolve (sms) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

// GET /sms/logs — this welfare's SMS history (all welfare_* message types).
router.get("/sms/logs", async (req, res) => {
  try {
    const r = await query(
      `SELECT id, phone_number, message, message_type, status, created_at
         FROM sms_logs
        WHERE tenant_id = $1 AND message_type LIKE 'welfare_%'
        ORDER BY created_at DESC LIMIT 200`,
      [req.welfare.tenant_id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("welfare sms logs error:", e);
    res.status(500).json({ error: "Failed to load SMS logs" });
  }
});

// POST /sms/broadcast { message, member_ids? } — to all active members, or a subset.
router.post("/sms/broadcast", authorize("admin", "manager"), async (req, res) => {
  try {
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Message is required" });
    const ids = Array.isArray(req.body?.member_ids) ? req.body.member_ids : null;

    const params = [req.welfare.id];
    let where = `welfare_id = $1 AND status = 'active' AND phone_number IS NOT NULL`;
    if (ids && ids.length) {
      params.push(ids);
      where += ` AND id = ANY($2)`;
    }
    const members = (await query(`SELECT first_name, phone_number FROM members WHERE ${where}`, params)).rows;
    if (!members.length) return res.status(400).json({ error: "No members with phone numbers to message" });

    const text = welfareTemplates.broadcast(req.welfare.name, message);
    let sent = 0;
    for (const m of members) {
      const r = await sendWelfareSms({ tenantId: req.welfare.tenant_id, phone: m.phone_number, message: text, type: "welfare_broadcast", sentBy: req.user.id });
      if (r.success) sent += 1;
    }
    res.json({ success: true, recipients: members.length, sent });
  } catch (e) {
    logger.error("welfare broadcast error:", e);
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});

// POST /sms/contribution-reminders — fire due reminders for open cycles now.
router.post("/sms/contribution-reminders", authorize("admin", "manager"), async (req, res) => {
  try {
    const days = req.body?.window_days != null ? parseInt(req.body.window_days, 10) : 3;
    const r = await sendContributionReminders(req.welfare, Number.isFinite(days) ? days : 3);
    res.json({ success: true, ...r });
  } catch (e) {
    logger.error("welfare contribution reminders error:", e);
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

// POST /sms/meeting-reminder { meeting_id } — remind all active members of a meeting.
router.post("/sms/meeting-reminder", authorize("admin", "manager"), async (req, res) => {
  try {
    const mt = (await query(`SELECT * FROM group_meetings WHERE id = $1 AND group_id = $2`, [req.body?.meeting_id, req.welfare.id])).rows[0];
    if (!mt) return res.status(404).json({ error: "Meeting not found" });
    const members = (await query(`SELECT first_name, phone_number FROM members WHERE welfare_id = $1 AND status = 'active' AND phone_number IS NOT NULL`, [req.welfare.id])).rows;
    if (!members.length) return res.status(400).json({ error: "No members with phone numbers to message" });

    let sent = 0;
    for (const m of members) {
      const msg = welfareTemplates.meetingReminder(m.first_name, req.welfare.name, "meeting", mt.meeting_date, mt.location);
      const r = await sendWelfareSms({ tenantId: req.welfare.tenant_id, phone: m.phone_number, message: msg, type: "welfare_meeting_reminder", sentBy: req.user.id });
      if (r.success) sent += 1;
    }
    res.json({ success: true, recipients: members.length, sent });
  } catch (e) {
    logger.error("welfare meeting reminder error:", e);
    res.status(500).json({ error: "Failed to send meeting reminder" });
  }
});

export default router;
