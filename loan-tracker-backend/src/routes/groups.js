// Group / chama lending (Model A). A group is an organizing + guarantee wrapper
// around its members' individual loans. Mounted at /api/groups.
//
// Members are ordinary clients enrolled in a group. Member loans are created
// through the standard /api/loans flow with loan_type='group' + group_id set;
// this router owns the group, its members, and the rollup of their loans. There
// is no group-level capital pool — the rollup is computed from member loans.
import express from "express";
import { query } from "../config/database.js";
import { verifyToken, authorize } from "../middleware/auth.js";
import { tenantClause, tenantId } from "../utils/tenantScope.js";
import { logAudit } from "../services/auditService.js";
import { buildGroupGuaranteePdf, NotFoundError } from "../utils/pdfDocuments.js";
import logger from "../config/logger.js";

const router = express.Router();
router.use(verifyToken);

const MEMBER_ROLES = ["member", "chairperson", "treasurer", "secretary"];

async function loadGroup(req, id) {
  const tc = tenantClause(req, 1, "tenant_id");
  const r = await query(
    `SELECT * FROM groups WHERE id = $1${tc.clause}`,
    [id, ...tc.params],
  );
  return r.rows[0] || null;
}

// Outstanding balance per loan (cash applied to amount_due) — mirrors the
// receipt/loan-list formula so the rollup agrees with the rest of the app.
const PAID_SUBQUERY = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount_paid - COALESCE(penalty_portion,0) - COALESCE(overpayment_portion,0)), 0) AS paid
      FROM transactions WHERE loan_id = l.id AND payment_status = 'completed'
  ) p ON true`;

// GET /api/groups — list with member + loan rollup.
router.get("/", async (req, res) => {
  try {
    const tc = tenantClause(req, 0, "g.tenant_id"); // tenant param is $1 (no preceding params)
    const search = (req.query.search || "").trim();
    const params = [...tc.params];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      searchClause = ` AND (g.name ILIKE $${params.length} OR g.group_code ILIKE $${params.length})`;
    }
    const r = await query(
      `SELECT g.*,
          (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status='active') AS member_count,
          (SELECT COUNT(*) FROM loans l WHERE l.group_id = g.id AND l.status='active') AS active_loans
        FROM groups g
        WHERE 1=1${tc.clause}${searchClause}
        ORDER BY g.created_at DESC`,
      params,
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("groups list error:", e);
    res.status(500).json({ error: "Failed to load groups" });
  }
});

// POST /api/groups — create.
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const tid = req.user.tenant_id;
    if (!tid) return res.status(400).json({ error: "No tenant context" });
    const { name, branch_id, registration_no, meeting_frequency, notes } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }
    const countRes = await query(
      `SELECT COUNT(*)::int AS n FROM groups WHERE tenant_id = $1`,
      [tid],
    );
    const groupCode = `GRP-${String(countRes.rows[0].n + 1).padStart(5, "0")}`;

    const r = await query(
      `INSERT INTO groups
         (tenant_id, group_code, name, branch_id, registration_no, meeting_frequency, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tid,
        groupCode,
        String(name).trim(),
        branch_id || null,
        registration_no || null,
        meeting_frequency || null,
        notes || null,
        req.user.id,
      ],
    );
    await logAudit({
      user: req.user,
      action: "group_created",
      entityType: "group",
      entityId: r.rows[0].id,
      entityCode: groupCode,
      description: `Group "${String(name).trim()}" created`,
      req,
    });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("group create error:", e);
    res.status(500).json({ error: "Failed to create group" });
  }
});

// GET /api/groups/:id — group + members.
router.get("/:id", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const members = await query(
      `SELECT gm.id, gm.role, gm.status, gm.joined_at, gm.client_id,
              c.first_name, c.last_name, c.phone_number, c.client_code, c.id_number
         FROM group_members gm
         JOIN clients c ON c.id = gm.client_id
        WHERE gm.group_id = $1
        ORDER BY
          CASE gm.role WHEN 'chairperson' THEN 0 WHEN 'treasurer' THEN 1
                       WHEN 'secretary' THEN 2 ELSE 3 END,
          gm.joined_at ASC`,
      [group.id],
    );
    res.json({ success: true, data: { group, members: members.rows } });
  } catch (e) {
    logger.error("group get error:", e);
    res.status(500).json({ error: "Failed to load group" });
  }
});

