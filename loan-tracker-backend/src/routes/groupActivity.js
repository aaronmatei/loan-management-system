// Group lifecycle (Phase 5c): meetings + attendance, and lending cycles/rounds.
// Dual-mounted on /api/groups.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import logger from "../config/logger.js";

const router = express.Router({ mergeParams: true });
router.use(verifyToken);

const ATTENDANCE = ["present", "absent", "apology", "late"];

async function loadGroup(req, id) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(`SELECT * FROM groups WHERE id = $1${tc.clause}`, [
    id,
    ...tc.params,
  ]);
  return r.rows[0] || null;
}

// ---------------- MEETINGS ----------------

// GET /api/groups/:id/meetings
router.get("/:id/meetings", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const r = await query(
      `SELECT m.*,
          (SELECT COUNT(*) FROM group_meeting_attendance a
             WHERE a.meeting_id = m.id AND a.status IN ('present','late')) AS present_count,
          (SELECT COUNT(*) FROM group_meeting_attendance a WHERE a.meeting_id = m.id) AS recorded_count
        FROM group_meetings m
        WHERE m.group_id = $1
        ORDER BY m.meeting_date DESC, m.id DESC`,
      [group.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("group meetings list error:", e);
    res.status(500).json({ error: "Failed to load meetings" });
  }
});

// POST /api/groups/:id/meetings
router.post(
  "/:id/meetings",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { meeting_date, location, agenda, notes } = req.body || {};
      if (!meeting_date) return res.status(400).json({ error: "Meeting date is required" });
      const r = await query(
        `INSERT INTO group_meetings (tenant_id, group_id, meeting_date, location, agenda, notes, created_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7) RETURNING *`,
        [group.tenant_id, group.id, meeting_date, location || null, agenda || null, notes || null, req.user.id],
      );
      await logAudit({
        user: req.user,
        action: "group_meeting_created",
        entityType: "group",
        entityId: group.id,
        entityCode: group.group_code,
        description: `Meeting on ${meeting_date} scheduled for "${group.name}"`,
        req,
      });
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error("group meeting create error:", e);
      res.status(500).json({ error: "Failed to create meeting" });
    }
  },
);

// GET /api/groups/:id/meetings/:meetingId — meeting + roster with attendance.
router.get("/:id/meetings/:meetingId", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const mRes = await query(
      `SELECT * FROM group_meetings WHERE id = $1 AND group_id = $2`,
      [req.params.meetingId, group.id],
    );
    if (!mRes.rows.length) return res.status(404).json({ error: "Meeting not found" });
    const roster = await query(
      `SELECT gm.client_id, c.first_name, c.last_name, c.client_code, gm.role,
              a.status AS attendance_status
         FROM group_members gm
         JOIN clients c ON c.id = gm.client_id
         LEFT JOIN group_meeting_attendance a
           ON a.meeting_id = $2 AND a.client_id = gm.client_id
        WHERE gm.group_id = $1 AND gm.status = 'active'
        ORDER BY
          CASE gm.role WHEN 'chairperson' THEN 0 WHEN 'treasurer' THEN 1
                       WHEN 'secretary' THEN 2 ELSE 3 END,
          c.first_name ASC`,
      [group.id, req.params.meetingId],
    );
    res.json({ success: true, data: { meeting: mRes.rows[0], roster: roster.rows } });
  } catch (e) {
    logger.error("group meeting get error:", e);
    res.status(500).json({ error: "Failed to load meeting" });
  }
});

// PUT /api/groups/:id/meetings/:meetingId
router.put(
  "/:id/meetings/:meetingId",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { meeting_date, location, agenda, notes, status } = req.body || {};
      if (status && !["scheduled", "held", "cancelled"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const r = await query(
        `UPDATE group_meetings SET
            meeting_date = COALESCE($3::date, meeting_date),
            location = $4, agenda = $5, notes = $6,
            status = COALESCE($7, status), updated_at = NOW()
          WHERE id = $1 AND group_id = $2 RETURNING *`,
        [
          req.params.meetingId, group.id,
          meeting_date || null, location ?? null, agenda ?? null, notes ?? null, status || null,
        ],
      );
      if (!r.rows.length) return res.status(404).json({ error: "Meeting not found" });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error("group meeting update error:", e);
      res.status(500).json({ error: "Failed to update meeting" });
    }
  },
);

// DELETE /api/groups/:id/meetings/:meetingId
router.delete(
  "/:id/meetings/:meetingId",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const r = await query(
        `DELETE FROM group_meetings WHERE id = $1 AND group_id = $2 RETURNING id`,
        [req.params.meetingId, group.id],
      );
      if (!r.rows.length) return res.status(404).json({ error: "Meeting not found" });
      res.json({ success: true });
    } catch (e) {
      logger.error("group meeting delete error:", e);
      res.status(500).json({ error: "Failed to delete meeting" });
    }
  },
);

