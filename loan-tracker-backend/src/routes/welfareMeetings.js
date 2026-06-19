// Welfare meetings + member attendance. Mounted at /api/welfares/:welfareId.
// The meeting record reuses group_meetings; attendance is over the `members`
// roster (member_attendance) and absent/late statuses auto-assess attendance
// penalties via the configured rules.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

const ATTENDANCE = ["present", "late", "absent", "excused"];
const TRIGGER_FOR = { absent: "attendance_absent", late: "attendance_late" };

router.use(async (req, res, next) => {
  try {
    const tc = tenantClause(req, 1, "tenant_id");
    const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [req.params.welfareId, ...tc.params]);
    if (!r.rows.length) return res.status(404).json({ error: "Welfare not found" });
    req.welfare = r.rows[0];
    next();
  } catch (e) {
    logger.error("welfare resolve (meetings) error:", e);
    res.status(500).json({ error: "Failed to resolve welfare" });
  }
});

async function loadMeeting(welfareId, id) {
  const r = await query(`SELECT * FROM group_meetings WHERE id = $1 AND group_id = $2`, [id, welfareId]);
  return r.rows[0] || null;
}

// Re-assess absent/late penalties for one member at one meeting. Clears prior
// unpaid attendance penalties for that (meeting, member) first so changing the
// status (e.g. absent → present) removes the penalty.
async function assessAttendance(welfare, meetingId, memberId, status, fines, userId) {
  // Re-marking attendance replaces the member's unpaid meeting fine.
  await query(
    `DELETE FROM penalty_assessments
      WHERE tenant_id = $1 AND source_type = 'meeting' AND source_id = $2 AND member_id = $3
        AND trigger IN ('attendance_absent','attendance_late') AND status = 'outstanding' AND paid_amount = 0`,
    [welfare.tenant_id, meetingId, memberId],
  );
  const trigger = TRIGGER_FOR[status];
  const amt = status === "late" ? fines.late : status === "absent" ? fines.absent : 0;
  if (!trigger || !(amt > 0)) return;
  await query(
    `INSERT INTO penalty_assessments
       (tenant_id, member_id, rule_id, trigger, source_type, source_id, amount, description, created_by)
     VALUES ($1,$2,NULL,$3,'meeting',$4,$5,$6,$7)`,
    [welfare.tenant_id, memberId, trigger, meetingId, amt, status === "absent" ? "Absent from meeting" : "Late to meeting", userId],
  );
}

