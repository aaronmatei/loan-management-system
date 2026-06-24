// Welfare meetings + member attendance. Mounted at /api/welfares/:welfareId.
// The meeting record reuses group_meetings; attendance is over the `members`
// roster (member_attendance) and absent/late statuses auto-assess attendance
// penalties via the configured rules.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { loadAgenda, loadMinutes, nextPosition } from "../services/meetingAgendaService.js";
import { postPool, round2 } from "../services/welfarePoolService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

const ATTENDANCE = ["present", "late", "absent", "excused"];
const TRIGGER_FOR = { absent: "attendance_absent", late: "attendance_late" };

// "HH:MM[:SS]" → minutes since midnight (null for blank).
const toMinutes = (t) => {
  if (!t || !String(t).trim()) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
};

// Derive a member's attendance status from the recorded arrival time against the
// meeting's start + grace. No arrival → absent, unless an apology was logged
// (excused). An explicit `status` (legacy/manual callers) is honoured when no
// arrival time is given.
function deriveStatus(rec, meeting) {
  const arrival = rec.arrival_time && String(rec.arrival_time).trim() ? rec.arrival_time : null;
  if (arrival) {
    const a = toMinutes(arrival), s = toMinutes(meeting.start_time);
    if (s == null) return "present"; // no scheduled start → can't be late
    return a > s + (Number(meeting.grace_minutes) || 0) ? "late" : "present";
  }
  const apology = rec.apology === true || rec.apology === "true";
  if (!apology && ATTENDANCE.includes(rec.status)) return rec.status; // explicit status, back-compat
  return apology ? "excused" : "absent";
}

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

// Re-assess absent/late penalties for one member at one meeting based on their
// (new) attendance status. A fine that no longer applies is REVERSED:
//   • unpaid  → deleted (as before), and
//   • already-paid → the cash is refunded out of the pool (a reversing
//     'penalty' pool entry) and the assessment is marked 'reversed'.
// So correcting a fined member to present (or to a different status) gives any
// money they already paid back. A fine that still applies unchanged is left
// untouched, so a no-op re-save never double-charges or refunds-then-recharges.
async function assessAttendance(welfare, meetingId, memberId, status, fines, userId) {
  const newTrigger = TRIGGER_FOR[status] || null;
  const newAmt = status === "late" ? fines.late : status === "absent" ? fines.absent : 0;

  const existing = (
    await query(
      `SELECT id, paid_amount, trigger FROM penalty_assessments
        WHERE tenant_id = $1 AND source_type = 'meeting' AND source_id = $2 AND member_id = $3
          AND trigger IN ('attendance_absent','attendance_late')
          AND status IN ('outstanding','paid')`,
      [welfare.tenant_id, meetingId, memberId],
    )
  ).rows;

  let kept = false;
  for (const a of existing) {
    // Same fine still applies → leave it (and any payment against it) as is.
    if (newTrigger && newAmt > 0 && a.trigger === newTrigger && !kept) {
      kept = true;
      continue;
    }
    const paid = round2(parseFloat(a.paid_amount) || 0);
    if (paid > 0) {
      // Refund what the member paid back out of the pool, then void the fine.
      await postPool({
        welfare,
        memberId,
        type: "penalty",
        amount: paid,
        direction: -1,
        description: `Reversal of attendance fine (assessment #${a.id})`,
        userId,
      });
      await query(
        `UPDATE penalty_assessments SET status = 'reversed', paid_amount = 0 WHERE id = $1`,
        [a.id],
      );
    } else {
      await query(`DELETE FROM penalty_assessments WHERE id = $1`, [a.id]);
    }
  }

  if (newTrigger && newAmt > 0 && !kept) {
    await query(
      `INSERT INTO penalty_assessments
         (tenant_id, member_id, rule_id, trigger, source_type, source_id, amount, description, created_by)
       VALUES ($1,$2,NULL,$3,'meeting',$4,$5,$6,$7)`,
      [welfare.tenant_id, memberId, newTrigger, meetingId, newAmt, status === "absent" ? "Absent from meeting" : "Late to meeting", userId],
    );
  }
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
    const { meeting_date, location, agenda, title, fine_late, fine_absent, start_time, grace_minutes } = req.body || {};
    if (!meeting_date) return res.status(400).json({ error: "Meeting date is required" });
    const num = (v) => (v === "" || v == null ? null : parseFloat(v));
    const startTime = start_time && String(start_time).trim() ? start_time : null;
    const grace = Math.max(0, parseInt(grace_minutes, 10) || 0);
    const r = await query(
      `INSERT INTO group_meetings (tenant_id, group_id, title, meeting_date, location, agenda, fine_late, fine_absent, start_time, grace_minutes, created_by)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.welfare.tenant_id, req.welfare.id, title || null, meeting_date, location || null, agenda || null, num(fine_late), num(fine_absent), startTime, grace, req.user.id],
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

// PUT /meetings/:meetingId — edit a meeting's details. Attendance already
// recorded is NOT re-derived (statuses were snapshotted when marked).
router.put("/meetings/:meetingId", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const existing = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!existing) return res.status(404).json({ error: "Meeting not found" });
    const { meeting_date, location, agenda, title, fine_late, fine_absent, start_time, grace_minutes } = req.body || {};
    if (!meeting_date) return res.status(400).json({ error: "Meeting date is required" });
    const num = (v) => (v === "" || v == null ? null : parseFloat(v));
    const startTime = start_time && String(start_time).trim() ? start_time : null;
    const grace = Math.max(0, parseInt(grace_minutes, 10) || 0);
    const r = await query(
      `UPDATE group_meetings
          SET title=$2, meeting_date=$3::date, location=$4, agenda=$5,
              fine_late=$6, fine_absent=$7, start_time=$8, grace_minutes=$9, updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [existing.id, title || null, meeting_date, location || null, agenda || null, num(fine_late), num(fine_absent), startTime, grace],
    );
    await logAudit({
      user: req.user, action: "welfare_meeting_updated", entityType: "group",
      entityId: req.welfare.id, entityCode: req.welfare.group_code,
      description: `Updated meeting${title ? ` "${title}"` : ""}`, req,
    });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("welfare meeting update error:", e);
    res.status(500).json({ error: "Failed to update meeting" });
  }
});