// PUT /api/groups/:id — update.
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { name, branch_id, registration_no, meeting_frequency, status, notes } = req.body || {};
    if (status && !["active", "dormant", "closed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const r = await query(
      `UPDATE groups SET
          name = COALESCE($2, name),
          branch_id = $3,
          registration_no = $4,
          meeting_frequency = $5,
          status = COALESCE($6, status),
          notes = $7,
          updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [
        group.id,
        name ? String(name).trim() : null,
        branch_id ?? group.branch_id,
        registration_no ?? group.registration_no,
        meeting_frequency ?? group.meeting_frequency,
        status || null,
        notes ?? group.notes,
      ],
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error("group update error:", e);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// DELETE /api/groups/:id — only when no member loans are linked.
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const loans = await query(`SELECT 1 FROM loans WHERE group_id = $1 LIMIT 1`, [group.id]);
    if (loans.rows.length) {
      return res.status(400).json({
        error: "This group has loans — close it instead of deleting",
      });
    }
    await query(`DELETE FROM groups WHERE id = $1`, [group.id]);
    await logAudit({
      user: req.user,
      action: "group_deleted",
      entityType: "group",
      entityId: group.id,
      entityCode: group.group_code,
      description: `Group "${group.name}" deleted`,
      req,
    });
    res.json({ success: true });
  } catch (e) {
    logger.error("group delete error:", e);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

// POST /api/groups/:id/members — enrol an existing client.
router.post(
  "/:id/members",
  authorize("admin", "manager", "loan_officer"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { client_id, role } = req.body || {};
      if (!client_id) return res.status(400).json({ error: "client_id is required" });
      const memberRole = MEMBER_ROLES.includes(role) ? role : "member";

      const client = await query(
        `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND tenant_id = $2`,
        [client_id, group.tenant_id],
      );
      if (!client.rows.length) return res.status(404).json({ error: "Client not found" });

      const exists = await query(
        `SELECT id FROM group_members WHERE group_id = $1 AND client_id = $2`,
        [group.id, client_id],
      );
      if (exists.rows.length) {
        return res.status(409).json({ error: "Client is already a member of this group" });
      }

      const r = await query(
        `INSERT INTO group_members (tenant_id, group_id, client_id, role)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [group.tenant_id, group.id, client_id, memberRole],
      );
      await logAudit({
        user: req.user,
        action: "group_member_added",
        entityType: "group",
        entityId: group.id,
        entityCode: group.group_code,
        description: `${client.rows[0].first_name} ${client.rows[0].last_name} added to "${group.name}"`,
        req,
      });
      res.status(201).json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error("group add member error:", e);
      res.status(500).json({ error: "Failed to add member" });
    }
  },
);