// GET /meetings
router.get("/meetings", async (req, res) => {
  try {
    const r = await query(
      `SELECT m.*,
          (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id = m.id AND a.status IN ('present','late'))::int AS present_count,
          (SELECT COUNT(*) FROM member_attendance a WHERE a.meeting_id = m.id)::int AS recorded_count
        FROM group_meetings m
        WHERE m.group_id = $1
        ORDER BY m.meeting_date DESC, m.id DESC`,
      [req.welfare.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("welfare meetings list error:", e);
    res.status(500).json({ error: "Failed to load meetings" });
  }
});

// POST /meetings
router.post("/meetings", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const { meeting_date, location, agenda, title, fine_late, fine_absent } = req.body || {};
    if (!meeting_date) return res.status(400).json({ error: "Meeting date is required" });
    const num = (v) => (v === "" || v == null ? null : parseFloat(v));
    const r = await query(
      `INSERT INTO group_meetings (tenant_id, group_id, title, meeting_date, location, agenda, fine_late, fine_absent, created_by)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9) RETURNING *`,
      [req.welfare.tenant_id, req.welfare.id, title || null, meeting_date, location || null, agenda || null, num(fine_late), num(fine_absent), req.user.id],
    );
    await logAudit({
      user: req.user, action: "welfare_meeting_created", entityType: "group",
      entityId: req.welfare.id, entityCode: req.welfare.group_code,
      description: `Meeting${title ? ` "${title}"` : ""} on ${meeting_date}`, req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare meeting create error:", e);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

// GET /meetings/:meetingId — meeting + roster (active members + their status).
router.get("/meetings/:meetingId", async (req, res) => {
  try {
    const m = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const roster = await query(
      `SELECT mem.id AS member_id, mem.first_name, mem.last_name, mem.member_no,
              a.status AS attendance_status
         FROM members mem
         LEFT JOIN member_attendance a ON a.meeting_id = $2 AND a.member_id = mem.id
        WHERE mem.welfare_id = $1 AND mem.status = 'active'
        ORDER BY mem.first_name`,
      [req.welfare.id, m.id],
    );
    // Everything else concerning this meeting: the fines raised + any pool payout
    // handed out at it. (The meeting's own late/absent charges are on m.)
    const fines = (await query(
      `SELECT pa.id, pa.trigger, pa.amount, pa.paid_amount, pa.status, mem.first_name, mem.last_name
         FROM penalty_assessments pa JOIN members mem ON mem.id = pa.member_id
        WHERE pa.source_type='meeting' AND pa.source_id=$1 ORDER BY pa.id`,
      [m.id],
    )).rows;
    const payout = (await query(
      `SELECT l.amount, l.pool_key, l.txn_date, mem.first_name, mem.last_name
         FROM benefit_pool_ledger l JOIN members mem ON mem.id = l.member_id
        WHERE l.meeting_id=$1 AND l.type='payout' LIMIT 1`,
      [m.id],
    )).rows[0] || null;
    res.json({ success: true, data: { meeting: m, roster: roster.rows, fines, payout } });
  } catch (e) {
    logger.error("welfare meeting get error:", e);
    res.status(500).json({ error: "Failed to load meeting" });
  }
});

// POST /meetings/:meetingId/attendance — upsert roster + assess penalties.
router.post(
  "/meetings/:meetingId/attendance",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const m = await loadMeeting(req.welfare.id, req.params.meetingId);
      if (!m) return res.status(404).json({ error: "Meeting not found" });
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!records.length) return res.status(400).json({ error: "No attendance records" });

      // The fine is defined ON the meeting: late attendees pay fine_late, absent
      // members pay fine_absent (both fixed amounts).
      const fines = { late: m.fine_late != null ? Number(m.fine_late) : 0, absent: m.fine_absent != null ? Number(m.fine_absent) : 0 };

      for (const rec of records) {
        if (!rec.member_id) continue;
        const status = ATTENDANCE.includes(rec.status) ? rec.status : "present";
        await query(
          `INSERT INTO member_attendance (tenant_id, welfare_id, meeting_id, member_id, status)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (meeting_id, member_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
          [req.welfare.tenant_id, req.welfare.id, m.id, rec.member_id, status],
        );
        await assessAttendance(req.welfare, m.id, rec.member_id, status, fines, req.user.id);
      }
      await query(`UPDATE group_meetings SET status='held', updated_at=NOW() WHERE id=$1 AND status <> 'cancelled'`, [m.id]);
      await logAudit({
        user: req.user, action: "welfare_attendance_recorded", entityType: "group",
        entityId: req.welfare.id, description: `Attendance recorded (${records.length} members)`, req,
      });
      res.json({ success: true });
    } catch (e) {
      logger.error("welfare attendance error:", e);
      res.status(500).json({ error: "Failed to record attendance" });
    }
  },
);

// GET /attendance-summary — per-member attendance over held meetings.
router.get("/attendance-summary", async (req, res) => {
  try {
    const held = (await query(`SELECT COUNT(*)::int AS n FROM group_meetings WHERE group_id=$1 AND status='held'`, [req.welfare.id])).rows[0].n;
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
      [req.welfare.id],
    );
    res.json({
      success: true,
      data: {
        held_meetings: held,
        members: rows.rows.map((m) => ({ ...m, rate: held ? Math.round((m.attended / held) * 100) : null })),
      },
    });
  } catch (e) {
    logger.error("welfare attendance summary error:", e);
    res.status(500).json({ error: "Failed to load attendance summary" });
  }
});

export default router;