// POST /api/groups/:id/meetings/:meetingId/attendance — upsert a roster of
// {client_id, status} and mark the meeting held.
router.post(
  "/:id/meetings/:meetingId/attendance",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const mRes = await query(
        `SELECT id FROM group_meetings WHERE id = $1 AND group_id = $2`,
        [req.params.meetingId, group.id],
      );
      if (!mRes.rows.length) return res.status(404).json({ error: "Meeting not found" });

      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!records.length) return res.status(400).json({ error: "No attendance records" });

      for (const rec of records) {
        if (!rec.client_id) continue;
        const status = ATTENDANCE.includes(rec.status) ? rec.status : "present";
        await query(
          `INSERT INTO group_meeting_attendance (tenant_id, meeting_id, client_id, status)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (meeting_id, client_id)
           DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
          [group.tenant_id, req.params.meetingId, rec.client_id, status],
        );
      }
      await query(
        `UPDATE group_meetings SET status='held', updated_at=NOW() WHERE id=$1 AND status <> 'cancelled'`,
        [req.params.meetingId],
      );
      await logAudit({
        user: req.user,
        action: "group_attendance_recorded",
        entityType: "group",
        entityId: group.id,
        entityCode: group.group_code,
        description: `Attendance recorded for "${group.name}" (${records.length} members)`,
        req,
      });
      res.json({ success: true });
    } catch (e) {
      logger.error("group attendance error:", e);
      res.status(500).json({ error: "Failed to record attendance" });
    }
  },
);

// GET /api/groups/:id/attendance-summary — per-member attendance over held meetings.
router.get("/:id/attendance-summary", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const held = await query(
      `SELECT COUNT(*)::int AS n FROM group_meetings WHERE group_id = $1 AND status = 'held'`,
      [group.id],
    );
    const rows = await query(
      `SELECT gm.client_id, c.first_name, c.last_name, c.client_code,
              COUNT(a.id) FILTER (WHERE a.status IN ('present','late'))::int AS attended,
              COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS absent,
              COUNT(a.id) FILTER (WHERE a.status = 'apology')::int AS apologies
         FROM group_members gm
         JOIN clients c ON c.id = gm.client_id
         LEFT JOIN group_meeting_attendance a ON a.client_id = gm.client_id
         LEFT JOIN group_meetings m ON m.id = a.meeting_id AND m.group_id = $1 AND m.status = 'held'
        WHERE gm.group_id = $1 AND gm.status = 'active'
        GROUP BY gm.client_id, c.first_name, c.last_name, c.client_code
        ORDER BY attended DESC`,
      [group.id],
    );
    const heldCount = held.rows[0].n;
    res.json({
      success: true,
      data: {
        held_meetings: heldCount,
        members: rows.rows.map((m) => ({
          ...m,
          rate: heldCount ? Math.round((m.attended / heldCount) * 100) : null,
        })),
      },
    });
  } catch (e) {
    logger.error("group attendance summary error:", e);
    res.status(500).json({ error: "Failed to load attendance summary" });
  }
});

// ---------------- CYCLES ----------------

// GET /api/groups/:id/cycles — with per-cycle loan rollup.
router.get("/:id/cycles", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const r = await query(
      `SELECT cy.*,
          (SELECT COUNT(*) FROM loans l WHERE l.cycle_id = cy.id)::int AS loan_count,
          (SELECT COALESCE(SUM(l.principal_amount),0) FROM loans l
             WHERE l.cycle_id = cy.id AND l.status IN ('active','completed','defaulted')) AS total_disbursed
        FROM group_cycles cy
        WHERE cy.group_id = $1
        ORDER BY cy.cycle_number DESC`,
      [group.id],
    );
    res.json({
      success: true,
      data: r.rows.map((c) => ({ ...c, total_disbursed: Number(c.total_disbursed) })),
    });
  } catch (e) {
    logger.error("group cycles list error:", e);
    res.status(500).json({ error: "Failed to load cycles" });
  }
});

// POST /api/groups/:id/cycles — create the next cycle.
router.post("/:id/cycles", authorize("admin", "manager"), async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { name, start_date, end_date, notes } = req.body || {};
    const maxRes = await query(
      `SELECT COALESCE(MAX(cycle_number),0)::int AS n FROM group_cycles WHERE group_id = $1`,
      [group.id],
    );
    const cycleNumber = maxRes.rows[0].n + 1;
    const r = await query(
      `INSERT INTO group_cycles
         (tenant_id, group_id, cycle_number, name, start_date, end_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8) RETURNING *`,
      [
        group.tenant_id, group.id, cycleNumber,
        name || `Cycle ${cycleNumber}`,
        start_date || null, end_date || null, notes || null, req.user.id,
      ],
    );
    await logAudit({
      user: req.user,
      action: "group_cycle_created",
      entityType: "group",
      entityId: group.id,
      entityCode: group.group_code,
      description: `Cycle ${cycleNumber} opened for "${group.name}"`,
      req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("group cycle create error:", e);
    res.status(500).json({ error: "Failed to create cycle" });
  }
});

// PUT /api/groups/:id/cycles/:cycleId — update / close.
router.put(
  "/:id/cycles/:cycleId",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { name, start_date, end_date, notes, status } = req.body || {};
      if (status && !["open", "closed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const r = await query(
        `UPDATE group_cycles SET
            name = COALESCE($3, name),
            start_date = $4::date, end_date = $5::date, notes = $6,
            status = COALESCE($7, status), updated_at = NOW()
          WHERE id = $1 AND group_id = $2 RETURNING *`,
        [
          req.params.cycleId, group.id,
          name || null, start_date || null, end_date || null, notes ?? null, status || null,
        ],
      );
      if (!r.rows.length) return res.status(404).json({ error: "Cycle not found" });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error("group cycle update error:", e);
      res.status(500).json({ error: "Failed to update cycle" });
    }
  },
);

export default router;