// PATCH /api/groups/:id/members/:memberId — change role / status.
router.patch(
  "/:id/members/:memberId",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const { role, status } = req.body || {};
      if (role && !MEMBER_ROLES.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (status && !["active", "exited"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const r = await query(
        `UPDATE group_members
            SET role = COALESCE($3, role), status = COALESCE($4, status), updated_at = NOW()
          WHERE id = $1 AND group_id = $2 RETURNING *`,
        [req.params.memberId, group.id, role || null, status || null],
      );
      if (!r.rows.length) return res.status(404).json({ error: "Member not found" });
      res.json({ success: true, data: r.rows[0] });
    } catch (e) {
      logger.error("group update member error:", e);
      res.status(500).json({ error: "Failed to update member" });
    }
  },
);

// DELETE /api/groups/:id/members/:memberId — remove, unless they hold a loan
// under this group.
router.delete(
  "/:id/members/:memberId",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const group = await loadGroup(req, req.params.id);
      if (!group) return res.status(404).json({ error: "Group not found" });
      const member = await query(
        `SELECT client_id FROM group_members WHERE id = $1 AND group_id = $2`,
        [req.params.memberId, group.id],
      );
      if (!member.rows.length) return res.status(404).json({ error: "Member not found" });

      const loans = await query(
        `SELECT 1 FROM loans WHERE group_id = $1 AND client_id = $2 LIMIT 1`,
        [group.id, member.rows[0].client_id],
      );
      if (loans.rows.length) {
        return res.status(400).json({
          error: "This member holds a loan under the group — mark them exited instead",
        });
      }
      await query(`DELETE FROM group_members WHERE id = $1`, [req.params.memberId]);
      res.json({ success: true });
    } catch (e) {
      logger.error("group remove member error:", e);
      res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

// GET /api/groups/:id/summary — rollup across member loans.
router.get("/:id/summary", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const members = await query(
      `SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1 AND status = 'active'`,
      [group.id],
    );
    const agg = await query(
      `SELECT
          COUNT(*) FILTER (WHERE l.status IN ('active','completed','defaulted'))::int AS disbursed_loans,
          COUNT(*) FILTER (WHERE l.status = 'active')::int AS active_loans,
          COUNT(*) FILTER (WHERE l.status = 'completed')::int AS completed_loans,
          COUNT(*) FILTER (WHERE l.status = 'defaulted')::int AS defaulted_loans,
          COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status IN ('active','completed','defaulted')), 0) AS total_disbursed,
          COALESCE(SUM(CASE WHEN l.status = 'active'
                       THEN GREATEST(l.total_amount_due - p.paid, 0) ELSE 0 END), 0) AS total_outstanding
        FROM loans l${PAID_SUBQUERY}
        WHERE l.group_id = $1`,
      [group.id],
    );
    const arrears = await query(
      `SELECT COUNT(DISTINCT l.id)::int AS n
         FROM loans l
         JOIN payment_schedules ps ON ps.loan_id = l.id
        WHERE l.group_id = $1 AND l.status = 'active'
          AND ps.status <> 'paid' AND ps.due_date < CURRENT_DATE`,
      [group.id],
    );

    const a = agg.rows[0];
    res.json({
      success: true,
      data: {
        member_count: members.rows[0].n,
        disbursed_loans: a.disbursed_loans,
        active_loans: a.active_loans,
        completed_loans: a.completed_loans,
        defaulted_loans: a.defaulted_loans,
        total_disbursed: Number(a.total_disbursed),
        total_outstanding: Number(a.total_outstanding),
        exposure: Number(a.total_outstanding),
        arrears_count: arrears.rows[0].n,
      },
    });
  } catch (e) {
    logger.error("group summary error:", e);
    res.status(500).json({ error: "Failed to load group summary" });
  }
});

// GET /api/groups/:id/loans — member loans under the group.
router.get("/:id/loans", async (req, res) => {
  try {
    const group = await loadGroup(req, req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    const r = await query(
      `SELECT l.id, l.loan_code, l.status, l.loan_type, l.principal_amount,
              l.total_amount_due, l.created_at,
              c.first_name, c.last_name, c.client_code,
              GREATEST(l.total_amount_due - p.paid, 0) AS balance
         FROM loans l${PAID_SUBQUERY}
         JOIN clients c ON c.id = l.client_id
        WHERE l.group_id = $1
        ORDER BY l.created_at DESC`,
      [group.id],
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error("group loans error:", e);
    res.status(500).json({ error: "Failed to load group loans" });
  }
});

// GET /api/groups/:id/guarantee-form — joint-liability guarantee form (PDF).
router.get("/:id/guarantee-form", async (req, res) => {
  try {
    const { buffer, filename } = await buildGroupGuaranteePdf(
      req.params.id,
      tenantId(req),
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (e) {
    if (e instanceof NotFoundError) return res.status(404).json({ error: e.message });
    logger.error("group guarantee form error:", e);
    res.status(500).json({ error: "Failed to generate guarantee form" });
  }
});

export default router;