// GET /meetings/:meetingId — meeting + roster (active members + their status).
router.get("/meetings/:meetingId", async (req, res) => {
  try {
    const m = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const roster = await query(
      `SELECT mem.id AS member_id, mem.first_name, mem.last_name, mem.member_no,
              a.status AS attendance_status, a.arrival_time, a.apology
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
    const agenda = await loadAgenda(m.id);
    const minutes = await loadMinutes(req.welfare.id, m.id);
    res.json({ success: true, data: { meeting: m, roster: roster.rows, fines, payout, agenda, minutes } });
  } catch (e) {
    logger.error("welfare meeting get error:", e);
    res.status(500).json({ error: "Failed to load meeting" });
  }
});

// ---------------- AGENDA (admin harmonizes — full CRUD on any item) ----------------

// POST /meetings/:meetingId/agenda — add an agenda item (appended to the end).
router.post("/meetings/:meetingId/agenda", authorize("admin", "manager", "loan_officer"), async (req, res) => {
  try {
    const m = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "Agenda item can't be empty" });
    const r = await query(
      `INSERT INTO meeting_agenda_items (tenant_id, welfare_id, meeting_id, content, position, status, suggested_by_user, author_name)
       VALUES ($1,$2,$3,$4,$5,'approved',$6,$7) RETURNING *`,
      [req.welfare.tenant_id, req.welfare.id, m.id, content, await nextPosition(m.id), req.user.id, req.user.name || "Admin"],
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("agenda add error:", e);
    res.status(500).json({ error: "Failed to add agenda item" });
  }
});

// PUT /meetings/:meetingId/agenda/:itemId — edit/reorder ANY item (harmonize).
router.put("/meetings/:meetingId/agenda/:itemId", authorize("admin", "manager"), async (req, res) => {
  try {
    const m = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const fields = [], params = [req.params.itemId, m.id];
    if (req.body?.content !== undefined) {
      const c = String(req.body.content).trim();
      if (!c) return res.status(400).json({ error: "Agenda item can't be empty" });
      params.push(c); fields.push(`content = $${params.length}`);
    }
    if (req.body?.position !== undefined) { params.push(parseInt(req.body.position, 10) || 0); fields.push(`position = $${params.length}`); }
    // Approving / rejecting a member suggestion is a status change.
    if (req.body?.status !== undefined && ["approved", "suggested", "rejected"].includes(req.body.status)) { params.push(req.body.status); fields.push(`status = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });
    const r = await query(`UPDATE meeting_agenda_items SET ${fields.join(", ")}, updated_at=NOW() WHERE id=$1 AND meeting_id=$2 RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: "Agenda item not found" });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("agenda edit error:", e);
    res.status(500).json({ error: "Failed to update agenda item" });
  }
});

// DELETE /meetings/:meetingId/agenda/:itemId — remove ANY item.
router.delete("/meetings/:meetingId/agenda/:itemId", authorize("admin", "manager"), async (req, res) => {
  try {
    const m = await loadMeeting(req.welfare.id, req.params.meetingId);
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    const r = await query(`DELETE FROM meeting_agenda_items WHERE id=$1 AND meeting_id=$2 RETURNING id`, [req.params.itemId, m.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Agenda item not found" });
    res.json({ success: true });
  } catch (e) {
    logger.error("agenda delete error:", e);
    res.status(500).json({ error: "Failed to delete agenda item" });
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
        const status = deriveStatus(rec, m);
        const arrival = rec.arrival_time && String(rec.arrival_time).trim() ? rec.arrival_time : null;
        const apology = rec.apology === true || rec.apology === "true";
        await query(
          `INSERT INTO member_attendance (tenant_id, welfare_id, meeting_id, member_id, status, arrival_time, apology)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (meeting_id, member_id) DO UPDATE SET status = EXCLUDED.status, arrival_time = EXCLUDED.arrival_time, apology = EXCLUDED.apology, updated_at = NOW()`,
          [req.welfare.tenant_id, req.welfare.id, m.id, rec.member_id, status, arrival, apology],
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
